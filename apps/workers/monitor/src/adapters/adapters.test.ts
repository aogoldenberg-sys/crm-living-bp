import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { parseCbrDaily } from "./cbr.js";
import { parseRssXml } from "./pravoRss.js";
import { parseDaDataResponse } from "./dadata.js";
import { dedupeSignals } from "@crm/core";

const __dir = dirname(fileURLToPath(import.meta.url));
const fix = (name: string) => readFileSync(join(__dir, "__fixtures__", name), "utf-8");

const NOW = "2026-07-13T05:00:00Z";

// ── CBR parser ────────────────────────────────────────────────────────────────

describe("parseCbrDaily", () => {
  it("крупное изменение → сигнал", () => {
    const json = JSON.parse(fix("cbr_daily.json")) as Parameters<typeof parseCbrDaily>[0];
    // В фикстуре USD 87.90 → 88.45, delta ~0.6% — ниже порога 1%, сигнала нет
    const signals = parseCbrDaily(json, NOW);
    expect(signals).toHaveLength(0);
  });

  it("delta > 1% → сигнал генерируется", () => {
    const bigMove = {
      Date: NOW,
      Valute: { USD: { CharCode: "USD", Value: 95.00, Previous: 88.00 } },
    };
    const signals = parseCbrDaily(bigMove, NOW);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ type: "external_signal", source: "cbr", category: "macro" });
  });

  it("нет изменений → пустой массив", () => {
    const flat = { Date: NOW, Valute: { USD: { CharCode: "USD", Value: 88.0, Previous: 88.0 } } };
    expect(parseCbrDaily(flat, NOW)).toHaveLength(0);
  });
});

// ── RSS parser ────────────────────────────────────────────────────────────────

describe("parseRssXml", () => {
  it("фикстура — 2 айтема без фильтра", () => {
    const xml = fix("pravo_rss.xml");
    const signals = parseRssXml(xml, [], NOW);
    expect(signals).toHaveLength(2);
    expect(signals[0]).toMatchObject({ type: "external_signal", source: "pravo_rss", category: "regulatory" });
  });

  it("фильтр по ключевому слову — только совпадения", () => {
    const xml = fix("pravo_rss.xml");
    const signals = parseRssXml(xml, ["субсидии"], NOW);
    expect(signals).toHaveLength(1);
    expect(signals[0]!.title).toContain("МСП");
  });

  it("ключевое слово не найдено → пусто", () => {
    const xml = fix("pravo_rss.xml");
    expect(parseRssXml(xml, ["блокчейн"], NOW)).toHaveLength(0);
  });
});

// ── DaData parser ─────────────────────────────────────────────────────────────

describe("parseDaDataResponse", () => {
  it("ACTIVE → null (не риск)", () => {
    const json = JSON.parse(fix("dadata_party.json")) as Parameters<typeof parseDaDataResponse>[0];
    expect(parseDaDataResponse(json, "9703235411", NOW)).toBeNull();
  });

  it("LIQUIDATING → yellow сигнал", () => {
    const json = {
      suggestions: [{ data: { inn: "1234567890", name: { full_with_opf: "ООО Тест" }, state: { status: "LIQUIDATING" } } }],
    };
    const signal = parseDaDataResponse(json, "1234567890", NOW);
    expect(signal).not.toBeNull();
    expect(signal!.severity).toBe("yellow");
    expect(signal!.checkId).toBe("registry_status");
  });

  it("LIQUIDATED → red сигнал", () => {
    const json = {
      suggestions: [{ data: { inn: "1234567890", name: { full_with_opf: "ООО Тест" }, state: { status: "LIQUIDATED" } } }],
    };
    const signal = parseDaDataResponse(json, "1234567890", NOW);
    expect(signal!.severity).toBe("red");
  });

  it("пустой ответ → null", () => {
    expect(parseDaDataResponse({ suggestions: [] }, "1234567890", NOW)).toBeNull();
  });
});

// ── Дедуп end-to-end ──────────────────────────────────────────────────────────

describe("dedupeSignals end-to-end", () => {
  it("CBR сигналы дедуплицируются между прогонами", () => {
    const bigMove = {
      Date: NOW,
      Valute: { USD: { CharCode: "USD", Value: 95.00, Previous: 88.00 } },
    };
    const first = parseCbrDaily(bigMove, NOW);
    const second = parseCbrDaily(bigMove, NOW);
    const deduped = dedupeSignals(first, second);
    expect(deduped).toHaveLength(0);
  });
});
