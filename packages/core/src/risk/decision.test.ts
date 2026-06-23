import { describe, it, expect } from "vitest";
import { decide } from "./decision.js";

// ── Вспомогательные фикстуры ──────────────────────────────────────────────────

const FULL_INPUTS = ["amount", "counterparty", "date", "purpose"];

function fullInput(overrides: Partial<Parameters<typeof decide>[0]> = {}) {
  return {
    inputsRequired: FULL_INPUTS,
    inputsPresent: [...FULL_INPUTS],
    confidence: 0.95,
    ...overrides,
  };
}

// ── Негативные сценарии (их должно быть >= позитивных) ───────────────────────

describe("insufficient_data", () => {
  it("completeness 0 → insufficient_data", () => {
    const out = decide({
      inputsRequired: FULL_INPUTS,
      inputsPresent: [],
      confidence: 0.99,
    });
    expect(out.verdict).toBe("insufficient_data");
    expect(out.completeness).toBe(0);
    expect(out.gaps).toEqual(FULL_INPUTS);
  });

  it("один из четырёх полей отсутствует → completeness 0.75 < 0.9 → insufficient_data", () => {
    const out = decide({
      inputsRequired: FULL_INPUTS,
      inputsPresent: ["amount", "counterparty", "date"],
      confidence: 0.99,
    });
    expect(out.verdict).toBe("insufficient_data");
    expect(out.completeness).toBeCloseTo(0.75);
    expect(out.gaps).toEqual(["purpose"]);
  });

  it("ровно на границе: completeness 0.89 → insufficient_data", () => {
    // 8 из 9 присутствуют → 8/9 ≈ 0.888
    const req = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
    const out = decide({
      inputsRequired: req,
      inputsPresent: req.slice(0, 8),
      confidence: 0.99,
    });
    expect(out.verdict).toBe("insufficient_data");
    expect(out.gaps).toHaveLength(1);
  });

  it("trail содержит правило с перечнем пропущенных полей", () => {
    const out = decide({
      inputsRequired: ["x", "y", "z"],
      inputsPresent: ["x"],
      confidence: 0.9,
    });
    expect(out.trail).toHaveLength(1);
    expect(out.trail[0]!.verdict).toBe("insufficient_data");
    expect(out.trail[0]!.rule).toContain("missing");
    expect(out.trail[0]!.rule).toContain("y");
    expect(out.trail[0]!.rule).toContain("z");
  });

  it("insufficient_data при высоком confidence не мешает — completeness первична", () => {
    const out = decide(fullInput({ inputsPresent: ["amount"] }));
    expect(out.verdict).toBe("insufficient_data");
  });
});

describe("ask_human", () => {
  it("все поля есть, confidence 0.5 → ask_human (ниже дефолтного 0.8)", () => {
    const out = decide(fullInput({ confidence: 0.5 }));
    expect(out.verdict).toBe("ask_human");
    expect(out.gaps).toHaveLength(0);
  });

  it("confidence ровно на пороге (< 0.8) → ask_human", () => {
    const out = decide(fullInput({ confidence: 0.7999 }));
    expect(out.verdict).toBe("ask_human");
  });

  it("кастомный confidenceThreshold 0.6: confidence 0.55 → ask_human", () => {
    const out = decide(fullInput({ confidence: 0.55, confidenceThreshold: 0.6 }));
    expect(out.verdict).toBe("ask_human");
  });

  it("кастомный confidenceThreshold 0.6: confidence 0.59 → ask_human", () => {
    const out = decide(fullInput({ confidence: 0.59, confidenceThreshold: 0.6 }));
    expect(out.verdict).toBe("ask_human");
  });

  it("trail содержит правило с порогом confidence", () => {
    const out = decide(fullInput({ confidence: 0.3 }));
    expect(out.trail[0]!.verdict).toBe("ask_human");
    expect(out.trail[0]!.rule).toContain("confidence");
  });
});

// ── Позитивные сценарии ───────────────────────────────────────────────────────

