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
  /** Первый день, где p10 < 0. null = разрывов нет на горизонте. */
  gapDate: IsoDate | null;
  /** p10-баланс в день разрыва. null если разрыва нет. */
  gapAmount: Kopecks | null;
  /** Доля итераций, где баланс не уходил в минус ни разу. */
  confidence: number;
}
