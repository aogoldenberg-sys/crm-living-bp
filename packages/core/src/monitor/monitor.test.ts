import { describe, it, expect } from "vitest";
import { dedupeSignals } from "./dedupe.js";
import { signalToExternalNode } from "./toGraph.js";
import type { ExternalSignal, DemandTrendPoint } from "@crm/schemas";

const TS = "2026-07-13T05:00:00Z";

function mkSignal(title: string, url: string | null = null): ExternalSignal {
  return {
    type: "external_signal",
    eventId: `${Math.random()}`,
    ts: TS, source: "cbr", category: "macro",
    title, summary: "test", url, impactHint: "neutral", relatedInn: null,
  };
}

function mkTrend(keyword: string, period: string): DemandTrendPoint {
  return {
    type: "demand_trend",
    eventId: `${Math.random()}`,
    ts: TS, keyword, period, volume: 1000, trendScore: 0.5, source: "wordstat",
  };
}

describe("dedupeSignals / ExternalSignal", () => {
  it("нет дублей — все проходят", () => {
    const incoming = [mkSignal("A"), mkSignal("B")];
    expect(dedupeSignals([], incoming)).toHaveLength(2);
  });

  it("одинаковый title+source → дубль отфильтровывается", () => {
    const existing = [mkSignal("ЦБ снизил ставку")];
    const incoming = [mkSignal("ЦБ снизил ставку"), mkSignal("Новый сигнал")];
    const result = dedupeSignals(existing, incoming);
    expect(result).toHaveLength(1);
    expect(result[0]!.title).toBe("Новый сигнал");
  });

  it("повторный прогон — 0 новых", () => {
    const signals = [mkSignal("X"), mkSignal("Y")];
    expect(dedupeSignals(signals, signals)).toHaveLength(0);
  });
});

describe("dedupeSignals / DemandTrendPoint", () => {
  it("одинаковый keyword+period → дубль", () => {
    const existing = [mkTrend("глэмпинг", "2026-06-01")];
    const incoming = [mkTrend("глэмпинг", "2026-06-01"), mkTrend("глэмпинг", "2026-07-01")];
    expect(dedupeSignals(existing, incoming)).toHaveLength(1);
  });
});

describe("signalToExternalNode", () => {
  it("macro → §12", () => {
    const node = signalToExternalNode(mkSignal("ставка"));
    expect(node.section_ref).toBe("§12");
    expect(node.type).toBe("external");
  });

  it("regulatory → §20", () => {
    const node = signalToExternalNode({ ...mkSignal("закон"), category: "regulatory" });
    expect(node.section_ref).toBe("§20");
  });

  it("legal_risk → §17", () => {
    const node = signalToExternalNode({ ...mkSignal("иск"), category: "legal_risk" });
    expect(node.section_ref).toBe("§17");
  });

  it("competitor → §13", () => {
    const node = signalToExternalNode({ ...mkSignal("конкурент"), category: "competitor" });
    expect(node.section_ref).toBe("§13");
  });
});
