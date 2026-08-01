import { describe, it, expect } from "vitest";
import { computeArt236 } from "./art236.js";

describe("computeArt236", () => {
  it("одна задолженность, одна ставка", () => {
    const result = computeArt236({
      debts: [{ amountKopecks: 10_000_00, dueDate: "2025-03-01", paidDate: "2025-03-11" }],
      calcDate: "2025-03-31",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines).toHaveLength(1);
    const line = result.value.lines[0]!;
    // Период: 02.03 - 11.03 = 10 дней
    expect(line.days).toBe(10);
    expect(line.ratePercent).toBe(21);
    // 1_000_000 * (21/100/150) * 10 = 14000
    expect(line.compensationKopecks).toBe(14000);
    expect(result.value.totalKopecks).toBe(14000);
  });

  it("смена ставки — берёт ставку на начало периода", () => {
    // Период начинается 2024-07-30 (ставка 18%)
    const result = computeArt236({
      debts: [{ amountKopecks: 15_000_00, dueDate: "2024-07-29", paidDate: "2024-08-08" }],
      calcDate: "2024-08-08",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const line = result.value.lines[0]!;
    expect(line.ratePercent).toBe(18);
    expect(line.days).toBe(10);
  });

  it("contractRate выше ключевой — применяется contractRate", () => {
    const result = computeArt236({
      debts: [{ amountKopecks: 10_000_00, dueDate: "2025-03-01", paidDate: "2025-03-11" }],
      calcDate: "2025-03-31",
      contractRate: 30,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines[0]!.ratePercent).toBe(30);
  });

  it("paidDate null — расчёт до calcDate", () => {
    const result = computeArt236({
      debts: [{ amountKopecks: 5_000_00, dueDate: "2025-04-01", paidDate: null }],
      calcDate: "2025-04-11",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.lines[0]!.endDate).toBe("2025-04-11");
    expect(result.value.lines[0]!.days).toBe(10);
  });

  it("дата вне справочника ЦБ — ошибка", () => {
    const result = computeArt236({
      debts: [{ amountKopecks: 10_000_00, dueDate: "2022-01-01", paidDate: "2022-01-10" }],
      calcDate: "2022-01-10",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("[УТОЧНИТЬ: ключевая ставка]");
  });
});
