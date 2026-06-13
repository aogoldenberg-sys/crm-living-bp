import { z } from "zod";
import { PositiveKopecks, IsoDate } from "../money.js";

/**
 * Одна запись в календаре платежей.
 * Плановые и фактические платежи хранятся в одной схеме,
 * чтобы на дашборде cash-flow было единое представление без JOIN-запросов.
 */
export const PaymentCalendarEntry = z.object({
  entryId: z.string().uuid(),
  dueDate: IsoDate,
  amount: PositiveKopecks,
  direction: z.enum(["inbound", "outbound"]),
  counterpartyName: z.string().min(1),
  description: z.string(),
  status: z.enum(["planned", "confirmed", "paid", "overdue", "cancelled"]),
  /**
   * linkedPaymentEventId ссылается на PaymentIn.eventId или PaymentOut.eventId
   * после фактической оплаты. null — пока статус planned/confirmed.
   */
  linkedPaymentEventId: z.string().uuid().nullable(),
  /** Категория нужна для группировки в отчёте «Платёжный календарь по статьям». */
  category: z.string().min(1),
}).strict();

export type PaymentCalendarEntry = z.infer<typeof PaymentCalendarEntry>;

/**
 * Раздел «Календарь платежей» живого бизнес-плана.
 * Остаток на начало периода хранится явно — иначе пересчёт running balance
 * требует обхода всей истории событий при каждом открытии раздела.
 */
export const PaymentCalendar = z.object({
  periodStart: IsoDate,
  periodEnd: IsoDate,
  /** Остаток на счёте на начало периода в копейках. */
  openingBalanceKopecks: PositiveKopecks,
  entries: z.array(PaymentCalendarEntry),
}).strict();

export type PaymentCalendar = z.infer<typeof PaymentCalendar>;
