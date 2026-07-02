import { describe, it, expect } from "vitest";
import { mulberry32 } from "./prng.js";
import { forecastCash } from "./forecast.js";
import type { ForecastConfig, ForecastPlan } from "./types.js";
import type { BusinessEvent } from "@crm/schemas";

// Пустой лог событий — начальный баланс = 0.
const noEvents: BusinessEvent[] = [];

const baseConfig: ForecastConfig = {
  horizonDays: 90,
  iterations: 1_000,
  revenueVolatility: 0.15,
  paymentDelayDays: 2,
  paymentDelayStdDev: 1,
  leadDropoutRate: 0.1,
};

// Прибыльный план: задержка оплаты = 0, большой остаток через события ниже.
// paymentDelayDays=0 устраняет «дыру» первых дней при нулевом начальном балансе.
const profitablePlan: ForecastPlan = {
  startDate: "2026-01-01",
  fixedDailyOutflow: 10_000_00,        // 10 000 руб/день
  expectedDailyDeals: 5,
  avgDealAmountKopecks: 100_000_00,    // 100 000 руб чек
  // Ожидаемый доход ~450 000 руб/день (за вычетом дропаута)
};

const profitableConfig: ForecastConfig = {
  ...baseConfig,
  // Без задержки оплаты — деньги приходят в день сделки, разрыва не будет.
  paymentDelayDays: 0,
  paymentDelayStdDev: 0,
};

// Убыточный план: расходы >> доходы → кассовый разрыв гарантирован.
const lossPlan: ForecastPlan = {
  startDate: "2026-01-01",
  fixedDailyOutflow: 1_000_000_00,     // 1 000 000 руб/день
  expectedDailyDeals: 1,
  avgDealAmountKopecks: 1_000_00,      // 1 000 руб чек
};

