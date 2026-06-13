/**
 * Публичный API пакета firestore-adapter.
 * Единственное место в монорепо, где живёт firebase-admin.
 * Все остальные пакеты работают с доменными типами из @crm/core и @crm/schemas.
 */
export { createFirestoreClient } from "./client.js";
export { loadEvents, saveEvents } from "./events.js";
export { saveForecast, loadForecast } from "./forecast.js";
export { loadPlan, savePlan } from "./plan.js";
