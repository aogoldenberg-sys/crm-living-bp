/**
 * Еженедельный доклад владельцу §17.
 * Понедельник 06:00 UTC. Идемпотентен: повторный запуск за ту же неделю пропускается.
 */

import { createFirestoreRestClient, listTenants, loadForecast, loadEvents } from "@crm/firestore-adapter";
import { buildOwnerReport, formatTelegram, formatTelegramForRole } from "@crm/core";
import type { BusinessEvent, OwnerReport } from "@crm/schemas";

interface ReportSubscriptions {
  ownerChatId: string;
  roles?: Array<{ role: string; chatId: string; sections: string[] }>;
}

async function loadSubscriptions(
  db: ReturnType<typeof createFirestoreRestClient>,
  businessId: string,
  defaultChatId: string,
): Promise<ReportSubscriptions> {
  try {
    const snap = await db
      .collection(`tenants/${businessId}/_meta`)
      .doc("report_subscriptions")
      .get();
    if (snap.exists) return snap.data() as unknown as ReportSubscriptions;
  } catch { /* нет подписок — только owner */ }
  return { ownerChatId: defaultChatId };
}

async function reportExists(
  db: ReturnType<typeof createFirestoreRestClient>,
  businessId: string,
  periodStart: string,
): Promise<boolean> {
  try {
    const snap = await db
      .collection(`tenants/${businessId}/reports`)
      .doc(periodStart)
      .get();
    return snap.exists;
  } catch { return false; }
}

async function saveReport(
  db: ReturnType<typeof createFirestoreRestClient>,
  businessId: string,
  report: OwnerReport,
): Promise<void> {
  await db
    .collection(`tenants/${businessId}/reports`)
    .doc(report.periodStart)
    .set(report as unknown as Record<string, unknown>);
}

async function sendTo(token: string, chatId: string, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
  if (!res.ok) console.error(`[notify-weekly] TG ${res.status}:`, await res.text());
}

async function runForTenant(
  db: ReturnType<typeof createFirestoreRestClient>,
  businessId: string,
  botToken: string,
  defaultChatId: string,
  now: string,
): Promise<void> {
  const [eventsResult, forecastResult] = await Promise.all([
    loadEvents(db, businessId),
    loadForecast(db, businessId),
  ]);

  const events: BusinessEvent[] = eventsResult.ok ? eventsResult.value.events : [];
  const forecast = forecastResult.ok ? forecastResult.value : null;

  const report = buildOwnerReport(businessId, events, forecast, now);

  // Идемпотентность: доклад за этот период уже отправлен
  if (await reportExists(db, businessId, report.periodStart)) {
    console.log(`[notify-weekly] ${businessId}: report for ${report.periodStart} already sent`);
    return;
  }

  const subs = await loadSubscriptions(db, businessId, defaultChatId);
  const text = formatTelegram(report);

  await sendTo(botToken, subs.ownerChatId, text);

  for (const sub of subs.roles ?? []) {
    const roleText = formatTelegramForRole(report, sub.sections);
    await sendTo(botToken, sub.chatId, roleText);
  }

  const deliveredReport: OwnerReport = { ...report, deliveredTo: ["telegram"] };
  await saveReport(db, businessId, deliveredReport);
  console.log(`[notify-weekly] ${businessId}: report sent for ${report.periodStart}`);
}

export async function runWeeklyReports(
  serviceAccountJson: string,
  botToken: string,
  defaultChatId: string,
  now: string,
): Promise<void> {
  const db = createFirestoreRestClient(serviceAccountJson);
  const tenantsResult = await listTenants(db);
  if (!tenantsResult.ok) {
    console.error("[notify-weekly] listTenants failed:", tenantsResult.error);
    return;
  }
  for (const id of tenantsResult.value) {
    await runForTenant(db, id, botToken, defaultChatId, now).catch(e =>
      console.error(`[notify-weekly] ${id} failed:`, e instanceof Error ? e.message : e)
    );
  }
}
