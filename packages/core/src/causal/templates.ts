import type { CausalGraph } from "@crm/schemas";

export const RETAIL_TEMPLATE: CausalGraph = {
  nodes: [
    { id: "ad_spend",      label: "Рекламные расходы",    type: "external" },
    { id: "lead_count",    label: "Количество лидов",     type: "metric" },
    { id: "conversion",    label: "Конверсия в сделку",   type: "process" },
    { id: "revenue",       label: "Выручка",              type: "outcome" },
    { id: "margin",        label: "Маржа",                type: "outcome" },
    { id: "market_demand", label: "Спрос рынка",          type: "external" },
  ],
  edges: [
    { from: "ad_spend",      to: "lead_count",  direction:  1, strength: 0.7, lag_days: 3,  evidence: [], origin: "template" },
    { from: "market_demand", to: "lead_count",  direction:  1, strength: 0.5, lag_days: 0,  evidence: [], origin: "template" },
    { from: "lead_count",    to: "revenue",     direction:  1, strength: 0.8, lag_days: 14, evidence: [], origin: "template" },
    { from: "conversion",    to: "revenue",     direction:  1, strength: 0.9, lag_days: 7,  evidence: [], origin: "template" },
    { from: "ad_spend",      to: "margin",      direction: -1, strength: 0.6, lag_days: 0,  evidence: [], origin: "template" },
    { from: "revenue",       to: "margin",      direction:  1, strength: 0.8, lag_days: 0,  evidence: [], origin: "template" },
  ],
};
