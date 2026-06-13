import { z } from "zod";
import { Kopecks, PositiveKopecks, IsoDate } from "../money.js";

/**
 * Снимок финансовых метрик за период.
 * Инварианты хранятся как данные, а не вычисляются на лету —
 * это позволяет сравнивать плановые и фактические значения без пересчёта.
 */
export const FinancialSnapshot = z.object({
  periodStart: IsoDate,
  periodEnd: IsoDate,
  revenue: PositiveKopecks,
  /** Переменные затраты включают только те статьи, что растут пропорционально выручке. */
  variableCosts: Kopecks.nonnegative(),
  fixedCosts: Kopecks.nonnegative(),
  /** grossProfit = revenue - variableCosts; хранится явно для быстрых дашбордов. */
  grossProfit: Kopecks,
  /** netProfit = grossProfit - fixedCosts */
  netProfit: Kopecks,
}).strict();

export type FinancialSnapshot = z.infer<typeof FinancialSnapshot>;

/**
 * Раздел «Финансовый анализ» живого бизнес-плана.
 * roi и paybackMonths — вычисленные метрики, но сохраняем их в схеме,
 * потому что план может быть «заморожен» на дату расчёта (версионирование).
 */
export const FinanceAnalysis = z.object({
  snapshotDate: IsoDate,
  /** Маржа брутто = (grossProfit / revenue) * 10000, хранится в базисных пунктах (0–10000). */
  grossMarginBps: z.number().int().min(0).max(10000),
  /** Маржа нетто в базисных пунктах. Может быть отрицательной на старте. */
  netMarginBps: z.number().int().min(-10000).max(10000),
  /**
   * Срок окупаемости в месяцах. null означает «не окупается при текущей модели» —
   * это легальное состояние для новых проектов и должно явно отображаться в UI.
   */
  paybackMonths: z.number().int().positive().nullable(),
  /**
   * ROI в базисных пунктах. Может быть отрицательным.
   * Базисные пункты вместо float — единственный способ избежать ошибок округления
   * при агрегации ROI нескольких проектов.
   */
  roiBps: z.number().int(),
  /** Точка безубыточности в копейках выручки. */
  breakEvenRevenue: PositiveKopecks,
  snapshot: FinancialSnapshot,
}).strict();

export type FinanceAnalysis = z.infer<typeof FinanceAnalysis>;
