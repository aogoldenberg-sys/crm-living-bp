/**
 * Worker: compute — cron каждые 6 часов.
 *
 * Пересчитывает план/факт-метрики и прогноз кассы из append-only лога событий.
 * Результаты сохраняются в Firestore и читаются notify-воркером и фронтом.
 *
 * Почему без курсора (инкрементального since): на объёме MVP (сотни событий)
 * полный пересчёт за секунды. Курсор добавим когда события > 10k — как TODO.
 * Детерминированность: один и тот же лог → один и тот же результат.
 *
 * TODO: заменить Promise.all в saveEvents на db.batch() (атомарно, до 500 ops).
 */

import type { IsoDate } from "@crm/schemas";
import {
  aggregateEvents,
  forecastCash,
  mulberry32,
  EPOCH_START,
  type PlanFactMetrics,
} from "@crm/core";
import type { ForecastConfig } from "@crm/core";
import {
  createFirestoreRestClient,
  listTenants,
  loadEvents,
  loadPlan,
  saveForecast,
  savePlanfact,
} from "@crm/firestore-adapter";

interface Env {
  FIREBASE_SERVICE_ACCOUNT_JSON: string;
}

/** Конфигурация прогноза. Вынесена из кода — легко менять без деплоя через env. */
const FORECAST_CONFIG: ForecastConfig = {
  horizonDays: 90,
  iterations: 10_000,
  revenueVolatility: 0.15,
  paymentDelayDays: 7,
  paymentDelayStdDev: 3,
  leadDropoutRate: 0.2,
};

export default {
  async scheduled(_ctrl: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(run(env));
  },
} satisfies ExportedHandler<Env>;

async function run(env: Env): Promise<void> {
  const db = createFirestoreRestClient(env.FIREBASE_SERVICE_ACCOUNT_JSON);

  const tenantsResult = await listTenants(db);
  if (!tenantsResult.ok) {
    console.error("[compute] listTenants failed:", tenantsResult.error);
    return;
  }

  if (tenantsResult.value.length === 0) {
    console.log("[compute] no tenants registered yet");
    return;
  }

  // Process each tenant independently
  await Promise.all(tenantsResult.value.map((businessId) => runForTenant(db, businessId)));
}

async function runForTenant(db: ReturnType<typeof createFirestoreRestClient>, businessId: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10) as IsoDate;

  // ── Загрузка событий ──────────────────────────────────────────────────
  const eventsResult = await loadEvents(db, businessId);
  if (!eventsResult.ok) {
    console.error(`[compute] ${businessId}: loadEvents failed:`, eventsResult.error);
    return;
  }
  const { events, skipped } = eventsResult.value;
  if (skipped > 0) {
    console.warn(`[compute] ${businessId}: loadEvents: ${skipped} invalid docs skipped`);
  }
  console.log(`[compute] ${businessId}: loaded ${events.length} events`);

  // ── Агрегирование план/факт ───────────────────────────────────────────
  const aggregateResult = aggregateEvents(events, { from: EPOCH_START, to: today });
  if (!aggregateResult.ok) {
    console.error(`[compute] ${businessId}: aggregateEvents failed:`, aggregateResult.error);
    return;
  }
  const metrics: PlanFactMetrics = aggregateResult.value;

  const planfactResult = await savePlanfact(db, businessId, metrics);
  if (!planfactResult.ok) {
    console.error(`[compute] ${businessId}: savePlanfact failed:`, planfactResult.error);
    return;
  }

  // ── Прогноз кассы ─────────────────────────────────────────────────────
  const planResult = await loadPlan(db, businessId);
  if (!planResult.ok) {
    console.error(`[compute] ${businessId}: loadPlan failed:`, planResult.error);
    return;
  }

  if (planResult.value === null) {
    // Бизнес-план ещё не настроен — прогноз не строим, это норма при первом запуске.
    console.log(`[compute] ${businessId}: no active plan found, skipping forecast`);
    return;
  }

  // Seed детерминирован внутри дня: одинаковый вход → одинаковый прогноз.
  // При следующем запуске seed меняется — прогноз обновляется с новой случайностью.
  const dailySeed = Math.floor(Date.now() / 86_400_000);
  const rng = mulberry32(dailySeed);

  const forecastResult = forecastCash(events, planResult.value, FORECAST_CONFIG, rng);
  if (!forecastResult.ok) {
    console.error(`[compute] ${businessId}: forecastCash failed:`, forecastResult.error);
    return;
  }

  const saveResult = await saveForecast(db, businessId, forecastResult.value);
  if (!saveResult.ok) {
    console.error(`[compute] ${businessId}: saveForecast failed:`, saveResult.error);
    return;
  }

  const { gapDate, confidence } = forecastResult.value;
  console.log(
    `[compute] ${businessId}: done netCash=${metrics.netCash} gapDate=${gapDate ?? "none"} confidence=${(confidence * 100).toFixed(0)}%`,
  );
}
