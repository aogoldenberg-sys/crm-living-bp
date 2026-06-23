import { describe, it, expect } from "vitest";
import { FunnelStage, Funnel, Deal } from "./funnel.js";

// ── fixtures ──────────────────────────────────────────────────────────────────

const validStage: FunnelStage = {
  id: "qualified",
  name: "Квалификация",
  normConversion: 0.6,
  normDays: 7,
  terminal: false,
};

const validFunnel: Funnel = {
  funnelId: "main-funnel",
  name: "Основная воронка",
  stages: [
    { id: "new",      name: "Новый",           normConversion: 0.8, normDays: 3,  terminal: false },
    { id: "qualified",name: "Квалификация",    normConversion: 0.6, normDays: 7,  terminal: false },
    { id: "proposal", name: "КП отправлено",   normConversion: 0.4, normDays: 14, terminal: false },
    { id: "won",      name: "Закрыто/Выиграно",normConversion: 1.0, normDays: 1,  terminal: true  },
  ],
};

const validDeal: Deal = {
  dealId: "550e8400-e29b-41d4-a716-446655440020",
  funnelId: "main-funnel",
  currentStage: "qualified",
  amount: 3_000_000,
  probability: 0.6,
  ownerId: "550e8400-e29b-41d4-a716-446655440021",
  clientId: "550e8400-e29b-41d4-a716-446655440022",
  expectedCloseDate: "2026-09-01",
  expectedPaymentDate: "2026-09-15",
  daysInStage: 4,
  updatedAt: "2026-06-20T10:00:00Z",
};

// ── FunnelStage ───────────────────────────────────────────────────────────────

describe("FunnelStage", () => {
  it("принимает валидную стадию", () => {
    expect(FunnelStage.parse(validStage)).toEqual(validStage);
  });
  it("принимает normConversion = 0 (никто не проходит)", () => {
    expect(FunnelStage.parse({ ...validStage, normConversion: 0 })).toBeTruthy();
  });
  it("принимает normConversion = 1 (все проходят)", () => {
    expect(FunnelStage.parse({ ...validStage, normConversion: 1 })).toBeTruthy();
  });
  it("принимает terminal = true для терминальных стадий", () => {
    expect(FunnelStage.parse({ ...validStage, terminal: true }).terminal).toBe(true);
  });
  it("terminal по умолчанию false (обратная совместимость без поля)", () => {
    const { terminal: _t, ...withoutTerminal } = validStage;
    expect(FunnelStage.parse(withoutTerminal).terminal).toBe(false);
  });

  it("отклоняет пустой id", () => {
    expect(() => FunnelStage.parse({ ...validStage, id: "" })).toThrow();
  });
  it("отклоняет пустое name", () => {
    expect(() => FunnelStage.parse({ ...validStage, name: "" })).toThrow();
  });
  it("отклоняет normConversion > 1", () => {
    expect(() => FunnelStage.parse({ ...validStage, normConversion: 1.01 })).toThrow();
  });
  it("отклоняет normConversion < 0", () => {
    expect(() => FunnelStage.parse({ ...validStage, normConversion: -0.1 })).toThrow();
  });
  it("отклоняет normDays = 0 (должно быть > 0)", () => {
    expect(() => FunnelStage.parse({ ...validStage, normDays: 0 })).toThrow();
  });
  it("отклоняет дробные normDays", () => {
    expect(() => FunnelStage.parse({ ...validStage, normDays: 3.5 })).toThrow();
  });
  it("отклоняет лишние поля (.strict)", () => {
    expect(() => FunnelStage.parse({ ...validStage, extra: "x" })).toThrow();
  });
});

// ── Funnel ────────────────────────────────────────────────────────────────────

describe("Funnel", () => {
  it("принимает валидную воронку", () => {
    expect(Funnel.parse(validFunnel)).toEqual(validFunnel);
  });
  it("принимает минимальную воронку из 2 стадий", () => {
    const twoStage = { ...validFunnel, stages: validFunnel.stages.slice(0, 2) };
    expect(Funnel.parse(twoStage)).toBeTruthy();
  });

  it("отклоняет воронку с 1 стадией", () => {
    expect(() => Funnel.parse({ ...validFunnel, stages: [validFunnel.stages[0]] })).toThrow();
  });
  it("отклоняет пустой funnelId", () => {
    expect(() => Funnel.parse({ ...validFunnel, funnelId: "" })).toThrow();
  });
  it("отклоняет пустое name", () => {
    expect(() => Funnel.parse({ ...validFunnel, name: "" })).toThrow();
  });
  it("отклоняет лишние поля (.strict)", () => {
    expect(() => Funnel.parse({ ...validFunnel, extra: "x" })).toThrow();
  });
});

// ── Deal ──────────────────────────────────────────────────────────────────────

describe("Deal", () => {
  it("принимает валидную проекцию сделки", () => {
    expect(Deal.parse(validDeal)).toEqual(validDeal);
  });
  it("принимает null clientId (не идентифицирован)", () => {
    expect(Deal.parse({ ...validDeal, clientId: null })).toBeTruthy();
  });
  it("принимает null expectedCloseDate", () => {
    expect(Deal.parse({ ...validDeal, expectedCloseDate: null })).toBeTruthy();
  });
  it("принимает null expectedPaymentDate", () => {
    expect(Deal.parse({ ...validDeal, expectedPaymentDate: null })).toBeTruthy();
  });
  it("принимает amount = 0 (сумма ещё не определена)", () => {
    expect(Deal.parse({ ...validDeal, amount: 0 })).toBeTruthy();
  });
  it("принимает daysInStage = 0 (только что пришла)", () => {
    expect(Deal.parse({ ...validDeal, daysInStage: 0 })).toBeTruthy();
  });

  it("отклоняет отрицательный amount", () => {
    expect(() => Deal.parse({ ...validDeal, amount: -1 })).toThrow();
  });
  it("отклоняет дробный amount", () => {
    expect(() => Deal.parse({ ...validDeal, amount: 100.5 })).toThrow();
  });
  it("отклоняет probability > 1", () => {
    expect(() => Deal.parse({ ...validDeal, probability: 1.01 })).toThrow();
  });
  it("отклоняет probability < 0", () => {
    expect(() => Deal.parse({ ...validDeal, probability: -0.1 })).toThrow();
  });
  it("отклоняет некорректный UUID dealId", () => {
    expect(() => Deal.parse({ ...validDeal, dealId: "not-uuid" })).toThrow();
  });
  it("отклоняет отрицательный daysInStage", () => {
    expect(() => Deal.parse({ ...validDeal, daysInStage: -1 })).toThrow();
  });
  it("отклоняет некорректный updatedAt (не UTC)", () => {
    expect(() => Deal.parse({ ...validDeal, updatedAt: "2026-06-20T10:00:00+03:00" })).toThrow();
  });
  it("отклоняет лишние поля (.strict)", () => {
    expect(() => Deal.parse({ ...validDeal, extra: "x" })).toThrow();
  });
});
