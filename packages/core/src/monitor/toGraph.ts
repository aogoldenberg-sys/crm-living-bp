import type { ExternalSignal } from "@crm/schemas";

export interface ExternalGraphNode {
  type: "external";
  eventId: string;
  title: string;
  section_ref: string;
  impactHint: ExternalSignal["impactHint"];
}

const CATEGORY_TO_SECTION: Record<ExternalSignal["category"], string> = {
  regulatory:    "§20",
  macro:         "§12",
  demand_trend:  "§12",
  competitor:    "§13",
  legal_risk:    "§17",
};

/**
 * Преобразует внешний сигнал в узел причинного графа.
 * Только маппинг — без записи в хранилище.
 */
export function signalToExternalNode(signal: ExternalSignal): ExternalGraphNode {
  return {
    type: "external",
    eventId: signal.eventId,
    title: signal.title,
    section_ref: CATEGORY_TO_SECTION[signal.category],
    impactHint: signal.impactHint,
  };
}
