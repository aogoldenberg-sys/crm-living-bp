import { z } from "zod";
import { IsoDateTime } from "../money.js";

/**
 * Одна стадия воронки продаж.
 * normConversion и normDays — нормативы, задаются при настройке воронки,
 * используются как эталон для сравнения с фактом.
 */
export const FunnelStage = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Нормативная конверсия стадия→следующая: 0..1. 1.0 = все проходят, 0 = никто. */
  normConversion: z.number().min(0).max(1),
  /** Нормативное время на стадии в днях. Строго положительное целое. */
  normDays: z.number().int().positive(),
  /**
   * Терминальная стадия (won/lost): сделки здесь не «застревают»,
   * конверсия-наружу не считается. По умолчанию false.
   */
  terminal: z.boolean().default(false),
}).strict();

export type FunnelStage = z.infer<typeof FunnelStage>;

/**
 * Воронка продаж. Порядок stages важен: [0] = первая стадия, [N-1] = последняя.
 * Минимум 2 стадии — воронка с одной стадией бессмысленна (нечего конвертировать).
 */
export const Funnel = z.object({
  funnelId: z.string().min(1),
  name: z.string().min(1),
  stages: z.array(FunnelStage).min(2),
}).strict();

export type Funnel = z.infer<typeof Funnel>;

/**
 * Deal — проекция (snapshot) текущего состояния сделки.
 * Вычисляется из append-only лога событий, не хранится напрямую.
 * Деньги в копейках. Даты — ISO-строки.
 */
export const Deal = z.object({
  dealId: z.string().uuid(),
  funnelId: z.string().min(1),
  currentStage: z.string().min(1),
  /** Прогнозируемая сумма в копейках; 0 если ещё не определена. */
  amount: z.number().int().nonnegative(),
  /** Вероятность закрытия: 0..1. */
  probability: z.number().min(0).max(1),
  ownerId: z.string().uuid(),
  /** null до идентификации клиента. */
  clientId: z.string().uuid().nullable(),
  expectedCloseDate: z.string().date().nullable(),
  expectedPaymentDate: z.string().date().nullable(),
  /** Сколько дней сделка находится на текущей стадии (целое ≥ 0). */
  daysInStage: z.number().int().nonnegative(),
  /** Метка времени последнего события по этой сделке. */
  updatedAt: IsoDateTime,
}).strict();

export type Deal = z.infer<typeof Deal>;
