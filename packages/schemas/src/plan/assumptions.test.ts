import { describe, it, expect } from "vitest";
import {
  AssumptionValuePoint,
  AssumptionValueRange,
  AssumptionValue,
  Verifiability,
  Assumption,
  AssumptionSet,
} from "./assumptions.js";

// ── Валидные фикстуры ─────────────────────────────────────────────────────────

const validVerifiability = {
  verifiableBy: null,
  afterEvent: null,
};

const validVerifiabilityFull = {
  verifiableBy: "OTA_stats",
  afterEvent: "4 недели после открытия",
};

const validAssumptionPoint: Assumption = {
  key: "capex_total",
  value: { point: 3_179_000_000 },
  unit: "₽",
  origin: "ai_extracted",
  confidence: 0.9,
  sourceSection: "finances",
  verifiability: validVerifiability,
};

const validAssumptionRange: Assumption = {
  key: "occupancy_summer",
  value: { lo: 70, hi: 90 },
  unit: "%",
  origin: "human",
  confidence: 0.7,
  sourceSection: "unit_economics",
  verifiability: validVerifiabilityFull,
};

const validAssumptionComputed: Assumption = {
  key: "trip_check",
  value: { point: 15_000_000 },
  unit: "₽",
  origin: "computed",
  confidence: 0.85,
  sourceSection: null,
  verifiability: { verifiableBy: "accounting", afterEvent: "первый полный сезон" },
};

// ── ПОЗИТИВНЫЕ тесты ──────────────────────────────────────────────────────────

describe("ПОЗИТИВНЫЕ: AssumptionValuePoint", () => {
  it("принимает точечное значение", () => {
    expect(AssumptionValuePoint.parse({ point: 3_179_000_000 })).toEqual({ point: 3_179_000_000 });
  });

  it("принимает отрицательную точку", () => {
    expect(AssumptionValuePoint.parse({ point: -1 })).toEqual({ point: -1 });
  });

  it("принимает нулевую точку", () => {
    expect(AssumptionValuePoint.parse({ point: 0 })).toEqual({ point: 0 });
  });
});

describe("ПОЗИТИВНЫЕ: AssumptionValueRange", () => {
  it("принимает диапазон lo/hi", () => {
    expect(AssumptionValueRange.parse({ lo: 300_000_000, hi: 500_000_000 })).toEqual({
      lo: 300_000_000,
      hi: 500_000_000,
    });
  });
});

describe("ПОЗИТИВНЫЕ: AssumptionValue union", () => {
  it("принимает point-форму", () => {
    expect(AssumptionValue.parse({ point: 42 })).toEqual({ point: 42 });
  });

  it("принимает range-форму", () => {
    expect(AssumptionValue.parse({ lo: 10, hi: 20 })).toEqual({ lo: 10, hi: 20 });
  });
});

describe("ПОЗИТИВНЫЕ: Verifiability", () => {
  it("принимает null/null (pre-revenue)", () => {
    expect(Verifiability.parse(validVerifiability)).toEqual(validVerifiability);
  });

  it("принимает строки (post-revenue)", () => {
    expect(Verifiability.parse(validVerifiabilityFull)).toEqual(validVerifiabilityFull);
  });
});

describe("ПОЗИТИВНЫЕ: Assumption — все 3 origin", () => {
  it("origin=ai_extracted", () => {
    expect(Assumption.parse(validAssumptionPoint)).toEqual(validAssumptionPoint);
  });

  it("origin=human", () => {
    expect(Assumption.parse(validAssumptionRange)).toEqual(validAssumptionRange);
  });

  it("origin=computed", () => {
    expect(Assumption.parse(validAssumptionComputed)).toEqual(validAssumptionComputed);
  });
});

describe("ПОЗИТИВНЫЕ: AssumptionSet с несколькими ключами", () => {
  it("принимает набор из 3 гипотез", () => {
    const set: AssumptionSet = {
      capex_total: validAssumptionPoint,
      occupancy_summer: validAssumptionRange,
      trip_check: validAssumptionComputed,
    };
    expect(AssumptionSet.parse(set)).toEqual(set);
  });

  it("принимает пустой набор", () => {
    expect(AssumptionSet.parse({})).toEqual({});
  });
});

