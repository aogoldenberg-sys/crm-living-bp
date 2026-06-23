import { describe, it, expect } from "vitest";
import { reduceDeals } from "./reduce.js";
import { funnelMetrics } from "./metrics.js";
import type { DealStageChanged } from "@crm/schemas";
import type { Funnel } from "@crm/schemas";

// ── Фикстуры ─────────────────────────────────────────────────────────────────

let _eid = 0;
function uuid(): string {
  return `00000000-0000-0000-0000-${String(++_eid).padStart(12, "0")}`;
}

const FUNNEL: Funnel = {
  funnelId: "main",
  name: "Основная воронка",
  stages: [
    { id: "new",      name: "Новый",          normConversion: 0.8, normDays: 3,  terminal: false },
    { id: "qual",     name: "Квалификация",   normConversion: 0.6, normDays: 7,  terminal: false },
    { id: "proposal", name: "КП отправлено",  normConversion: 0.5, normDays: 14, terminal: false },
    { id: "won",      name: "Закрыто",        normConversion: 1.0, normDays: 1,  terminal: true  },
  ],
};

function makeEvent(
  overrides: Partial<DealStageChanged> & { dealId: string; fromStage: string; toStage: string; ts: string },
): DealStageChanged {
  return {
    type: "deal_stage_changed",
    eventId: uuid(),
    funnelId: "main",
    leadId: uuid(),
    estimatedAmount: 1_000_000,
    probability: 0.5,
    expectedCloseDate: null,
    expectedPaymentDate: null,
    clientId: null,
    ownerId: "550e8400-e29b-41d4-a716-446655440001",
    managerId: "550e8400-e29b-41d4-a716-446655440001",
    counterpartyInn: null,
    counterpartyName: "Тест",
    source: "manual",
    businessId: "opentgp",
    ...overrides,
  };
}

const DEAL_A = "550e8400-e29b-41d4-a716-000000000001";
const DEAL_B = "550e8400-e29b-41d4-a716-000000000002";
const DEAL_C = "550e8400-e29b-41d4-a716-000000000003";

// asOf фиксирован — детерминизм тестов
const AS_OF = new Date("2026-06-20T12:00:00Z");

// ── reduceDeals ───────────────────────────────────────────────────────────────

describe("reduceDeals — пустой лог", () => {
  it("возвращает пустую Map", () => {
    const result = reduceDeals([], AS_OF);
    expect(result.size).toBe(0);
  });
});

describe("reduceDeals — сделка через все стадии", () => {
  const events: DealStageChanged[] = [
    makeEvent({ dealId: DEAL_A, fromStage: "",    toStage: "new",      ts: "2026-06-15T10:00:00Z" }),
    makeEvent({ dealId: DEAL_A, fromStage: "new", toStage: "qual",     ts: "2026-06-16T10:00:00Z" }),
    makeEvent({ dealId: DEAL_A, fromStage: "qual", toStage: "proposal", ts: "2026-06-18T10:00:00Z" }),
    makeEvent({ dealId: DEAL_A, fromStage: "proposal", toStage: "won", ts: "2026-06-19T10:00:00Z" }),
  ];

  it("сделка в конечном состоянии won", () => {
    const deals = reduceDeals(events, AS_OF);
    expect(deals.get(DEAL_A)?.currentStage).toBe("won");
  });

  it("updatedAt — ts последнего события", () => {
    const deals = reduceDeals(events, AS_OF);
    expect(deals.get(DEAL_A)?.updatedAt).toBe("2026-06-19T10:00:00Z");
  });

  it("daysInStage = 1 (с 2026-06-19 до 2026-06-20)", () => {
    const deals = reduceDeals(events, AS_OF);
    expect(deals.get(DEAL_A)?.daysInStage).toBe(1);
  });

  it("не создаёт лишних сделок", () => {
    const deals = reduceDeals(events, AS_OF);
    expect(deals.size).toBe(1);
  });
});

describe("reduceDeals — застрявшая сделка", () => {
  const events: DealStageChanged[] = [
    // Сделка зашла на qual 10 дней назад (норматив = 7)
    makeEvent({ dealId: DEAL_B, fromStage: "", toStage: "new",  ts: "2026-06-08T10:00:00Z" }),
    makeEvent({ dealId: DEAL_B, fromStage: "new", toStage: "qual", ts: "2026-06-10T10:00:00Z" }),
  ];

  it("daysInStage = 10 (с 2026-06-10 до 2026-06-20)", () => {
    const deals = reduceDeals(events, AS_OF);
    expect(deals.get(DEAL_B)?.daysInStage).toBe(10);
  });

  it("currentStage = qual", () => {
    const deals = reduceDeals(events, AS_OF);
    expect(deals.get(DEAL_B)?.currentStage).toBe("qual");
  });
});

