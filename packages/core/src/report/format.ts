import type { OwnerReport } from "@crm/schemas";

const MAX_LEN = 3500;

function rub(kopecks: number): string {
  return (kopecks / 100).toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₽";
}

/**
 * Форматирует OwnerReport в Telegram-сообщение ≤ 3500 символов.
 * Структура: касса → gap → топ-3 отклонения → рекомендация.
 */
export function formatTelegram(report: OwnerReport): string {
  const lines: string[] = [
    `📊 *Доклад [${report.businessId}]* ${report.periodStart} — ${report.periodEnd}`,
    ``,
    `💰 Остаток: ${rub(report.cash.balance)}`,
  ];

  if (report.cash.gapDate) {
    const gapAmt = report.cash.gapAmount !== null ? ` (${rub(report.cash.gapAmount)})` : "";
    lines.push(`⚠️ Кассовый разрыв: ~${report.cash.gapDate}${gapAmt}, уверенность ${Math.round(report.cash.confidence * 100)}%`);
  } else {
    lines.push(`✅ Кассового разрыва не ожидается (уверенность ${Math.round(report.cash.confidence * 100)}%)`);
  }

  if (report.topDeviations.length > 0) {
    lines.push(``, `*Отклонения от плана:*`);
    for (const d of report.topDeviations) {
      const sign = d.deviationPct >= 0 ? "+" : "";
      const chain = d.causeChain.length > 0 ? ` → ${d.causeChain[0]}` : "";
      lines.push(`• ${d.metric}: ${sign}${d.deviationPct.toFixed(1)}%${chain}`);
    }
  }

  if (report.recommendation) {
    lines.push(``, `📌 ${report.recommendation}`);
  }

  if (report.cash.confidence < 0.4) {
    lines.push(``, `_Данных пока недостаточно — доклад будет точнее после накопления истории._`);
  }

  const text = lines.join("\n");
  return text.length <= MAX_LEN ? text : text.slice(0, MAX_LEN - 3) + "...";
}