// ── НЕГАТИВНЫЕ тесты (≥ позитивных) ──────────────────────────────────────────

describe("НЕГАТИВНЫЕ: AssumptionValue — пустой объект", () => {
  it("value = {} → throws (ни point, ни lo/hi)", () => {
    expect(() => AssumptionValue.parse({})).toThrow();
  });
});

describe("НЕГАТИВНЫЕ: AssumptionValue — смешанные поля", () => {
  it("value = { point: 1, lo: 2 } → throws (strict: point-ветка отклоняет lo)", () => {
    expect(() => AssumptionValue.parse({ point: 1, lo: 2 })).toThrow();
  });

  it("value = { lo: 1, point: 5 } → throws (strict: range-ветка отклоняет point)", () => {
    expect(() => AssumptionValue.parse({ lo: 1, point: 5 })).toThrow();
  });
});

describe("НЕГАТИВНЫЕ: Assumption — неверный origin", () => {
  it("origin='manual' → throws", () => {
    expect(() =>
      Assumption.parse({ ...validAssumptionPoint, origin: "manual" }),
    ).toThrow();
  });

  it("origin='' (пустая строка) → throws", () => {
    expect(() =>
      Assumption.parse({ ...validAssumptionPoint, origin: "" }),
    ).toThrow();
  });
});

describe("НЕГАТИВНЫЕ: Assumption — confidence вне диапазона", () => {
  it("confidence = -0.1 → throws", () => {
    expect(() =>
      Assumption.parse({ ...validAssumptionPoint, confidence: -0.1 }),
    ).toThrow();
  });

  it("confidence = 1.1 → throws", () => {
    expect(() =>
      Assumption.parse({ ...validAssumptionPoint, confidence: 1.1 }),
    ).toThrow();
  });
});

describe("НЕГАТИВНЫЕ: Verifiability — пропущено поле afterEvent", () => {
  it("strict: отсутствие afterEvent → throws", () => {
    expect(() =>
      Verifiability.parse({ verifiableBy: null }),
    ).toThrow();
  });
});

describe("НЕГАТИВНЫЕ: Verifiability — неверный тип verifiableBy", () => {
  it("verifiableBy = 123 (число, не строка и не null) → throws", () => {
    expect(() =>
      Verifiability.parse({ verifiableBy: 123, afterEvent: null }),
    ).toThrow();
  });
});

describe("НЕГАТИВНЫЕ: Assumption — лишнее поле (.strict)", () => {
  it("extra field 'note' → throws", () => {
    expect(() =>
      Assumption.parse({ ...validAssumptionPoint, note: "extra" }),
    ).toThrow();
  });
});

describe("НЕГАТИВНЫЕ: Assumption — пропущен key", () => {
  it("key отсутствует → throws", () => {
    const { key: _key, ...withoutKey } = validAssumptionPoint;
    expect(() => Assumption.parse(withoutKey)).toThrow();
  });
});

describe("НЕГАТИВНЫЕ: Assumption — key пустая строка", () => {
  it("key = '' → throws (min 1)", () => {
    expect(() =>
      Assumption.parse({ ...validAssumptionPoint, key: "" }),
    ).toThrow();
  });
});

describe("НЕГАТИВНЫЕ: Assumption — unit пустая строка", () => {
  it("unit = '' → throws (min 1)", () => {
    expect(() =>
      Assumption.parse({ ...validAssumptionPoint, unit: "" }),
    ).toThrow();
  });
});

describe("НЕГАТИВНЫЕ: AssumptionSet — значение не является Assumption", () => {
  it("{ key: { foo: 'bar' } } → throws", () => {
    expect(() =>
      AssumptionSet.parse({ occupancy: { foo: "bar" } }),
    ).toThrow();
  });
});