describe("reduceDeals — детерминизм при перемешанном порядке", () => {
  const ev1 = makeEvent({ dealId: DEAL_C, fromStage: "",    toStage: "new",  ts: "2026-06-15T10:00:00Z" });
  const ev2 = makeEvent({ dealId: DEAL_C, fromStage: "new", toStage: "qual", ts: "2026-06-16T10:00:00Z" });

  it("результат одинаков вне зависимости от порядка входа", () => {
    const r1 = reduceDeals([ev1, ev2], AS_OF);
    const r2 = reduceDeals([ev2, ev1], AS_OF);
    expect(r1.get(DEAL_C)?.currentStage).toBe(r2.get(DEAL_C)?.currentStage);
    expect(r1.get(DEAL_C)?.daysInStage).toBe(r2.get(DEAL_C)?.daysInStage);
  });
});

// ── funnelMetrics ─────────────────────────────────────────────────────────────

describe("funnelMetrics — пустая воронка", () => {
  it("все count = 0", () => {
    const metrics = funnelMetrics(new Map(), FUNNEL);
    expect(metrics.stages.every((s) => s.count === 0)).toBe(true);
  });
  it("totalWeightedPipeline = 0", () => {
    const metrics = funnelMetrics(new Map(), FUNNEL);
    expect(metrics.totalWeightedPipeline).toBe(0);
  });
  it("factConversion = 0 при отсутствии сделок", () => {
    const metrics = funnelMetrics(new Map(), FUNNEL);
    expect(metrics.stages.every((s) => s.factConversion === 0)).toBe(true);
  });
});

describe("funnelMetrics — сделка через все стадии (DEAL_A в won)", () => {
  const events: DealStageChanged[] = [
    makeEvent({ dealId: DEAL_A, fromStage: "",    toStage: "new",      ts: "2026-06-15T10:00:00Z" }),
    makeEvent({ dealId: DEAL_A, fromStage: "new", toStage: "qual",     ts: "2026-06-16T10:00:00Z" }),
    makeEvent({ dealId: DEAL_A, fromStage: "qual", toStage: "proposal", ts: "2026-06-18T10:00:00Z" }),
    makeEvent({ dealId: DEAL_A, fromStage: "proposal", toStage: "won", ts: "2026-06-19T10:00:00Z" }),
  ];

  it("на стадии new count=0, на won count=1", () => {
    const deals = reduceDeals(events, AS_OF);
    const m = funnelMetrics(deals, FUNNEL);
    expect(m.stages.find(s => s.stageId === "new")?.count).toBe(0);
    expect(m.stages.find(s => s.stageId === "won")?.count).toBe(1);
  });

  it("конверсия new→qual = 1.0 (единственная сделка прошла дальше)", () => {
    const deals = reduceDeals(events, AS_OF);
    const m = funnelMetrics(deals, FUNNEL);
    const newStage = m.stages.find(s => s.stageId === "new")!;
    expect(newStage.factConversion).toBeCloseTo(1.0);
  });
});

describe("funnelMetrics — застрявшая сделка (DEAL_B в qual 10 дней, норма 7)", () => {
  const events: DealStageChanged[] = [
    makeEvent({ dealId: DEAL_B, fromStage: "",    toStage: "new",  ts: "2026-06-08T10:00:00Z" }),
    makeEvent({ dealId: DEAL_B, fromStage: "new", toStage: "qual", ts: "2026-06-10T10:00:00Z" }),
  ];

  it("DEAL_B попадает в stuck на стадии qual", () => {
    const deals = reduceDeals(events, AS_OF);
    const m = funnelMetrics(deals, FUNNEL);
    const qualStage = m.stages.find(s => s.stageId === "qual")!;
    expect(qualStage.stuck).toContain(DEAL_B);
  });

  it("avgDays > normDays для qual", () => {
    const deals = reduceDeals(events, AS_OF);
    const m = funnelMetrics(deals, FUNNEL);
    const qualStage = m.stages.find(s => s.stageId === "qual")!;
    expect(qualStage.avgDays).toBeGreaterThan(qualStage.normDays);
  });
});

describe("funnelMetrics — отклонение конверсии от нормы", () => {
  // 1 сделка в new (не прошла дальше), 1 в qual
  // factConversion для new = 1/2 = 0.5, normConversion = 0.8 → отклонение
  const evA = makeEvent({ dealId: DEAL_A, fromStage: "", toStage: "new", ts: "2026-06-18T10:00:00Z" });
  const evB1 = makeEvent({ dealId: DEAL_B, fromStage: "", toStage: "new",  ts: "2026-06-15T10:00:00Z" });
  const evB2 = makeEvent({ dealId: DEAL_B, fromStage: "new", toStage: "qual", ts: "2026-06-16T10:00:00Z" });

  it("factConversion < normConversion когда сделки застревают", () => {
    const deals = reduceDeals([evA, evB1, evB2], AS_OF);
    const m = funnelMetrics(deals, FUNNEL);
    const newStage = m.stages.find(s => s.stageId === "new")!;
    expect(newStage.factConversion).toBeLessThan(newStage.normConversion);
  });

  it("weightedPipeline = amount × probability для сделки в new", () => {
    const deals = reduceDeals([evA, evB1, evB2], AS_OF);
    const m = funnelMetrics(deals, FUNNEL);
    const newStage = m.stages.find(s => s.stageId === "new")!;
    // evA: amount=1_000_000, probability=0.5 → 500_000
    expect(newStage.weightedPipeline).toBe(500_000);
  });
});

