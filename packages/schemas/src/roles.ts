import { z } from "zod";

/**
 * Роль = конфиг, не код. §6 архитектуры.
 * Все проверки через Zod — одна схема = типы + runtime-валидация + документация.
 *
 * Проекция в UI (скрытие виджетов, фильтрация данных) — отдельный слой,
 * здесь только декларация прав.
 */

// ── Доступ к сущностям ────────────────────────────────────────────────────────

/** none | own (только свои) | team (своя команда) | all */
export const AccessLevel = z.enum(["none", "own", "team", "all"]);
export type AccessLevel = z.infer<typeof AccessLevel>;

export const FinanceAccess = z.enum(["none", "read", "write"]);
export type FinanceAccess = z.infer<typeof FinanceAccess>;

export const SettingsAccess = z.enum(["none", "read", "write"]);
export type SettingsAccess = z.infer<typeof SettingsAccess>;

export const EntityAccess = z.object({
  /** Доступ к сделкам: none / own (только свои) / team (команда) / all. */
  deals: AccessLevel,
  /** Доступ к карточкам клиентов. */
  clients: AccessLevel,
  /** Доступ к финансовым данным (plan_fact, cash_forecast). */
  financials: FinanceAccess,
  /** Доступ к настройкам системы (воронки, пресеты, тенант). */
  settings: SettingsAccess,
}).strict();

export type EntityAccess = z.infer<typeof EntityAccess>;

// ── Виджеты дашборда ──────────────────────────────────────────────────────────

export const DashboardWidget = z.enum([
  "kpi_summary",
  "pipeline",
  "cash_forecast",
  "roadmap",
  "demand_signals",
  "funnel_chart",
  "alerts",
]);

export type DashboardWidget = z.infer<typeof DashboardWidget>;

// ── Подписки на алерты ────────────────────────────────────────────────────────

export const AlertSubscription = z.enum([
  "cash_gap",          // кассовый разрыв < 45 дней
  "stuck_deal",        // сделка превысила normDays
  "conversion_drop",   // конверсия упала ниже порога
  "plan_deviation",    // отклонение от плана > порога
  "new_lead",          // новый лид захвачен
]);

export type AlertSubscription = z.infer<typeof AlertSubscription>;

// ── Схема роли ────────────────────────────────────────────────────────────────

export const Role = z.object({
  /** Уникальный идентификатор роли. */
  roleId: z.string().min(1),
  /** Отображаемое название для UI. */
  displayName: z.string().min(1),
  entityAccess: EntityAccess,
  /** Виджеты, доступные в дашборде. Порядок не важен. */
  dashboardWidgets: z.array(DashboardWidget),
  /** Алерты, которые получает роль. */
  alertSubscriptions: z.array(AlertSubscription),
}).strict();

export type Role = z.infer<typeof Role>;

// ── Пресеты (§6) ──────────────────────────────────────────────────────────────

/**
 * Владелец бизнеса. §6
 * Полная картина: касса, gap, сводка, все сделки.
 * Владелец ≠ КД — у него нет ограничений по команде.
 * КД (deals="team") — отдельная роль, пресет не добавлен.
 */
export const ROLE_OWNER: Role = {
  roleId: "owner",
  displayName: "Владелец",
  entityAccess: {
    deals: "all",
    clients: "all",
    financials: "write",
    settings: "write",
  },
  dashboardWidgets: [
    "kpi_summary",
    "pipeline",
    "cash_forecast",
    "roadmap",
    "demand_signals",
    "funnel_chart",
    "alerts",
  ],
  alertSubscriptions: [
    "cash_gap",
    "stuck_deal",
    "conversion_drop",
    "plan_deviation",
    "new_lead",
  ],
};

/**
 * Менеджер по продажам.
 * Видит только свои сделки, без финансов и настроек.
 * Получает алерты по своим застрявшим сделкам и новым лидам.
 */
export const ROLE_MANAGER: Role = {
  roleId: "manager",
  displayName: "Менеджер по продажам",
  entityAccess: {
    deals: "own",
    clients: "own",
    financials: "none",
    settings: "none",
  },
  dashboardWidgets: [
    "kpi_summary",
    "pipeline",
    "funnel_chart",
    "alerts",
  ],
  alertSubscriptions: [
    "stuck_deal",
    "new_lead",
  ],
};

/**
 * Маркетолог. §6
 * Аналитика спроса строится из demand_signals — прямой доступ к сделкам не нужен.
 * Касса и финмодель скрыты.
 */
export const ROLE_MARKETER: Role = {
  roleId: "marketer",
  displayName: "Маркетолог",
  entityAccess: {
    deals: "none",
    clients: "none",
    financials: "none",
    settings: "none",
  },
  dashboardWidgets: [
    "kpi_summary",
    "demand_signals",
    "funnel_chart",
    "alerts",
  ],
  alertSubscriptions: [
    "conversion_drop",
    "new_lead",
  ],
};

/** Все пресеты — для генерации UI или seed-скриптов. */
export const ROLE_PRESETS: readonly Role[] = [
  ROLE_OWNER,
  ROLE_MANAGER,
  ROLE_MARKETER,
] as const;
