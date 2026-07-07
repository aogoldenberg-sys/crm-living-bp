import { describe, it, expect } from "vitest";
import { classifyDocument } from "./docToSections.js";
import { deriveGaps } from "./gapAnalysis.js";
import { salesFromLedger } from "./salesFromLedger.js";
import { strategyFromFact } from "./strategyFromFact.js";
import { roadmapFromStrategy } from "./roadmapFromStrategy.js";
import type { BusinessEvent } from "@crm/schemas";

const NOW = "2026-07-07T00:00:00Z";
const BID = "biz-001";

function mkIn(id: string, date: string, amount: number, purpose = "оплата услуг"): BusinessEvent {
  return { type: "payment_in", eventId: id, ts: NOW, valueDate: date,
    amount, counterpartyInn: null, counterpartyName: "Клиент",
    purpose, matchedInvoiceId: null, source: "manual", businessId: BID };
}
function mkOut(id: string, date: string, amount: number): BusinessEvent {
  return { type: "payment_out", eventId: id, ts: NOW, valueDate: date,
    amount, counterpartyInn: null, counterpartyName: "Поставщик",
    purpose: "аренда", expenseCategory: "opex", source: "manual", businessId: BID };
}

// 12 месяцев с ростом
const EVENTS_12M: BusinessEvent[] = Array.from({ length: 12 }, (_, i) => {
  const m = String(i + 1).padStart(2, "0");
  return [
    mkIn(`in-${i}`, `2026-${m}-15`, (100_000 + i * 10_000) * 100),
    mkOut(`out-${i}`, `2026-${m}-20`, 50_000 * 100),
  ];
}).flat();

describe("classifyDocument", () => {
  it("bank_statement → finances for financial text", () => {
    const pages = ["выписка по счёту, оборот, баланс касса"];
    const result = classifyDocument("bank_statement", pages);
    expect(result).toHaveLength(1);
    expect(result[0]!.sectionId).toBe("finances");
  });
  it("empty pages → empty result", () => {
    expect(classifyDocument("other", [""])).toHaveLength(0);
  });
  it("team keywords → team section", () => {
    const result = classifyDocument("staff_schedule", ["штатное расписание директор сотрудник"]);
    expect(result[0]?.sectionId).toBe("team");
  });
});

describe("deriveGaps", () => {
  it("no mapped sections → all 22 sections are gaps", () => {
    const gaps = deriveGaps([]);
    expect(gaps).toHaveLength(22);
  });
  it("finances mapped → not in gaps", () => {
    const gaps = deriveGaps([{ sectionId: "finances", pageRange: [1, 1], confidence: 0.9 }]);
    expect(gaps.find(g => g.sectionId === "finances")).toBeUndefined();
  });
  it("canInfer=true for inferrable sections", () => {
    const gaps = deriveGaps([]);
    const finGap = gaps.find(g => g.sectionId === "finances");
    expect(finGap?.canInfer).toBe(true);
  });
  it("team gap has requiredDocKind=staff_schedule", () => {
    const gaps = deriveGaps([]);
    expect(gaps.find(g => g.sectionId === "team")?.requiredDocKind).toBe("staff_schedule");
  });
});

describe("salesFromLedger — 12 months", () => {
  it("returns 12 months", () => {
    const result = salesFromLedger(EVENTS_12M);
    expect(result).toHaveLength(12);
  });
  it("revenue increases each month", () => {
    const result = salesFromLedger(EVENTS_12M);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.revenueKopecks).toBeGreaterThan(result[i-1]!.revenueKopecks);
    }
  });
  it("filters out loans", () => {
    const withLoan: BusinessEvent[] = [
      mkIn("loan", "2026-01-10", 1_000_000_00, "возврат займа"),
      ...EVENTS_12M,
    ];
    const withoutLoan = salesFromLedger(EVENTS_12M);
    const withLoanResult = salesFromLedger(withLoan);
    expect(withLoanResult[0]!.revenueKopecks).toBe(withoutLoan[0]!.revenueKopecks);
  });
});

describe("strategyFromFact — confidence gate", () => {
  it("insufficient data → verdict insufficient_data", () => {
    const result = strategyFromFact([mkIn("1", "2026-01-01", 100_00)], {});
    expect(result.verdict).toBe("insufficient_data");
  });
  it("growing revenue → keep_current", () => {
    const growing = [
      mkIn("a", "2026-05-01", 100_000_00),
      mkIn("b", "2026-05-15", 100_000_00),
      mkIn("c", "2026-05-20", 100_000_00),
      mkIn("d", "2026-06-01", 200_000_00),
      mkIn("e", "2026-06-10", 200_000_00),
      mkIn("f", "2026-06-20", 200_000_00),
    ];
    const result = strategyFromFact(growing, {});
    expect(result.verdict).toBe("keep_current");
  });
  it("flat revenue → new_strategy", () => {
    const flat = [
      ...Array.from({length:3}, (_,i) => mkIn(`a${i}`, "2026-05-01", 100_000_00)),
      ...Array.from({length:3}, (_,i) => mkIn(`b${i}`, "2026-06-01", 100_000_00)),
    ];
    const result = strategyFromFact(flat, {});
    expect(result.verdict).toBe("new_strategy");
  });
});

describe("roadmapFromStrategy", () => {
  it("insufficient_data → humanTasks only", () => {
    const result = roadmapFromStrategy({ verdict: "insufficient_data", rationale: "", goals: [] });
    expect(result.items).toHaveLength(0);
    expect(result.humanTasks.length).toBeGreaterThan(0);
  });
  it("new_strategy → humanTasks include meeting", () => {
    const result = roadmapFromStrategy({ verdict: "new_strategy", rationale: "low growth", goals: ["цель 1"] });
    expect(result.humanTasks.some(t => t.sectionRef === "product_roadmap")).toBe(true);
  });
});
