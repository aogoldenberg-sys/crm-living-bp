import { z } from "zod";
import { PositiveKopecks, IsoDate, IsoDateTime, Inn, DataSource } from "../money.js";

/**
 * Поступление денег. Append-only: событие никогда не редактируется.
 * Ошибку фиксации исправляет PaymentCorrection — отдельное компенсирующее событие.
 */
export const PaymentIn = z.object({
  type: z.literal("payment_in"),
  eventId: z.string().uuid(),
  ts: IsoDateTime,
  valueDate: IsoDate,
  amount: PositiveKopecks,
  counterpartyInn: Inn.nullable(),
  counterpartyName: z.string().min(1),
  purpose: z.string(),
  matchedInvoiceId: z.string().nullable(),
  source: DataSource,
  businessId: z.string().min(1),
}).strict();

export type PaymentIn = z.infer<typeof PaymentIn>;

/**
 * Исходящий платёж. Хранится отдельно от входящего, чтобы
 * дашборд cash-flow мог фильтровать направление без вычислений по знаку.
 */
export const PaymentOut = z.object({
  type: z.literal("payment_out"),
  eventId: z.string().uuid(),
  ts: IsoDateTime,
  valueDate: IsoDate,
  amount: PositiveKopecks,
  counterpartyInn: Inn.nullable(),
  counterpartyName: z.string().min(1),
  purpose: z.string(),
  /** Категория расхода нужна для P&L — без неё нельзя считать маржу по статьям. */
  expenseCategory: z.string().min(1),
  source: DataSource,
  businessId: z.string().min(1),
}).strict();

export type PaymentOut = z.infer<typeof PaymentOut>;

/**
 * Компенсирующее событие для исправления ошибок в PaymentIn/PaymentOut.
 * Модель append-only не позволяет редактировать прошлое —
 * вместо этого мы обнуляем ошибочное событие и создаём новое правильное.
 * correctedEventId указывает на eventId исходного ошибочного события.
 */
export const PaymentCorrection = z.object({
  type: z.literal("payment_correction"),
  eventId: z.string().uuid(),
  ts: IsoDateTime,
  correctedEventId: z.string().uuid(),
  reason: z.string().min(1),
  source: DataSource,
  businessId: z.string().min(1),
}).strict();

export type PaymentCorrection = z.infer<typeof PaymentCorrection>;
