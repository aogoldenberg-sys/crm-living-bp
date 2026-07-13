import { randomUUID } from "node:crypto";
import type { ExternalSignal } from "@crm/schemas";

interface CbrDailyJson {
  Date: string;
  Valute?: Record<string, { CharCode: string; Value: number; Previous: number }>;
}

/**
 * Парсит ответ cbr-xml-daily.ru.
 * Изменение USD/EUR > 1% → ExternalSignal category:macro.
 * Ключ не нужен.
 */
export function parseCbrDaily(json: CbrDailyJson, now: string): ExternalSignal[] {
  const signals: ExternalSignal[] = [];
  const valute = json.Valute ?? {};

  for (const [, cur] of Object.entries(valute)) {
    if (!["USD", "EUR", "CNY"].includes(cur.CharCode)) continue;
    const delta = Math.abs((cur.Value - cur.Previous) / cur.Previous);
    if (delta < 0.01) continue; // менее 1% — не сигнал

    const direction = cur.Value > cur.Previous ? "выше" : "ниже";
    signals.push({
      type: "external_signal",
      eventId: randomUUID(),
      ts: now as `${string}T${string}Z`,
      source: "cbr",
      category: "macro",
      title: `${cur.CharCode} ${direction} на ${(delta * 100).toFixed(1)}%`,
      summary: `Курс ${cur.CharCode}: ${cur.Previous} → ${cur.Value} ₽`,
      url: "https://www.cbr.ru",
      impactHint: "negative",
      relatedInn: null,
    });
  }

  return signals;
}

export async function fetchCbrSignals(now: string): Promise<{ signals: ExternalSignal[]; status: "ok" | "unavailable" }> {
  try {
    const res = await fetch("https://www.cbr-xml-daily.ru/daily_json.js");
    if (!res.ok) return { signals: [], status: "unavailable" };
    const json = await res.json() as CbrDailyJson;
    return { signals: parseCbrDaily(json, now), status: "ok" };
  } catch {
    return { signals: [], status: "unavailable" };
  }
}
