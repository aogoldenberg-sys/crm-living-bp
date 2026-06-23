/**
 * Константы имён коллекций Firestore.
 *
 * Используются как справочник при написании новых функций адаптера.
 * Существующие функции не рефакторятся — только новый код использует COL.
 *
 * Структура: tenants/{businessId}/<collection>/{docId}
 */
export const COL = {
  FUNNEL_METRICS: "funnel_metrics",  // tenants/{id}/funnel_metrics/{funnelId}
  DEMAND_SIGNALS: "demand_signals",  // tenants/{id}/demand_signals
  DEALS:          "deals",
  EVENTS:         "events",
  FUNNELS:        "funnels",
  CASH_FORECAST:  "cash_forecast",
  PLANFACT:       "plan_fact",
} as const;
