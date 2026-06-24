import { describe, it, expect, vi } from "vitest";
import { replayAt } from "./replay.js";
import { mulberry32 } from "./forecast/prng.js";
import type { BusinessEvent, IsoDate } from "@crm/schemas";
import type { ForecastConfig, ForecastPlan } from "./forecast/types.js";
import type { PlanAssumptions } from "./planfact/alerts.js";

// --- фабрики тестовых событий ---

function makePaymentIn(opts: { eventId: string; valueDate: IsoDate; amount: number }): BusinessEvent {
  return {
    type: "payment_in",
    eventId: opts.eventId,
    ts: `${opts.valueDate}T10:00:00Z`,
    valueDate: opts.valueDate,
    amount: opts.amount,
    counterpartyInn: null,
    counterpartyName: "ООО Тест",
    purpose: "Оплата",
    matchedInvoiceId: null,
    source: "manual",
    businessId: "demo",
  };
}

function makeLeadCaptured(opts: { eventId: string; ts: string }): BusinessEvent {
  return {
    type: "lead_captured",
    eventId: opts.eventId,
    ts: opts.ts,
    leadId: opts.eventId,
    channel: "website",
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    contactPhone: null,
    contactEmail: null,
    source: "manual",
    businessId: "demo",
  };
}

function makePaymentCorrection(opts: { eventId: string; ts: string; correctedEventId: string }): BusinessEvent {
  return {
    type: "payment_correction",
    eventId: opts.eventId,
    ts: opts.ts,
    correctedEventId: opts.correctedEventId,
    reason: "Ошибка ввода",
    source: "manual",
    businessId: "demo",
  };
}

// --- фиксированные конфиги для тестов ---

const BASE_DATE = "2026-06-15" as IsoDate;

const basePlan: ForecastPlan = {
  startDate: BASE_DATE, // будет переопределён в replayAt
  fixedDailyOutflow: 10_000_00,
  expectedDailyDeals: 2,
  avgDealAmountKopecks: 50_000_00,
};

const baseConfig: ForecastConfig = {
  horizonDays: 30,
  iterations: 100,          // мало итераций — тесты быстрые
  revenueVolatility: 0.1,
  paymentDelayDays: 0,
  paymentDelayStdDev: 0,
  leadDropoutRate: 0.0,
};

const baseAssumptions: PlanAssumptions = {
  revenuePlan: 1_000_000_00,
  fixedCostsPlan: 500_000_00,
  conversionPct: 20,
  cacPlan: 5_000_00,
  cacFact: 0,
};

// --- тесты ---

