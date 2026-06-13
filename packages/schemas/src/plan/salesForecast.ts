import { z } from "zod";
import { PositiveKopecks, IsoDate } from "../money.js";

/**
 * Один сценарий продаж (пессимистичный / базовый / оптимистичный).
 * Три отдельных записи в массиве сценариев, а не три поля в одном объекте —
 * добавить новый сценарий можно без изменения схемы.
 */
export const SalesForecastScenario = z.object({
  scenarioId: z.string().uuid(),
  name: z.string().min(1),
  kind: z.enum(["pessimistic", "base", "optimistic"]),
  /** Средний чек в копейках. */
  avgCheckKopecks: PositiveKopecks,
  /** Количество сделок в месяц — целое, дробные сделки не имеют смысла. */
  dealsPerMonth: z.number().int().positive(),
  /** Конверсия лид→сделка в базисных пунктах (0–10000). */
  conversionBps: z.number().int().min(1).max(10000),
  /** Прогнозируемая выручка за период в копейках. */
  projectedRevenue: PositiveKopecks,
}).strict();

export type SalesForecastScenario = z.infer<typeof SalesForecastScenario>;

/**
 * Раздел «Сценарий и прогноз продаж» живого бизнес-плана.
 * forecastPeriodMonths ограничен 60 — прогнозы больше 5 лет
 * теряют практическую ценность для малого бизнеса.
 */
export const SalesForecast = z.object({
  periodStart: IsoDate,
  forecastPeriodMonths: z.number().int().min(1).max(60),
  /** Хотя бы один сценарий обязателен — документ без прогноза не живой план, а шаблон. */
  scenarios: z.array(SalesForecastScenario).min(1),
  /**
   * ID выбранного базового сценария для дашборда.
   * Должен ссылаться на один из scenarioId в массиве scenarios,
   * но проверка ссылочной целостности — на уровне бизнес-логики, не схемы.
   */
  activeScenarioId: z.string().uuid(),
  /** Количество лидов в месяц — основа для расчёта воронки. */
  leadsPerMonth: z.number().int().positive(),
}).strict();

export type SalesForecast = z.infer<typeof SalesForecast>;
