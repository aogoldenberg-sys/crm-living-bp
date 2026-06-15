/**
 * Worker: notify — утренний Telegram-дайджест владельцу (08:00 UTC).
 *
 * Читает из Firestore последние сохранённые compute-воркером данные
 * и отправляет краткий отчёт. Никакой бизнес-логики — только форматирование.
 *
 * Если compute ещё не запускался (данных нет) — отправляет сигнал «система стартовала».
 */

import {
  createFirestoreClientFromJson,
  loadForecast,
  loadPlanfact,
} from "@crm/firestore-adapter";
import type { PlanFactMetrics } from "@crm/core";
import type { CashForecast } from "@crm/core/forecast";

interface Env {
  FIREBASE_SERVICE_ACCOUNT_JSON: string;
  /** Токен Telegram-бота (@BotFather). Cloudflare Secret. */
  TELEGRAM_BOT_TOKEN: string;
  /** chat_id получателя: владелец или группа. Cloudflare Secret. */
  TELEGRAM_CHAT_ID: string;
}

export default {
  // ScheduledController — тип из @cloudflare/workers-types (не ScheduledEvent)
  async scheduled(_ctrl: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(run(env));
  },
} satisfies ExportedHandler<Env>;

async function run(env: Env): Promise<void> {
  const db = createFirestoreClientFromJson(env.FIREBASE_SERVICE_ACCOUNT_JSON);

  const [forecastResult, planfactResult] = await Promise.all([
    loadForecast(db),
    loadPlanfact(db),
  ]);

  // Раздельные проверки — TypeScript корректно сужает тип Result в каждом блоке
  if (!forecastResult.ok) {
    console.error("[notify] failed to load forecast:", forecastResult.error);
    await sendTelegram(env, "⚠️ CRM: не удалось загрузить данные для дайджеста.");
    return;
  }
  if (!planfactResult.ok) {
    console.error("[notify] failed to load planfact:", planfactResult.error);
    await sendTelegram(env, "⚠️ CRM: не удалось загрузить данные для дайджеста.");
    return;
  }

  const forecast = forecastResult.value;
  const metrics = planfactResult.value;

  if (forecast === null || metrics === null) {
    // Первый запуск — compute ещё не работал
    await sendTelegram(env, "🚀 CRM запущена. Данных пока нет — ожидаем первый compute-цикл.");
    return;
  }

  const text = formatDigest(metrics, forecast);
  await sendTelegram(env, text);
  console.log("[notify] digest sent");
}

function formatDigest(metrics: PlanFactMetrics, forecast: CashForecast): string {
  // Форматируем деньги: копейки → рубли с разделителем тысяч
  const fmt = (kopecks: number): string =>
    (kopecks / 100).toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₽";

  const date = new Date().toLocaleDateString("ru-RU", {
    day: "numeric", month: "long", year: "numeric",
  });

  const gapLine = forecast.gapDate
    ? `⚠️ Кассовый разрыв: ~${forecast.gapDate} (уверенность ${(forecast.confidence * 100).toFixed(0)}%)`
    : `✅ Кассового разрыва не ожидается (уверенность ${(forecast.confidence * 100).toFixed(0)}%)`;

  return [
    `📊 *CRM — ${date}*`,
    ``,
    `💰 Поступления: ${fmt(metrics.totalIn)}`,
    `💸 Расходы: ${fmt(metrics.totalOut)}`,
    `📈 Чистый остаток: ${fmt(metrics.netCash)}`,
    ``,
    `🤝 Сделки: ${metrics.dealsCount}  |  Лиды: ${metrics.leadsCount}  |  Звонки: ${metrics.callsCount}`,
    ``,
    gapLine,
  ].join("\n");
}

async function sendTelegram(env: Env, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: "Markdown",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[notify] Telegram API error ${res.status}:`, body);
  }
}
