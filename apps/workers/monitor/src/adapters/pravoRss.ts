import { randomUUID } from "node:crypto";
import type { ExternalSignal } from "@crm/schemas";

const RSS_URL = "http://publication.pravo.gov.ru/rss";

function parseRssItems(xml: string): Array<{ title: string; link: string; pubDate: string }> {
  const items: Array<{ title: string; link: string; pubDate: string }> = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;

  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1] ?? "";
    const title = /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/.exec(block);
    const link = /<link>(.*?)<\/link>/.exec(block);
    const pub = /<pubDate>(.*?)<\/pubDate>/.exec(block);
    if (title && link) {
      items.push({
        title: (title[1] ?? title[2] ?? "").trim(),
        link: link[1]?.trim() ?? "",
        pubDate: pub?.[1]?.trim() ?? "",
      });
    }
  }
  return items;
}

function matchesKeywords(title: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const low = title.toLowerCase();
  return keywords.some(k => low.includes(k.toLowerCase()));
}

export function parseRssXml(xml: string, keywords: string[], now: string): ExternalSignal[] {
  return parseRssItems(xml)
    .filter(item => matchesKeywords(item.title, keywords))
    .map(item => ({
      type: "external_signal" as const,
      eventId: randomUUID(),
      ts: now as `${string}T${string}Z`,
      source: "pravo_rss" as const,
      category: "regulatory" as const,
      title: item.title.slice(0, 200),
      summary: item.title,
      url: item.link || null,
      impactHint: "unknown" as const,
      relatedInn: null,
    }));
}

export async function fetchPravoRssSignals(
  keywords: string[],
  now: string,
): Promise<{ signals: ExternalSignal[]; status: "ok" | "unavailable" }> {
  try {
    const res = await fetch(RSS_URL);
    if (!res.ok) return { signals: [], status: "unavailable" };
    const xml = await res.text();
    return { signals: parseRssXml(xml, keywords, now), status: "ok" };
  } catch {
    return { signals: [], status: "unavailable" };
  }
}
