/**
 * Monitor worker — ежедневный cron (05:00 UTC).
 *
 * Для каждого тенанта:
 *   1. Загружает MonitoringProfile из _meta/monitoring_profile
 *   2. Запускает все адаптеры параллельно
 *   3. Дедуплицирует новые сигналы против последних из Firestore
 *   4. Записывает сигналы в tenants/{id}/events + demand_signals
 *
 * Ошибка одного тенанта или адаптера не останавливает остальные.
 */

import { createFirestoreRestClient } from "@crm/firestore-adapter";
import { listTenants } from "@crm/firestore-adapter";
import { dedupeSignals } from "@crm/core";
import { MonitoringProfile } from "@crm/schemas";
import type { ExternalSignal, DemandTrendPoint, CounterpartyRiskSignal } from "@crm/schemas";

import { fetchCbrSignals } from "./adapters/cbr.js";
import { fetchPravoRssSignals } from "./adapters/pravoRss.js";
import { fetchWordstatSignals } from "./adapters/wordstat.js";
import { fetchDadataSignals } from "./adapters/dadata.js";
import { fetchKadArbitrSignals } from "./adapters/kadArbitr.js";

export interface Env {
  FIREBASE_SERVICE_ACCOUNT_JSON: string;
  WORDSTAT_TOKEN: string;
  DADATA_TOKEN: string;
}

const EVENTS_WINDOW = 200; // храним последние N событий на тенанта

async function loadProfile(db: ReturnType<typeof createFirestoreRestClient>, businessId: string): Promise<MonitoringProfile | null> {
  const snap = await db
    .collection(`tenants/${businessId}/_meta`)
    .doc("monitoring_profile")
    .get();
  if (!snap.exists) return null;
  const parsed = MonitoringProfile.safeParse(snap.data());
  if (!parsed.success) return null;
  return parsed.data;
}

async function loadRecentSignals(
  db: ReturnType<typeof createFirestoreRestClient>,
  businessId: string,
  col: string,
): Promise<unknown[]> {
  try {
    const snap = await db
      .collection(`tenants/${businessId}/${col}`)
      .orderBy("ts")
      .get();
    return snap.docs.map(d => d.data());
  } catch {
    return [];
  }
}

async function saveSignals(
  db: ReturnType<typeof createFirestoreRestClient>,
  businessId: string,
  collection: string,
  signals: Array<ExternalSignal | DemandTrendPoint | CounterpartyRiskSignal>,
): Promise<void> {
  for (const signal of signals.slice(-EVENTS_WINDOW)) {
    await db
      .collection(`tenants/${businessId}/${collection}`)
      .doc(signal.eventId)
      .set(signal as unknown as Record<string, unknown>);
  }
}

async function runTenant(
  db: ReturnType<typeof createFirestoreRestClient>,
  businessId: string,
  env: Env,
  now: string,
): Promise<void> {
  const profile = await loadProfile(db, businessId);
  if (!profile) return; // профиль не настроен — пропускаем

  // Параллельно запускаем все адаптеры
  const [cbr, rss, wordstat, dadata, kad] = await Promise.allSettled([
    fetchCbrSignals(now),
    fetchPravoRssSignals(profile.keywords, now),
    fetchWordstatSignals(profile.keywords, env.WORDSTAT_TOKEN, now),
    fetchDadataSignals(profile.counterpartyInns, env.DADATA_TOKEN, now),
    fetchKadArbitrSignals(profile.counterpartyInns, now),
  ]);

  // Внешние сигналы (CBR + RSS)
  const externalRaw: ExternalSignal[] = [
    ...(cbr.status === "fulfilled" ? cbr.value.signals : []),
    ...(rss.status === "fulfilled" ? rss.value.signals : []),
  ];

  // Demand trend points (Wordstat)
  const demandRaw: DemandTrendPoint[] = wordstat.status === "fulfilled"
    ? wordstat.value.signals
    : [];

  // Counterparty risk (DaData + kad.arbitr)
  const riskRaw: CounterpartyRiskSignal[] = [
    ...(dadata.status === "fulfilled" ? dadata.value.signals : []),
    ...(kad.status === "fulfilled" ? kad.value.signals : []),
  ];

  // Дедуп каждого типа отдельно
  const [prevExternal, prevDemand, prevRisk] = await Promise.all([
    loadRecentSignals(db, businessId, "events"),
    loadRecentSignals(db, businessId, "demand_signals"),
    loadRecentSignals(db, businessId, "risk_signals"),
  ]);

  const newExternal = dedupeSignals(prevExternal as ExternalSignal[], externalRaw);
  const newDemand = dedupeSignals(prevDemand as DemandTrendPoint[], demandRaw);
  const newRisk = dedupeSignals(prevRisk as CounterpartyRiskSignal[], riskRaw);

  await Promise.all([
    newExternal.length > 0 && saveSignals(db, businessId, "events", newExternal),
    newDemand.length > 0 && saveSignals(db, businessId, "demand_signals", newDemand),
    newRisk.length > 0 && saveSignals(db, businessId, "risk_signals", newRisk),
  ]);

  console.log(`[monitor] ${businessId}: +${newExternal.length} external, +${newDemand.length} demand, +${newRisk.length} risk`);
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date().toISOString() as `${string}T${string}Z`;
    const db = createFirestoreRestClient(env.FIREBASE_SERVICE_ACCOUNT_JSON);

    const tenantsResult = await listTenants(db);
    if (!tenantsResult.ok) {
      console.error("[monitor] cannot list tenants:", tenantsResult.error.message);
      return;
    }

    const tasks = tenantsResult.value.map(id =>
      runTenant(db, id, env, now).catch(e =>
        console.error(`[monitor] tenant ${id} failed:`, e instanceof Error ? e.message : e)
      )
    );

    ctx.waitUntil(Promise.all(tasks));
  },
};
