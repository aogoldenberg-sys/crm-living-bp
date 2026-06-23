/**
 * Публичный API пакета firestore-adapter.
 *
 * createFirestoreRestClient — для CF Workers (fetch + JWT, без gRPC).
 * createFirestoreClientFromJson — для VPS/серверного кода (firebase-admin).
 */
export { createFirestoreClient, createFirestoreClientFromJson } from "./client.js";
export { createFirestoreRestClient } from "./rest-client.js";
export type { Db, CollectionRef, DocRef, Query, DocSnapshot, QuerySnapshot } from "./db.js";
export { loadEvents, saveEvents, type LoadEventsResult } from "./events.js";
export { saveForecast, loadForecast } from "./forecast.js";
export { loadPlan, savePlan } from "./plan.js";
export { savePlanfact, loadPlanfact } from "./planfact.js";
export { registerTenant, listTenants } from "./tenants.js";
export { provisionTenantSecret, sha256hex } from "./auth.js";
export { saveIntake, loadIntake } from "./intake.js";
export { acceptIntake } from "./acceptIntake.js";
export { saveBusinessPlan, loadBusinessPlan } from "./businessPlan.js";
export {
  loadDealEvents,
  loadFunnel,
  loadFunnels,
  saveFunnel,
  saveDealsProjection,
  loadFunnelMetrics,
  saveFunnelMetrics,
} from "./deals.js";
export { COL } from "./collections.js";
export { saveDemandSignals, loadDemandSignals } from "./demand.js";
