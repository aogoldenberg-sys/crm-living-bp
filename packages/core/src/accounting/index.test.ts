import { describe, it, expect } from "vitest";
import { buildAccountingCards } from "./index.js";
import type { BusinessEvent } from "@crm/schemas";

let seq = 0;
function uid(): string {
  seq++;
  return `00000000-0000-0000-0000-${String(seq).padStart(12, "0")}`;
}

function makeIn(valueDate: string, amount: number): BusinessEvent {
  return {
    type: "payment_in",
    eventId: uid(),
    ts: `${valueDate}T00:00:00Z`,
    valueDate,
    amount,
    counterpartyInn: null,
    counterpartyName: "ООО Тест",
    purpose: "Оплата",
    matchedInvoiceId: null,
    source: "manual",
    businessId: "biz-1",
  } as unknown as BusinessEvent;
}

function makeOut(valueDate: string, amount: number): BusinessEvent {
  return {
    type: "payment_out",
    eventId: uid(),
    ts: `${valueDate}T00:00:00Z`,
    valueDate,
    amount,
    counterpartyInn: null,
    counterpartyName: "ООО Поставщик",
    purpose: "Оплата услуг",
    expenseCategory: "Операционные",
    source: "manual",
    businessId: "biz-1",
  } as unknown as BusinessEvent;
}

describe("buildAccountingCards", () => {
  it("3 месяца событий → 3 карточки с правильными суммами", () => {
    const events: BusinessEvent[] = [
      makeIn("2025-01-10", 100_000_00),
      makeOut("2025-01-15", 30_000_00),
      makeIn("2025-02-05", 200_000_00),
      makeOut("2025-02-20", 80_000_00),
      makeIn("2025-03-01", 50_000_00),
      makeOut("2025-03-25", 10_000_00),
    ];

    const cards = buildAccountingCards(events);
    const [jan, feb, mar] = cards;

    expect(cards).toHaveLength(3);

    expect(jan?.period).toBe("2025-01");
    expect(jan?.revenue).toBe(100_000_00);
    expect(jan?.expenses).toBe(30_000_00);
    expect(jan?.profit).toBe(70_000_00);
    expect(jan?.eventCount).toBe(2);

    expect(feb?.period).toBe("2025-02");
    expect(feb?.revenue).toBe(200_000_00);
    expect(feb?.expenses).toBe(80_000_00);
    expect(feb?.profit).toBe(120_000_00);

    expect(mar?.period).toBe("2025-03");
    expect(mar?.revenue).toBe(50_000_00);
    expect(mar?.expenses).toBe(10_000_00);
    expect(mar?.profit).toBe(40_000_00);
  });

  it("пустой массив → []", () => {
    expect(buildAccountingCards([])).toEqual([]);
  });

  it("только payment_in без payment_out → expenses = 0", () => {
    const events: BusinessEvent[] = [
      makeIn("2025-06-10", 500_000_00),
      makeIn("2025-06-20", 300_000_00),
    ];

    const cards = buildAccountingCards(events);
    const [jun] = cards;

    expect(cards).toHaveLength(1);
    expect(jun?.period).toBe("2025-06");
    expect(jun?.expenses).toBe(0);
    expect(jun?.revenue).toBe(800_000_00);
    expect(jun?.profit).toBe(800_000_00);
  });
});
