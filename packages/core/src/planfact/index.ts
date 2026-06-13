/**
 * Публичный API модуля planfact.
 * Импортируй отсюда, а не из внутренних файлов — это контракт модуля.
 */
export { aggregateEvents } from "./aggregate.js";
export type { PlanFactMetrics } from "./aggregate.js";

export { computeDeviation, computeEma } from "./deviation.js";
export type { DeviationResult } from "./deviation.js";

export { deriveAlerts } from "./alerts.js";
export type { Alert, PlanAssumptions } from "./alerts.js";
