import { describe, it, expect } from "vitest";
import { computeDemandSignals } from "./signals.js";
import type { LeadCaptured, CallLogged, DealStageChanged } from "@crm/schemas";
import type { DemandPeriod } from "./types.js";

// ── Фикстуры ─────────────────────────────────────────────────────────────────

let _id = 0;
function uuid(): string {
  return `00000000-0000-0000-0000-${String(++_id).padStart(12, "0")}`;
}

const PERIOD: DemandPeriod = {
  from: "2026-06-01T00:00:00Z",
  to:   "2026-06-30T23:59:59Z",
};

const WON_STAGES = ["won"];

function makeLead(overrides: Partial<LeadCaptured> & { leadId: string; ts: string }): LeadCaptured {
  return {
    type: "lead_captured",
    eventId: uuid(),
    channel: "website",
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    contactPhone: null,
    contactEmail: null,
    source: "manual",
    businessId: "demo",
    ...overrides,
  };
}

function makeDeal(overrides: Partial<DealStageChanged> & {
  dealId: string; leadId: string; fromStage: string; toStage: string; ts: string;
}): DealStageChanged {
  return {
    type: "deal_stage_changed",
    eventId: uuid(),
    funnelId: "main",
    estimatedAmount: 1_000_000,
    probability: 0.5,
    expectedCloseDate: null,
    expectedPaymentDate: null,
    clientId: null,
    ownerId: uuid(),
    managerId: uuid(),
    counterpartyInn: null,
    counterpartyName: "Demo",
    source: "manual",
    businessId: "demo",
    ...overrides,
  };
}

const NO_CALLS: CallLogged[] = [];

// ── Пустой ввод ───────────────────────────────────────────────────────────────

describe("computeDemandSignals — пустой ввод", () => {
  it("leads = 0 при нет событий", () => {
    const s = computeDemandSignals([], NO_CALLS, [], PERIOD);
    expect(s.leads).toBe(0);
  });

  it("qualifiedRate = 0 при нет лидов", () => {
    const s = computeDemandSignals([], NO_CALLS, [], PERIOD);
    expect(s.qualifiedRate).toBe(0);
  });

  it("winRate = null если wonStageIds не переданы", () => {
    const s = computeDemandSignals([], NO_CALLS, [], PERIOD);
    expect(s.winRate).toBeNull();
  });

  it("winRate = 0 если wonStageIds переданы но нет сделок", () => {
    const s = computeDemandSignals([], NO_CALLS, [], PERIOD, { wonStageIds: WON_STAGES });
    expect(s.winRate).toBe(0);
  });

  it("avgCheckFact = 0 при нет won-сделок", () => {
    const s = computeDemandSignals([], NO_CALLS, [], PERIOD, { wonStageIds: WON_STAGES });
    expect(s.avgCheckFact).toBe(0);
  });

  it("trendScore = 0 без baseline", () => {
    const s = computeDemandSignals([], NO_CALLS, [], PERIOD);
    expect(s.trendScore).toBe(0);
  });
});

// ── Лиды за период ────────────────────────────────────────────────────────────

describe("computeDemandSignals — лиды", () => {
  const L1 = uuid();
  const L2 = uuid();
  const L3 = uuid();

  const leads: LeadCaptured[] = [
    makeLead({ leadId: L1, ts: "2026-06-10T10:00:00Z" }),
    makeLead({ leadId: L2, ts: "2026-06-15T10:00:00Z" }),
    // За пределами периода
    makeLead({ leadId: L3, ts: "2026-07-01T00:00:00Z" }),
  ];

  it("считает только лиды внутри периода", () => {
    const s = computeDemandSignals(leads, NO_CALLS, [], PERIOD);
    expect(s.leads).toBe(2);
  });
});

// ── qualifiedRate ─────────────────────────────────────────────────────────────

describe("computeDemandSignals — qualifiedRate", () => {
  const L1 = uuid();
  const L2 = uuid();
  const D1 = uuid();

  const leads: LeadCaptured[] = [
    makeLead({ leadId: L1, ts: "2026-06-10T10:00:00Z" }), // квалифицирован
    makeLead({ leadId: L2, ts: "2026-06-11T10:00:00Z" }), // не квалифицирован
  ];

  const deals: DealStageChanged[] = [
    // Вход сделки по L1 (fromStage = "" = вход в воронку)
    makeDeal({ dealId: D1, leadId: L1, fromStage: "", toStage: "new", ts: "2026-06-10T12:00:00Z" }),
  ];

  it("qualifiedRate = 0.5 (1 из 2 лидов квалифицирован)", () => {
    const s = computeDemandSignals(leads, NO_CALLS, deals, PERIOD);
    expect(s.qualifiedRate).toBeCloseTo(0.5);
  });
});

// ── winRate ───────────────────────────────────────────────────────────────────

