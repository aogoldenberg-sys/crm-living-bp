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

import type { IsoDate, BusinessEvent, LeadCaptured, CallLogged, DealStageChanged } from "@crm/schemas";
import {
  aggregateEvents,
  forecastCash,
  mulberry32,
  EPOCH_START,
  reduceDeals,
  funnelMetrics,
  computeDemandSignals,
  type PlanFactMetrics,
  type DemandPeriod,
} from "@crm/core";
import type { ForecastConfig } from "@crm/core";
import {
  createFirestoreRestClient,
  listTenants,
  loadEvents,
  loadPlan,
  saveForecast,
  savePlanfact,
  loadDealEvents,
  loadFunnels,
  saveDealsProjection,
  saveFunnelMetrics,
  saveDemandSignals,
  type Db,
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
  await runWithDb(db);
}

/**
 * Чистая бизнес-логика без привязки к env/secrets.
 * Экспортируется для unit-тестов (Vitest + FakeFirestore, без workerd).
 */
export async function runWithDb(db: Db): Promise<void> {
  const tenantsResult = await listTenants(db);
  if (!tenantsResult.ok) {
    console.error("[compute] listTenants failed:", tenantsResult.error);
    return;
  }

  if (tenantsResult.value.length === 0) {
    console.log("[compute] no tenants registered yet");
    return;
  }

  // Process each tenant independently — failure of one must not cancel others.
  await Promise.all(tenantsResult.value.map((businessId) => runForTenant(db, businessId)));
}

async function runForTenant(db: Db, businessId: string): Promise<void> {
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
    // Воронка и спрос не зависят от бизнес-плана — считаем независимо.
    await runFunnelStep(db, businessId);
    await runDemandStep(db, businessId, events);
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

  // ── Воронка продаж ────────────────────────────────────────────────────
  await runFunnelStep(db, businessId);

  // ── Сигналы спроса ────────────────────────────────────────────────────
  await runDemandStep(db, businessId, events);
}

/**
 * Шаг воронки: deal-события → проекция сделок + метрики воронки.
 * Изолирован от основного runForTenant: ошибка здесь не ломает planfact/forecast.
 * Нет воронок → молча пропускаем.
 */
async function runFunnelStep(db: Db, businessId: string): Promise<void> {
  // 1. Загружаем только deal-события
  const dealEventsResult = await loadDealEvents(db, businessId);
  if (!dealEventsResult.ok) {
    console.error(`[compute] ${businessId}: loadDealEvents failed:`, dealEventsResult.error);
    return;
  }
  const { events: dealEvents, skipped: dealSkipped } = dealEventsResult.value;
  if (dealSkipped > 0) {
    console.warn(`[compute] ${businessId}: loadDealEvents: ${dealSkipped} invalid docs skipped`);
  }

  if (dealEvents.length === 0) {
    console.log(`[compute] ${businessId}: no deal events, skipping funnel step`);
    return;
  }

  // 2. Сворачиваем события в проекцию сделок
  const deals = reduceDeals(dealEvents);

  // 3. Сохраняем проекцию
  const dealsResult = await saveDealsProjection(db, businessId, deals);
  if (!dealsResult.ok) {
    console.error(`[compute] ${businessId}: saveDealsProjection failed:`, dealsResult.error);
    return;
  }

  console.log(`[compute] ${businessId}: deals projection saved: ${deals.size} deals`);

  // 4. Загружаем воронки и считаем метрики
  const funnelsResult = await loadFunnels(db, businessId);
  if (!funnelsResult.ok) {
    console.error(`[compute] ${businessId}: loadFunnels failed:`, funnelsResult.error);
    return;
  }

  if (funnelsResult.value.length === 0) {
    console.log(`[compute] ${businessId}: no funnels configured, skipping metrics`);
    return;
  }

  for (const funnel of funnelsResult.value) {
    const metrics = funnelMetrics(deals, funnel);
    const totalStuck = metrics.stages.reduce((sum, s) => sum + s.stuck.length, 0);

    const saveResult = await saveFunnelMetrics(db, businessId, funnel.funnelId, metrics);
    if (!saveResult.ok) {
      console.error(
        `[compute] ${businessId}: saveFunnelMetrics(${funnel.funnelId}) failed:`,
        saveResult.error,
      );
      continue;
    }
    console.log(
      `[compute] ${businessId}: funnel=${funnel.funnelId} deals=${deals.size} stuck=${totalStuck}`,
    );
  }
}

/**
 * Шаг сигналов спроса: LeadCaptured + DealStageChanged → DemandSignals.
 * Изолирован: ошибка здесь не ломает planfact/forecast/funnel.
 * Нет лид-событий → молча пропускаем (норма при пустом тенанте).
 *
 * Период: последние 30 дней (MVP). Хранение истории периодов — §8.
 * wonStageIds: терминальные стадии (terminal=true) из конфигурации воронок.
 * Живые рекомендации намеренно отсутствуют (§8, требуется ≥4 недели факта).
 */
async function runDemandStep(
  db: Db,
  businessId: string,
  allEvents: BusinessEvent[],
): Promise<void> {
  const leadEvents = allEvents.filter((e): e is LeadCaptured => e.type === "lead_captured");
  const callEvents = allEvents.filter((e): e is CallLogged => e.type === "call_logged");
  const dealEvents = allEvents.filter((e): e is DealStageChanged => e.type === "deal_stage_changed");

  if (leadEvents.length === 0) {
    console.log(`[compute] ${businessId}: no lead events, skipping demand step`);
    return;
  }

  // Терминальные стадии воронок — источник wonStageIds.
  const funnelsResult = await loadFunnels(db, businessId);
  if (!funnelsResult.ok) {
    console.error(`[compute] ${businessId}: demand: loadFunnels failed:`, funnelsResult.error);
    return;
  }
  const wonStageIds = funnelsResult.value.flatMap((f) =>
    f.stages.filter((s) => s.terminal).map((s) => s.id),
  );

  const now = new Date();
  const period: DemandPeriod = {
    from: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    to: now.toISOString(),
  };

  const signals = computeDemandSignals(
    leadEvents,
    callEvents,
    dealEvents,
    period,
    wonStageIds.length > 0 ? { wonStageIds } : undefined,
  );

  const saveResult = await saveDemandSignals(db, businessId, signals);
  if (!saveResult.ok) {
    console.error(`[compute] ${businessId}: saveDemandSignals failed:`, saveResult.error);
    return;
  }

  console.log(
    `[compute] ${businessId}: demand signals saved: leads=${signals.leads} qualRate=${signals.qualifiedRate.toFixed(2)} trend=${signals.trendScore.toFixed(2)}`,
  );
}
