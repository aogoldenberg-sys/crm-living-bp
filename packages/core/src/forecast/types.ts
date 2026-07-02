import type { IsoDate, Kopecks } from "@crm/schemas";

/**
 * Параметры симуляции вынесены в конфиг, чтобы тесты меняли iterations и σ
 * без изменения бизнес-логики. Все вероятностные параметры — данные, не хардкод.
 */
export interface ForecastConfig {
  horizonDays: number;
  /** Число MC-итераций. Дефолт 10_000 в prod, 1_000 в тестах для скорости. */
  iterations: number;
  /** σ дневной выручки, безразмерная (0..1). 0.15 = ±15% от ожидаемой суммы. */
  revenueVolatility: number;
  /** Среднее смещение оплаты от момента сделки в днях. */
  paymentDelayDays: number;
  /** σ задержки оплаты в днях. */
  paymentDelayStdDev: number;
  /** Вероятность отвала лида до оплаты (0..1). */
  leadDropoutRate: number;
}

/** Сделка из реального CRM-пайплайна для детерминированного прогноза. */
export interface PipelineDeal {
  /** Expected payment date (best estimate). */
  expectedPaymentDate: IsoDate;
  /** Deal amount in kopecks. */
  amountKopecks: Kopecks;
  /** Win probability 0..1. */
  probability: number;
}

/** Постоянные входные данные для прогноза — не изменяются между итерациями. */
export interface ForecastPlan {
  startDate: IsoDate;
  /** Постоянный отток: аренда + ФОТ + прочие фиксированные расходы в день. */
  fixedDailyOutflow: Kopecks;
  /** Fallback: ожидаемое среднее число сделок в день (используется если pipeline пуст). */
  expectedDailyDeals: number;
  /** Средний чек в копейках. */
  avgDealAmountKopecks: Kopecks;
  /** Real pipeline deals from CRM. If provided, used instead of synthetic flow. */
  pipeline?: PipelineDeal[];
}

export interface DailyBalance {
  date: IsoDate;
  p10: Kopecks;
  p50: Kopecks;
  p90: Kopecks;
}

export interface CashForecast {
  generatedAt: IsoDate;
  horizonDays: number;
  dailyBalances: DailyBalance[];
  /**
   * Первый день, где p50 < 0 (медианный сценарий — денег не хватает).
   * Основной сигнал тревоги UI. null = медиана всегда ≥ 0.
   */
  gapDate: IsoDate | null;
  /** p50-баланс в день gapDate. null если gapDate = null. */
  gapAmount: Kopecks | null;
  /**
   * Первый день, где p90 < 0 (95% сценариев лучше, т.е. разрыв только в 10%).
   * "Оптимистичный" порог — наступает позже gapDate.
   * null = даже оптимистичный сценарий не уходит в минус.
   */
  hardGapDate: IsoDate | null;
  /**
   * Первый день, где p10 < 0 (10% худших сценариев — ранний тревожный сигнал).
   * "Пессимистичный" порог — наступает раньше gapDate.
   */
  pessimisticGapDate: IsoDate | null;
  /**
   * Доля итераций (0..1), где баланс не уходил в минус ни разу за весь горизонт.
   * Мерит «как часто» — не «когда». Возможна ситуация: confidence=0.8, gapDate=null.
   * UI обязан показывать оба поля вместе: gapDate — сигнал тревоги, confidence — её вероятность.
   */
  confidence: number;
}
