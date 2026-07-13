import { describe, it, expect } from "vitest";
import { buildOwnerReport } from "./build.js";
import { formatTelegram, formatTelegramForRole } from "./format.js";
import type { BusinessEvent } from "@crm/schemas";
import type { CashForecast } from "../forecast/types.js";

const NOW = "2026-07-14T06:00:00Z"; // Понедельник → период = прошлая неделя

const PAYMENT: BusinessEvent = {
  type: "payment_in",
  eventId: "00000000-0000-0000-0000-000000000001",
  ts: "2026-07-08T10:00:00Z",
  valueDate: "2026-07-08",
  amount: 100_000_00,
  counterpartyInn: null,
  counterpartyName: "ООО Тест",
  purpose: "Оплата услуг",
  matchedInvoiceId: null,
  source: "bank_api",
  businessId: "biz1",
};

const FORECAST: CashForecast = {
  generatedAt: "2026-07-14",
  horizonDays: 90,
  dailyBalances: [],
  gapDate: null,
  gapAmount: null,
  hardGapDate: null,
  pessimisticGapDate: null,
  confidence: 0.72,
};

describe("buildOwnerReport", () => {
  it("пустой лог → доклад с disclaimer", () => {
    const r = buildOwnerReport("biz1", [], null, NOW);
    expect(r.recommendation).toBeNull();
    expect(r.cash.confidence).toBeLessThan(0.4);
    expect(r.topDeviations).toHaveLength(0);
  });

  it("синтетический лог (≥10 событий) → confidence выше", () => {
    const events: BusinessEvent[] = Array.from({ length: 15 }, (_, i) => ({
      ...PAYMENT,
      eventId: `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`,
    }));
    const r = buildOwnerReport("biz1", events, FORECAST, NOW);
    expect(r.businessId).toBe("biz1");
    expect(r.cash.confidence).toBeGreaterThanOrEqual(0.4);
    expect(r.deliveredTo).toHaveLength(0);
  });

  it("gap в прогнозе → рекомендация содержит дату разрыва", () => {
    const withGap: CashForecast = { ...FORECAST, gapDate: "2026-08-15", gapAmount: -200_000_00, confidence: 0.65 };
    const events: BusinessEvent[] = Array.from({ length: 15 }, (_, i) => ({
      ...PAYMENT,
      eventId: `00000000-0000-0000-0000-${String(i + 100).padStart(12, "0")}`,
    }));
    const r = buildOwnerReport("biz1", events, withGap, NOW);
    expect(r.recommendation).toContain("2026-08-15");
    expect(r.cash.gapDate).toBe("2026-08-15");
  });
});

describe("formatTelegram", () => {
  it("результат ≤ 3500 символов на длинных данных", () => {
    const r = buildOwnerReport("longbiz", [], null, NOW);
    const r2: typeof r = {
      ...r,
      topDeviations: [
        { metric: "revenue", planValue: 1_000_000_00, factValue: 700_000_00, deviationPct: -30, causeChain: ["снижение трафика", "рост отказов"] },
        { metric: "expenses", planValue: 500_000_00, factValue: 650_000_00, deviationPct: 30, causeChain: ["рост аренды"] },
        { metric: "deals", planValue: 100_00, factValue: 60_00, deviationPct: -40, causeChain: [] },
      ],
      recommendation: "A".repeat(1000),
    };
    expect(formatTelegram(r2).length).toBeLessThanOrEqual(3500);
  });

  it("без gap → нет строки «Кассовый разрыв»", () => {
    const r = buildOwnerReport("biz1", [], null, NOW);
    expect(formatTelegram(r)).not.toContain("Кассовый разрыв:");
  });

  it("с gap → строка с ⚠️ есть", () => {
    const r = buildOwnerReport("biz1", [], { ...FORECAST, gapDate: "2026-09-01", gapAmount: null }, NOW);
    expect(formatTelegram(r)).toContain("Кассовый разрыв");
  });
});

describe("formatTelegramForRole", () => {
  const BASE = buildOwnerReport(
    "biz1",
    Array.from({ length: 15 }, (_, i) => ({
      ...({
        type: "payment_in",
        eventId: `00000000-0000-0000-0000-${String(i + 200).padStart(12, "0")}`,
        ts: "2026-07-08T10:00:00Z",
        valueDate: "2026-07-08",
        amount: 100_000_00,
        counterpartyInn: null,
        counterpartyName: "ООО Тест",
        purpose: "Оплата услуг",
        matchedInvoiceId: null,
        source: "bank_api" as const,
        businessId: "biz1",
      }),
    })),
    { ...FORECAST, gapDate: "2026-08-20", gapAmount: -50_000_00, confidence: 0.65 },
    NOW,
  );

  it("sections:[] → строка 'Нет доступных разделов'", () => {
    expect(formatTelegramForRole(BASE, [])).toBe("Нет доступных разделов");
  });

  it("sections:['cash'] → есть слово 'Остаток', нет слова 'Отклонения'", () => {
    const text = formatTelegramForRole(BASE, ["cash"]);
    expect(text).toContain("Остаток");
    expect(text).not.toContain("Отклонения");
  });

  it("sections:['deviations'] → нет суммы баланса и нет даты gap", () => {
    const withDeviations = {
      ...BASE,
      topDeviations: [
        { metric: "revenue", planValue: 1_000_000_00, factValue: 700_000_00, deviationPct: -30, causeChain: ["снижение трафика"] },
      ],
    };
    const text = formatTelegramForRole(withDeviations, ["deviations"]);
    expect(text).not.toContain("Остаток");
    expect(text).not.toContain("2026-08-20"); // gapDate не должен появляться
    expect(text).toContain("revenue");
  });

  it("sections:['recommendation'] → только рекомендация", () => {
    const withRec = { ...BASE, recommendation: "Ускорить сбор дебиторки." };
    const text = formatTelegramForRole(withRec, ["recommendation"]);
    expect(text).toContain("Ускорить сбор дебиторки");
    expect(text).not.toContain("Остаток");
  });
});