describe("computeDemandSignals — winRate", () => {
  const L1 = uuid();
  const L2 = uuid();
  const D1 = uuid();
  const D2 = uuid();

  const deals: DealStageChanged[] = [
    // Сделка D1: вошла в период, дошла до won
    makeDeal({ dealId: D1, leadId: L1, fromStage: "",    toStage: "new", ts: "2026-06-10T10:00:00Z" }),
    makeDeal({ dealId: D1, leadId: L1, fromStage: "new", toStage: "won", ts: "2026-06-20T10:00:00Z" }),
    // Сделка D2: вошла в период, не дошла до won
    makeDeal({ dealId: D2, leadId: L2, fromStage: "",    toStage: "new", ts: "2026-06-12T10:00:00Z" }),
  ];

  it("winRate = 0.5 (1 из 2 сделок выиграна)", () => {
    const s = computeDemandSignals([], NO_CALLS, deals, PERIOD, { wonStageIds: WON_STAGES });
    expect(s.winRate).toBeCloseTo(0.5);
  });

  it("winRate = null без wonStageIds", () => {
    const s = computeDemandSignals([], NO_CALLS, deals, PERIOD);
    expect(s.winRate).toBeNull();
  });
});

// ── avgCheckFact ──────────────────────────────────────────────────────────────

describe("computeDemandSignals — avgCheckFact", () => {
  const L1 = uuid();
  const L2 = uuid();
  const D1 = uuid();
  const D2 = uuid();

  const deals: DealStageChanged[] = [
    makeDeal({ dealId: D1, leadId: L1, fromStage: "",    toStage: "new", ts: "2026-06-10T10:00:00Z", estimatedAmount: 1_000_000 }),
    makeDeal({ dealId: D1, leadId: L1, fromStage: "new", toStage: "won", ts: "2026-06-20T10:00:00Z", estimatedAmount: 1_000_000 }),
    makeDeal({ dealId: D2, leadId: L2, fromStage: "",    toStage: "new", ts: "2026-06-12T10:00:00Z", estimatedAmount: 3_000_000 }),
    makeDeal({ dealId: D2, leadId: L2, fromStage: "new", toStage: "won", ts: "2026-06-25T10:00:00Z", estimatedAmount: 3_000_000 }),
  ];

  it("avgCheckFact = среднее двух won-сделок (2 000 000 копеек)", () => {
    const s = computeDemandSignals([], NO_CALLS, deals, PERIOD, { wonStageIds: WON_STAGES });
    expect(s.avgCheckFact).toBe(2_000_000);
  });
});

// ── trendScore ────────────────────────────────────────────────────────────────

describe("computeDemandSignals — trendScore (EMA)", () => {
  it("trendScore > 0 при росте лидов относительно baseline", () => {
    const current = computeDemandSignals(
      [
        makeLead({ leadId: uuid(), ts: "2026-06-10T10:00:00Z" }),
        makeLead({ leadId: uuid(), ts: "2026-06-11T10:00:00Z" }),
      ],
      NO_CALLS,
      [],
      PERIOD,
    );

    const baseline = computeDemandSignals(
      [
        makeLead({ leadId: uuid(), ts: "2026-05-10T10:00:00Z" }),
      ],
      NO_CALLS,
      [],
      { from: "2026-05-01T00:00:00Z", to: "2026-05-31T23:59:59Z" },
    );

    const s = computeDemandSignals(
      [
        makeLead({ leadId: uuid(), ts: "2026-06-10T10:00:00Z" }),
        makeLead({ leadId: uuid(), ts: "2026-06-11T10:00:00Z" }),
      ],
      NO_CALLS,
      [],
      PERIOD,
      { baseline },
    );

    expect(s.trendScore).toBeGreaterThan(0);
  });

  it("trendScore в диапазоне [-1, 1]", () => {
    const baseline = computeDemandSignals(
      [makeLead({ leadId: uuid(), ts: "2026-05-10T10:00:00Z" })],
      NO_CALLS,
      [],
      { from: "2026-05-01T00:00:00Z", to: "2026-05-31T23:59:59Z" },
    );

    // Экстремальный рост: 100 лидов vs 1 в baseline
    const manyLeads = Array.from({ length: 100 }, () =>
      makeLead({ leadId: uuid(), ts: "2026-06-10T10:00:00Z" }),
    );

    const s = computeDemandSignals(manyLeads, NO_CALLS, [], PERIOD, { baseline });

    expect(s.trendScore).toBeGreaterThanOrEqual(-1);
    expect(s.trendScore).toBeLessThanOrEqual(1);
  });

  it("trendScore = 0 без baseline", () => {
    const leads = [makeLead({ leadId: uuid(), ts: "2026-06-10T10:00:00Z" })];
    const s = computeDemandSignals(leads, NO_CALLS, [], PERIOD);
    expect(s.trendScore).toBe(0);
  });
});

// ── Детерминизм ───────────────────────────────────────────────────────────────

describe("computeDemandSignals — детерминизм", () => {
  const L1 = uuid();
  const D1 = uuid();

  const leads = [makeLead({ leadId: L1, ts: "2026-06-10T10:00:00Z" })];
  const deals = [
    makeDeal({ dealId: D1, leadId: L1, fromStage: "", toStage: "new", ts: "2026-06-10T12:00:00Z" }),
    makeDeal({ dealId: D1, leadId: L1, fromStage: "new", toStage: "won", ts: "2026-06-20T12:00:00Z" }),
  ];

  it("одинаковый ввод → одинаковый вывод", () => {
    const s1 = computeDemandSignals(leads, NO_CALLS, deals, PERIOD, { wonStageIds: WON_STAGES });
    const s2 = computeDemandSignals(leads, NO_CALLS, deals, PERIOD, { wonStageIds: WON_STAGES });
    expect(s1).toEqual(s2);
  });
});
