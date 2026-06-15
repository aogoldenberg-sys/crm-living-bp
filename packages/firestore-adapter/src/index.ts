/**
 * Публичный API пакета firestore-adapter.
 *
 * createFirestoreRestClient — для CF Workers (fetch + JWT, без gRPC).
 * createFirestoreClientFromJson — для VPS/серверного кода (firebase-admin).
 */
export { createFirestoreClient, createFirestoreClientFromJson } from "./client.js";
export { createFirestoreRestClient } from "./rest-client.js";
export type { Db } from "./db.js";
export { loadEvents, saveEvents, type LoadEventsResult } from "./events.js";
export { saveForecast, loadForecast } from "./forecast.js";
export { loadPlan, savePlan } from "./plan.js";
export { savePlanfact, loadPlanfact } from "./planfact.js";
export { registerTenant, listTenants } from "./tenants.js";