// ── terminal stages ───────────────────────────────────────────────────────────

describe("funnelMetrics — терминальная стадия won", () => {
  const events: DealStageChanged[] = [
    makeEvent({ dealId: DEAL_A, fromStage: "",         toStage: "new",      ts: "2026-06-15T10:00:00Z" }),
    makeEvent({ dealId: DEAL_A, fromStage: "new",      toStage: "qual",     ts: "2026-06-16T10:00:00Z" }),
    makeEvent({ dealId: DEAL_A, fromStage: "qual",     toStage: "proposal", ts: "2026-06-18T10:00:00Z" }),
    makeEvent({ dealId: DEAL_A, fromStage: "proposal", toStage: "won",      ts: "2026-06-19T10:00:00Z" }),
  ];

  it("stuck пуст для терминальной стадии won (даже если daysInStage > normDays)", () => {
    const deals = reduceDeals(events, AS_OF);
    const m = funnelMetrics(deals, FUNNEL);
    const wonStage = m.stages.find(s => s.stageId === "won")!;
    // daysInStage = 1, normDays = 1 → в обычной логике could be stuck, но terminal = [] всегда
    expect(wonStage.stuck).toHaveLength(0);
  });

  it("factConversion = 0 для терминальной стадии (нет стадий дальше)", () => {
    const deals = reduceDeals(events, AS_OF);
    const m = funnelMetrics(deals, FUNNEL);
    const wonStage = m.stages.find(s => s.stageId === "won")!;
    expect(wonStage.factConversion).toBe(0);
  });

  it("terminal = true в метриках стадии won", () => {
    const deals = reduceDeals(events, AS_OF);
    const m = funnelMetrics(deals, FUNNEL);
    const wonStage = m.stages.find(s => s.stageId === "won")!;
    expect(wonStage.terminal).toBe(true);
  });

  it("нетерминальные стадии имеют terminal = false", () => {
    const deals = reduceDeals(events, AS_OF);
    const m = funnelMetrics(deals, FUNNEL);
    const nonTerminal = m.stages.filter(s => s.stageId !== "won");
    expect(nonTerminal.every(s => s.terminal === false)).toBe(true);
  });
});

// ── cohort conversion ─────────────────────────────────────────────────────────

describe("funnelMetrics — когортная конверсия", () => {
  // DEAL_A: вошёл в new 15.06, в qual 16.06 — конверсия за период [14.06-17.06] = 1/1 = 1.0
  // DEAL_B: вошёл в new 16.06, остался в new — конверсия = 1/2 = 0.5
  const evA1 = makeEvent({ dealId: DEAL_A, fromStage: "",    toStage: "new",  ts: "2026-06-15T10:00:00Z" });
  const evA2 = makeEvent({ dealId: DEAL_A, fromStage: "new", toStage: "qual", ts: "2026-06-16T10:00:00Z" });
  const evB1 = makeEvent({ dealId: DEAL_B, fromStage: "",    toStage: "new",  ts: "2026-06-16T12:00:00Z" });

  const PERIOD = {
    events: [evA1, evA2, evB1],
    from: "2026-06-14T00:00:00Z" as const,
    to:   "2026-06-17T23:59:59Z" as const,
  };

  it("cohortConversion для new = 0.5 (1 из 2 дошёл дальше)", () => {
    const deals = reduceDeals([evA1, evA2, evB1], AS_OF);
    const m = funnelMetrics(deals, FUNNEL, PERIOD);
    const newStage = m.stages.find(s => s.stageId === "new")!;
    expect(newStage.cohortConversion).toBeCloseTo(0.5);
  });

  it("cohortConversion null если не передан cohortOptions", () => {
    const deals = reduceDeals([evA1, evA2, evB1], AS_OF);
    const m = funnelMetrics(deals, FUNNEL);
    const newStage = m.stages.find(s => s.stageId === "new")!;
    expect(newStage.cohortConversion).toBeNull();
  });

  it("cohortConversion null для терминальной стадии даже с events", () => {
    const wonEvent = makeEvent({ dealId: DEAL_A, fromStage: "proposal", toStage: "won", ts: "2026-06-18T10:00:00Z" });
    const deals = reduceDeals([evA1, evA2, wonEvent], AS_OF);
    const m = funnelMetrics(deals, FUNNEL, { events: [evA1, evA2, wonEvent], from: "2026-06-14T00:00:00Z", to: "2026-06-20T23:59:59Z" });
    const wonStage = m.stages.find(s => s.stageId === "won")!;
    expect(wonStage.cohortConversion).toBeNull();
  });

  it("cohortConversion null если в период не было входов в стадию", () => {
    const deals = reduceDeals([evA1, evA2, evB1], AS_OF);
    // Период до событий
    const m = funnelMetrics(deals, FUNNEL, { events: [evA1, evA2, evB1], from: "2026-06-01T00:00:00Z", to: "2026-06-10T00:00:00Z" });
    const newStage = m.stages.find(s => s.stageId === "new")!;
    expect(newStage.cohortConversion).toBeNull();
  });
});