describe("act", () => {
  it("полный набор полей + высокий confidence → act", () => {
    const out = decide(fullInput());
    expect(out.verdict).toBe("act");
    expect(out.gaps).toHaveLength(0);
  });

  it("completeness ровно 1.0, confidence ровно на пороге → act", () => {
    const out = decide(fullInput({ confidence: 0.8 }));
    expect(out.verdict).toBe("act");
  });

  it("нет required полей вообще → completeness 1 → act (если confidence ок)", () => {
    const out = decide({
      inputsRequired: [],
      inputsPresent: [],
      confidence: 0.95,
    });
    expect(out.verdict).toBe("act");
    expect(out.completeness).toBe(1);
  });

  it("кастомный порог 0.6: confidence 0.65 → act", () => {
    const out = decide(fullInput({ confidence: 0.65, confidenceThreshold: 0.6 }));
    expect(out.verdict).toBe("act");
  });
});

// ── Инварианты структуры вывода ───────────────────────────────────────────────

describe("output structure", () => {
  it("gaps пуст при verdict=act", () => {
    const out = decide(fullInput());
    expect(out.gaps).toHaveLength(0);
  });

  it("gaps пуст при verdict=ask_human", () => {
    const out = decide(fullInput({ confidence: 0.1 }));
    expect(out.verdict).toBe("ask_human");
    expect(out.gaps).toHaveLength(0);
  });

  it("completeness всегда в [0, 1]", () => {
    for (const count of [0, 1, 2, 3, 4]) {
      const out = decide({
        inputsRequired: FULL_INPUTS,
        inputsPresent: FULL_INPUTS.slice(0, count),
        confidence: 0.99,
      });
      expect(out.completeness).toBeGreaterThanOrEqual(0);
      expect(out.completeness).toBeLessThanOrEqual(1);
    }
  });

  it("trail никогда не пуст — всегда минимум 1 шаг", () => {
    const cases = [
      fullInput(),
      fullInput({ confidence: 0.1 }),
      { inputsRequired: FULL_INPUTS, inputsPresent: [], confidence: 0.99 },
    ];
    for (const c of cases) {
      expect(decide(c).trail.length).toBeGreaterThan(0);
    }
  });

  it("inputsRequired и inputsPresent прокидываются без изменений", () => {
    const input = fullInput();
    const out = decide(input);
    expect(out.inputsRequired).toEqual(FULL_INPUTS);
    expect(out.inputsPresent).toEqual(FULL_INPUTS);
  });
});

// ── Regression: set-membership completeness ───────────────────────────────────

describe("completeness — set-membership, not length", () => {
  it("дубли в present не накручивают completeness — был баг: act при пустых gaps", () => {
    // required=[a,b,c], present=[a,a,x] — только 'a' из required присутствует
    // completeness = 1/3 < 0.9 → insufficient_data
    const out = decide({
      inputsRequired: ["a", "b", "c"],
      inputsPresent: ["a", "a", "x"],
      confidence: 0.99,
    });
    expect(out.completeness).toBeCloseTo(1 / 3);
    expect(out.verdict).toBe("insufficient_data");
    expect(out.gaps).toEqual(["b", "c"]);
    expect(out.trail[0]!.verdict).toBe("insufficient_data");
  });

  it("мусорные поля в present игнорируются", () => {
    // required=[a,b], present=[a,b,EXTRA,EXTRA2] → completeness = 1.0
    const out = decide({
      inputsRequired: ["a", "b"],
      inputsPresent: ["a", "b", "EXTRA", "EXTRA2"],
      confidence: 0.95,
    });
    expect(out.completeness).toBe(1);
    expect(out.verdict).toBe("act");
    expect(out.gaps).toHaveLength(0);
  });
});

// ── Guard: confidence/threshold ∈ [0, 1] ─────────────────────────────────────

describe("guard: значения вне диапазона [0,1]", () => {
  it("confidence = 5 → insufficient_data, не act", () => {
    const out = decide(fullInput({ confidence: 5 }));
    expect(out.verdict).toBe("insufficient_data");
    expect(out.trail[0]!.rule).toMatch(/out of \[0,1\] range/);
  });

  it("confidence = -0.1 → insufficient_data", () => {
    const out = decide(fullInput({ confidence: -0.1 }));
    expect(out.verdict).toBe("insufficient_data");
  });

  it("confidenceThreshold = 1.5 → insufficient_data", () => {
    const out = decide(fullInput({ confidenceThreshold: 1.5 }));
    expect(out.verdict).toBe("insufficient_data");
  });
});