describe("forecastCash", () => {
  it("dailyBalances.length === horizonDays", () => {
    const result = forecastCash(noEvents, profitablePlan, profitableConfig, mulberry32(42));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.dailyBalances).toHaveLength(baseConfig.horizonDays);
  });

  it("p10 <= p50 <= p90 для каждого дня", () => {
    const result = forecastCash(noEvents, profitablePlan, profitableConfig, mulberry32(42));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const day of result.value.dailyBalances) {
      expect(day.p10).toBeLessThanOrEqual(day.p50);
      expect(day.p50).toBeLessThanOrEqual(day.p90);
    }
  });

  it("gapDate = null при заведомо положительном балансе", () => {
    // paymentDelayDays=0: деньги приходят день-в-день, нет «дыры» первых дней.
    // Доход ~450 000 руб/день >> расход 10 000 руб/день.
    const result = forecastCash(noEvents, profitablePlan, profitableConfig, mulberry32(42));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.gapDate).toBeNull();
    expect(result.value.gapAmount).toBeNull();
  });

  it("gapDate установлен при заведомо убыточном балансе", () => {
    const result = forecastCash(noEvents, lossPlan, baseConfig, mulberry32(42));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.gapDate).not.toBeNull();
    expect(result.value.gapAmount).not.toBeNull();
    expect(result.value.pessimisticGapDate).not.toBeNull();

    // gapAmount < 0 (это и есть определение разрыва).
    if (result.value.gapAmount !== null) {
      expect(result.value.gapAmount).toBeLessThan(0);
    }
  });

  it("gapDate — первый день с p50 < 0", () => {
    const result = forecastCash(noEvents, lossPlan, baseConfig, mulberry32(42));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { dailyBalances, gapDate } = result.value;
    if (gapDate === null) return;

    // Все дни до gapDate: p50 >= 0.
    for (const day of dailyBalances) {
      if (day.date === gapDate) break;
      expect(day.p50).toBeGreaterThanOrEqual(0);
    }
  });

  it("pessimisticGapDate ≤ gapDate ≤ hardGapDate order", () => {
    const result = forecastCash(noEvents, lossPlan, baseConfig, mulberry32(42));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { pessimisticGapDate, gapDate, hardGapDate } = result.value;

    // pessimistic <= main <= hard (dates are ISO strings, lexicographic comparison works)
    if (pessimisticGapDate && gapDate) {
      expect(pessimisticGapDate <= gapDate).toBe(true);
    }
    if (gapDate && hardGapDate) {
      expect(gapDate <= hardGapDate).toBe(true);
    }
  });

  it("profitable plan has all gap dates null", () => {
    const result = forecastCash(noEvents, profitablePlan, profitableConfig, mulberry32(42));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.gapDate).toBeNull();
    expect(result.value.hardGapDate).toBeNull();
    expect(result.value.pessimisticGapDate).toBeNull();
  });

  it("детерминирован при одном seed", () => {
    const r1 = forecastCash(noEvents, profitablePlan, profitableConfig, mulberry32(42));
    const r2 = forecastCash(noEvents, profitablePlan, profitableConfig, mulberry32(42));

    expect(r1).toEqual(r2);
  });

  it("confidence в диапазоне [0, 1]", () => {
    const result = forecastCash(noEvents, profitablePlan, profitableConfig, mulberry32(42));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.confidence).toBeGreaterThanOrEqual(0);
    expect(result.value.confidence).toBeLessThanOrEqual(1);
  });

  it("ошибка при horizonDays = 0", () => {
    const badConfig: ForecastConfig = { ...baseConfig, horizonDays: 0 };
    const result = forecastCash(noEvents, profitablePlan, badConfig, mulberry32(42));
    expect(result.ok).toBe(false);
  });

  it("учитывает начальный баланс из событий", () => {
    // Добавляем крупное поступление — оно должно сдвинуть все балансы вверх.
    const richEvents: BusinessEvent[] = [
      {
        type: "payment_in",
        eventId: "00000000-0000-0000-0000-000000000001",
        ts: "2025-12-31T00:00:00Z",
        valueDate: "2025-12-31",
        amount: 50_000_000_00, // 50 млн руб
        counterpartyInn: "7700000001",
        counterpartyName: "ООО Тест",
        purpose: "Оплата",
        matchedInvoiceId: null,
        source: "manual",
        businessId: "demo",
      },
    ];

    const rng1 = mulberry32(42);
    const rng2 = mulberry32(42);

    const withRich = forecastCash(richEvents, lossPlan, baseConfig, rng1);
    const withEmpty = forecastCash(noEvents, lossPlan, baseConfig, rng2);

    expect(withRich.ok).toBe(true);
    expect(withEmpty.ok).toBe(true);
    if (!withRich.ok || !withEmpty.ok) return;

    // При крупном начальном балансе первый день должен быть лучше.
    const richDay0 = withRich.value.dailyBalances[0];
    const emptyDay0 = withEmpty.value.dailyBalances[0];
    if (!richDay0 || !emptyDay0) return;

    expect(richDay0.p50).toBeGreaterThan(emptyDay0.p50);
  });

  it("C2: balance_anchor используется как начальный баланс вместо событий", () => {
    // balance_anchor с большим балансом — должен сдвинуть прогноз вверх
    const anchorEvents: BusinessEvent[] = [
      {
        type: "balance_anchor",
        eventId: "00000000-0000-0000-0000-000000000002",
        ts: "2025-12-31T00:00:00Z",
        anchorDate: "2025-12-31",
        balanceKopecks: 50_000_000_00, // 50 млн руб
        source: "manual",
        businessId: "demo",
      },
    ];

    const rng1 = mulberry32(42);
    const rng2 = mulberry32(42);

    const withAnchor = forecastCash(anchorEvents, lossPlan, baseConfig, rng1);
    const withEmpty = forecastCash(noEvents, lossPlan, baseConfig, rng2);

    expect(withAnchor.ok).toBe(true);
    expect(withEmpty.ok).toBe(true);
    if (!withAnchor.ok || !withEmpty.ok) return;

    const anchorDay0 = withAnchor.value.dailyBalances[0];
    const emptyDay0 = withEmpty.value.dailyBalances[0];
    if (!anchorDay0 || !emptyDay0) return;

    expect(anchorDay0.p50).toBeGreaterThan(emptyDay0.p50);
  });

  it("C5: generatedAt параметр переопределяет plan.startDate", () => {
    const customDate = "2026-06-01" as import("@crm/schemas").IsoDate;
    const result = forecastCash(noEvents, profitablePlan, profitableConfig, mulberry32(42), customDate);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.generatedAt).toBe(customDate);
  });

  it("C5: generatedAt без параметра = plan.startDate", () => {
    const result = forecastCash(noEvents, profitablePlan, profitableConfig, mulberry32(42));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.generatedAt).toBe(profitablePlan.startDate);
  });
});
