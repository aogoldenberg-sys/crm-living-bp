import { z } from "zod";
import { Kopecks, IsoDate, IsoDateTime } from "./money.js";

/**
 * Управленческая отчётность. Все суммы — integer копейки.
 * Отчёты — только draft. Подтверждает и использует человек.
 * Данные — исключительно из событий лога.
 */

export const PnLRow = z.object({
  month: IsoDate,          // первый день месяца: 2026-01-01
  revenue: Kopecks,
  cogs: Kopecks,           // себестоимость — payment_out с маркером
  grossProfit: Kopecks,
  opex: Kopecks,           // прочие операционные расходы
  ebitda: Kopecks,
  interest: Kopecks,       // 0 — нет данных по займам здесь
  ebt: Kopecks,
  tax: Kopecks,            // 0 — считается в tax/usn
  netProfit: Kopecks,
}).strict();
export type PnLRow = z.infer<typeof PnLRow>;

export const PnLStatement = z.object({
  businessId: z.string().min(1),
  year: z.number().int().min(2020).max(2035),
  rows: z.array(PnLRow).max(12),
  totalRevenue: Kopecks,
  totalNetProfit: Kopecks,
  generatedAt: IsoDateTime,
  status: z.literal("draft"),
}).strict();
export type PnLStatement = z.infer<typeof PnLStatement>;

export const CashFlowRow = z.object({
  month: IsoDate,
  operatingCf: Kopecks,   // чистая прибыль + амортизация (упрощ: payment_in − payment_out)
  investingCf: Kopecks,   // CAPEX — отрицательное
  financingCf: Kopecks,   // займы минус погашения
  netCf: Kopecks,
  endBalance: Kopecks,
}).strict();
export type CashFlowRow = z.infer<typeof CashFlowRow>;

export const CashFlowStatement = z.object({
  businessId: z.string().min(1),
  year: z.number().int().min(2020).max(2035),
  rows: z.array(CashFlowRow),
  generatedAt: IsoDateTime,
  status: z.literal("draft"),
}).strict();
export type CashFlowStatement = z.infer<typeof CashFlowStatement>;

export const MgmtBalance = z.object({
  businessId: z.string().min(1),
  asOf: IsoDate,
  assets: z.object({
    cash: Kopecks,
    receivables: Kopecks,
    inventory: Kopecks,
    fixed: Kopecks,
    total: Kopecks,
  }).strict(),
  liabilities: z.object({
    payables: Kopecks,
    loans: Kopecks,
    total: Kopecks,
  }).strict(),
  equity: Kopecks,        // assets.total - liabilities.total
  generatedAt: IsoDateTime,
  status: z.literal("draft"),
}).strict();
export type MgmtBalance = z.infer<typeof MgmtBalance>;
