import { randomUUID } from "node:crypto";
import type { CounterpartyRiskSignal } from "@crm/schemas";

const API_URL = "https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party";

interface DaDataSuggestion {
  data: {
    inn: string;
    name?: { full_with_opf?: string };
    state?: { status?: string };
  };
}

interface DaDataResponse {
  suggestions?: DaDataSuggestion[];
}

type RiskStatus = "LIQUIDATING" | "LIQUIDATED" | "REORGANIZING";
const RISK_STATUSES = new Set<string>(["LIQUIDATING", "LIQUIDATED", "REORGANIZING"]);

function statusToSeverity(status: string): CounterpartyRiskSignal["severity"] | null {
  if (status === "LIQUIDATED") return "red";
  if (RISK_STATUSES.has(status)) return "yellow";
  return null;
}

export function parseDaDataResponse(
  json: DaDataResponse,
  inn: string,
  now: string,
): CounterpartyRiskSignal | null {
  const s = json.suggestions?.[0];
  if (!s) return null;

  const status = s.data.state?.status ?? "ACTIVE";
  const severity = statusToSeverity(status);
  if (!severity) return null;

  const name = s.data.name?.full_with_opf ?? inn;
  return {
    type: "counterparty_risk",
    eventId: randomUUID(),
    ts: now as `${string}T${string}Z`,
    inn,
    checkId: "registry_status",
    severity,
    details: `${name}: статус ${status}`,
    sourceUrl: null,
  };
}

export async function fetchDadataSignals(
  inns: string[],
  token: string,
  now: string,
): Promise<{ signals: CounterpartyRiskSignal[]; status: "ok" | "unavailable" }> {
  if (!token || inns.length === 0) return { signals: [], status: "unavailable" };

  const signals: CounterpartyRiskSignal[] = [];

  for (const inn of inns) {
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Token ${token}`,
          "X-Secret": token,
        },
        body: JSON.stringify({ query: inn }),
      });
      if (!res.ok) continue;

      const json = await res.json() as DaDataResponse;
      const signal = parseDaDataResponse(json, inn, now);
      if (signal) signals.push(signal);
    } catch {
      // Ошибка одного ИНН не валит остальные
    }
  }

  return { signals, status: "ok" };
}