describe("replayAt", () => {
  // a) Детерминизм: тот же seed + те же события + та же дата → идентичный результат
  it("детерминизм: seed=42, одни и те же events → идентичный ReplayState", () => {
    const events: BusinessEvent[] = [
      makePaymentIn({ eventId: "aaaaaaaa-0000-0000-0000-000000000001", valueDate: "2026-06-10", amount: 200_000 }),
    ];

    const r1 = replayAt(events, BASE_DATE, basePlan, baseAssumptions, baseConfig, mulberry32(42));
    const r2 = replayAt(events, BASE_DATE, basePlan, baseAssumptions, baseConfig, mulberry32(42));

    expect(r1).toEqual(r2);
  });

  // b) Фильтр включает день X: событие с valueDate === date попадает в метрики
  it("фильтр включает событие с valueDate === date", () => {
    const date = "2026-06-15" as IsoDate;
    const events: BusinessEvent[] = [
      makePaymentIn({ eventId: "aaaaaaaa-0000-0000-0000-000000000001", valueDate: date, amount: 100_000 }),
    ];

    const result = replayAt(events, date, basePlan, baseAssumptions, baseConfig, mulberry32(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.metrics.totalIn).toBe(100_000);
    expect(result.value.eventsConsidered).toBe(1);
  });

  // c) Фильтр исключает день X+1: событие с valueDate === date+1 НЕ попадает
  it("фильтр исключает событие с valueDate === date+1", () => {
    const date = "2026-06-15" as IsoDate;
    const nextDay = "2026-06-16" as IsoDate;
    const events: BusinessEvent[] = [
      makePaymentIn({ eventId: "aaaaaaaa-0000-0000-0000-000000000001", valueDate: nextDay, amount: 999_999 }),
    ];

    const result = replayAt(events, date, basePlan, baseAssumptions, baseConfig, mulberry32(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.metrics.totalIn).toBe(0);
    expect(result.value.eventsConsidered).toBe(0);
  });

  // d) Пустая история: events=[] → ok: true, metrics.totalIn=0, alerts=[]
  //    Для пустых алертов нужны нулевые планы: deriveAlerts пропускает метрики
  //    с plan=0 (revenuePlan=0, fixedCostsPlan=0, conversionPct=0, cacPlan=0).
  //    Это корректное поведение системы — «план не задан» ≠ «нарушение плана».
  it("пустая история: ok=true, нулевые метрики, пустые алерты", () => {
    const noAlertAssumptions: PlanAssumptions = {
      revenuePlan: 0,
      fixedCostsPlan: 0,
      conversionPct: 0,
      cacPlan: 0,
      cacFact: 0,
    };
    const result = replayAt([], BASE_DATE, basePlan, noAlertAssumptions, baseConfig, mulberry32(7));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.metrics.totalIn).toBe(0);
    expect(result.value.metrics.totalOut).toBe(0);
    expect(result.value.metrics.netCash).toBe(0);
    expect(result.value.alerts).toEqual([]);
    expect(result.value.eventsConsidered).toBe(0);
  });

  // e) eventsConsidered считает только отфильтрованные события;
  //    payment_correction (без valueDate) фильтруется по ts.slice(0,10)
  it("eventsConsidered: payment_correction фильтруется по ts, а не valueDate", () => {
    const date = "2026-06-15" as IsoDate;
    const paymentId = "aaaaaaaa-0000-0000-0000-000000000001";

    const events: BusinessEvent[] = [
      // PaymentIn с valueDate до date — попадает
      makePaymentIn({ eventId: paymentId, valueDate: "2026-06-14", amount: 50_000 }),
      // PaymentCorrection с ts в тот же день — попадает (ts.slice(0,10) === date)
      makePaymentCorrection({
        eventId: "cccccccc-0000-0000-0000-000000000001",
        ts: `${date}T09:00:00Z`,
        correctedEventId: paymentId,
      }),
      // PaymentIn с valueDate после date — НЕ попадает
      makePaymentIn({ eventId: "aaaaaaaa-0000-0000-0000-000000000002", valueDate: "2026-06-16", amount: 999_999 }),
    ];

    const result = replayAt(events, date, basePlan, baseAssumptions, baseConfig, mulberry32(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 2 события попало (payment_in + payment_correction), 1 исключено
    expect(result.value.eventsConsidered).toBe(2);
    // PaymentIn аннулирован коррекцией — totalIn = 0
    expect(result.value.metrics.totalIn).toBe(0);
  });

  // f) Композиция: plan.startDate в forecastCash вызывается с date, не оригинальным планом
  it("forecastCash получает plan.startDate === date, не оригинальный startDate", () => {
    // Оригинальный план имеет startDate в прошлом
    const planWithOldDate: ForecastPlan = {
      ...basePlan,
      startDate: "2020-01-01" as IsoDate,
    };
    const date = "2026-06-15" as IsoDate;

    const result = replayAt([], date, planWithOldDate, baseAssumptions, baseConfig, mulberry32(42));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // generatedAt в CashForecast = plan.startDate переданный в forecastCash = date
    expect(result.value.forecast.generatedAt).toBe(date);
    // asOfDate тоже равен date
    expect(result.value.asOfDate).toBe(date);
  });

  // Дополнительно: lead_captured фильтруется по ts.slice(0,10)
  it("lead_captured фильтруется по ts (не valueDate)", () => {
    const date = "2026-06-15" as IsoDate;
    const events: BusinessEvent[] = [
      // ts в тот же день — попадает
      makeLeadCaptured({ eventId: "lead-00000001", ts: `${date}T08:00:00Z` }),
      // ts после date — НЕ попадает
      makeLeadCaptured({ eventId: "lead-00000002", ts: "2026-06-16T08:00:00Z" }),
    ];

    const result = replayAt(events, date, basePlan, baseAssumptions, baseConfig, mulberry32(3));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.eventsConsidered).toBe(1);
    expect(result.value.metrics.leadsCount).toBe(1);
  });

  // Без мутаций: исходный массив events не изменяется
  it("не мутирует входной массив events", () => {
    const events: BusinessEvent[] = [
      makePaymentIn({ eventId: "aaaaaaaa-0000-0000-0000-000000000003", valueDate: "2026-06-20", amount: 1_000 }),
      makePaymentIn({ eventId: "aaaaaaaa-0000-0000-0000-000000000001", valueDate: "2026-06-10", amount: 2_000 }),
    ];
    const originalOrder = events.map((e) => e.eventId);

    replayAt(events, BASE_DATE, basePlan, baseAssumptions, baseConfig, mulberry32(99));

    expect(events.map((e) => e.eventId)).toEqual(originalOrder);
  });
});
