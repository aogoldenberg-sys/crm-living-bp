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

/** Постоянные входные данные для прогноза — не изменяются между итерациями. */
export interface ForecastPlan {
  startDate: IsoDate;
  /** Постоянный отток: аренда + ФОТ + прочие фиксированные расходы в день. */
  fixedDailyOutflow: Kopecks;
  /** Ожидаемое среднее число сделок в день. */
  expectedDailyDeals: number;
  /** Средний чек в копейках. */
  avgDealAmountKopecks: Kopecks;
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
   * Первый день, где p10 < 0.
   * p10 < 0 = в 10% худших сценариев деньги закончились в этот день.
   * null = разрыва нет даже в пессимистичном сценарии.
   * Мерит «когда» — не «как часто». Для «как часто» см. confidence.
   */
  gapDate: IsoDate | null;
  /** p10-баланс в день разрыва. null если gapDate = null. */
  gapAmount: Kopecks | null;
  /**
   * Доля итераций (0..1), где баланс не уходил в минус ни разу за весь горизонт.
   * Мерит «как часто» — не «когда». Возможна ситуация: confidence=0.8, gapDate=null.
   * Это значит: p10 > 0 во все дни, но 20% прогонов уходят в минус хотя бы раз.
   * UI обязан показывать оба поля вместе: gapDate — сигнал тревоги, confidence — её вероятность.
   */
  confidence: number;
}
