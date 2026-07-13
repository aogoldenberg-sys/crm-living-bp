/**
 * Worker: notify
 * Cron 1 (0 8 * * *):  ежедневный дайджест владельцу.
 * Cron 2 (0 6 * * 1):  еженедельный доклад §17.
 */

import {
  createFirestoreRestClient,
  listTenants,
  loadForecast,
  loadPlanfact,
} from "@crm/firestore-adapter";
import type { PlanFactMetrics } from "@crm/core";
import type { CashForecast } from "@crm/core/forecast";
import { runWeeklyReports } from "./weekly.js";

interface Env {
  FIREBASE_SERVICE_ACCOUNT_JSON: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
}

export default {
  async scheduled(ctrl: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date().toISOString();
    if (ctrl.cron === "0 6 * * 1") {
      ctx.waitUntil(runWeeklyReports(env.FIREBASE_SERVICE_ACCOUNT_JSON, env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, now));
    } else {
      ctx.waitUntil(runDailyDigest(env));
    }
  },
} satisfies ExportedHandler<Env>;

async function runDailyDigest(env: Env): Promise<void> {
  const db = createFirestoreRestClient(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const tenantsResult = await listTenants(db);
  if (!tenantsResult.ok) {
    console.error("[notify] listTenants failed:", tenantsResult.error);
    await sendTelegram(env, "⚠️ CRM: не удалось получить список тенантов.");
    return;
  }
  if (tenantsResult.value.length === 0) return;
  for (const businessId of tenantsResult.value) {
    await runDigestForTenant(db, env, businessId);
  }
}

async function runDigestForTenant(
  db: ReturnType<typeof createFirestoreRestClient>,
  env: Env,
  businessId: string,
): Promise<void> {
  const [forecastResult, planfactResult] = await Promise.all([
    loadForecast(db, businessId),
    loadPlanfact(db, businessId),
  ]);
  if (!forecastResult.ok) {
    console.error(`[notify] ${businessId}: forecast error:`, forecastResult.error);
    await sendTelegram(env, `⚠️ CRM [${businessId}]: не удалось загрузить данные для дайджеста.`);
    return;
  }
  if (!planfactResult.ok) {
    console.error(`[notify] ${businessId}: planfact error:`, planfactResult.error);
    await sendTelegram(env, `⚠️ CRM [${businessId}]: не удалось загрузить данные для дайджеста.`);
    return;
  }
  const forecast = forecastResult.value;
  const metrics = planfactResult.value;
  if (forecast === null || metrics === null) {
    await sendTelegram(env, `🚀 CRM [${businessId}] запущена. Данных пока нет — ожидаем первый compute-цикл.`);
    return;
  }
  await sendTelegram(env, formatDigest(businessId, metrics, forecast));
  console.log(`[notify] ${businessId}: digest sent`);
}

function formatDigest(businessId: string, metrics: PlanFactMetrics, forecast: CashForecast): string {
  const fmt = (k: number) => (k / 100).toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₽";
  const date = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  const gapLine = forecast.gapDate
    ? `⚠️ Кассовый разрыв: ~${forecast.gapDate} (уверенность ${(forecast.confidence * 100).toFixed(0)}%)`
    : `✅ Кассового разрыва не ожидается (уверенность ${(forecast.confidence * 100).toFixed(0)}%)`;
  return [
    `📊 *CRM [${businessId}] — ${date}*`, ``,
    `💰 Поступления: ${fmt(metrics.totalIn)}`,
    `💸 Расходы: ${fmt(metrics.totalOut)}`,
    `📈 Чистый остаток: ${fmt(metrics.netCash)}`, ``,
    `🤝 Сделки: ${metrics.dealsCount}  |  Лиды: ${metrics.leadsCount}  |  Звонки: ${metrics.callsCount}`, ``,
    gapLine,
  ].join("\n");
}

export async function sendTelegram(env: Env, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: "Markdown" }),
  });
  if (!res.ok) console.error(`[notify] Telegram API error ${res.status}:`, await res.text());
}
