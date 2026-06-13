import type { BusinessEvent, IsoDate } from "@crm/schemas";

/**
 * Нижняя граница истории при запросах «всей доступной истории».
 * Вынесена из aggregate/forecast/replay — один хардкод вместо трёх.
 * Если система когда-нибудь получит данные до 2000 года, меняем здесь.
 */
export const EPOCH_START = "2000-01-01" as IsoDate;

/**
 * Каноническая дата события для хронологических сравнений и фильтрации.
 *
 * Почему два разных поля: платёжные события используют valueDate —
 * реальную дату зачисления, которая может отличаться от ts (дата импорта выписки).
 * Для всех остальных событий берём дату из ts (дата фиксации факта).
 *
 * Единая точка истины: aggregate, replay и любой будущий модуль
 * импортируют отсюда — рассинхрон при изменении логики невозможен.
 */
export function eventDate(e: BusinessEvent): IsoDate {
  if (e.type === "payment_in" || e.type === "payment_out") {
    return e.valueDate;
  }
  return e.ts.slice(0, 10) as IsoDate;
}
