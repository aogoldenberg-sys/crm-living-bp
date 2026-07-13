import { randomUUID } from "node:crypto";
import type { DemandTrendPoint } from "@crm/schemas";

// Яндекс Директ API: метод CreateNewWordstatReport → GetWordstatReport
// Документация: https://yandex.ru/dev/direct/doc/reports/wordstat/
const API_URL = "https://api.direct.yandex.com/live/v4/json/";

interface WordstatRow {
  Phrase: string;
  Shows: number;
}

interface WordstatReport {
  data?: {
    SearchedWith?: WordstatRow[];
    SearchedAlso?: WordstatRow[];
  }[];
}

export function parseWordstatReport(
  report: WordstatReport,
  keyword: string,
  period: string,
  now: string,
): DemandTrendPoint | null {
  const rows = report.data?.[0]?.SearchedWith ?? [];
  const match = rows.find(r => r.Phrase.toLowerCase() === keyword.toLowerCase());
  if (!match) return null;

  return {
    type: "demand_trend",
    eventId: randomUUID(),
    ts: now as `${string}T${string}Z`,
    keyword,
    period,
    volume: match.Shows,
    trendScore: 0, // EMA-тренд рассчитывается в aggregate при накоплении истории
    source: "wordstat",
  };
}

export async function fetchWordstatSignals(
  keywords: string[],
  token: string,
  now: string,
): Promise<{ signals: DemandTrendPoint[]; status: "ok" | "unavailable" }> {
  if (!token) return { signals: [], status: "unavailable" };

  const period = now.slice(0, 7) + "-01"; // YYYY-MM-01 текущего месяца
  const signals: DemandTrendPoint[] = [];

  for (const keyword of keywords) {
    try {
      const body = {
        method: "CreateNewWordstatReport",
        token,
        param: { Phrases: [keyword], GeoID: [] },
      };
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) continue;

      // Реальный API асинхронен — нужен polling. Здесь: sync-попытка для first-run.
      const reportId = (await res.json() as { data?: number }).data;
      if (!reportId) continue;

      const getBody = { method: "GetWordstatReport", token, param: reportId };
      const getRes = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
        body: JSON.stringify(getBody),
      });
      if (!getRes.ok) continue;

      const report = await getRes.json() as WordstatReport;
      const point = parseWordstatReport(report, keyword, period, now);
      if (point) signals.push(point);
    } catch {
      // Ошибка одного keyword не валит остальные
    }
  }

  return { signals, status: signals.length > 0 ? "ok" : "unavailable" };
}
