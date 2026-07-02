import { z } from "zod";
import { PositiveKopecks, IsoDate, IsoDateTime } from "../money.js";

/**
 * Якорь баланса — верифицированный остаток на счёте на конкретную дату.
 * Используется forecast'ом как начальная точка вместо (или поверх)
 * суммы исторических событий. Не является платёжным событием —
 * это снапшот факт-остатка (например, из выписки банка).
 */
export const BalanceAnchor = z.object({
  type: z.literal("balance_anchor"),
  eventId: z.string().uuid(),
  ts: IsoDateTime,
  /** Дата, на которую зафиксирован остаток. */
  anchorDate: IsoDate,
  /** Верифицированный остаток в копейках (всегда ≥ 0). */
  balanceKopecks: PositiveKopecks,
  /** Источник данных (bank_api, manual, statement). */
  source: z.enum(["bank_api", "manual", "statement"]),
  businessId: z.string().min(1),
}).strict();

export type BalanceAnchor = z.infer<typeof BalanceAnchor>;
