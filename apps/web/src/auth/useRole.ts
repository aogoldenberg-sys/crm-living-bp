import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "./useAuth";

// ── Local role types (mirror of @crm/schemas Role — not re-exported by @crm/core) ──

type AccessLevel = "none" | "own" | "team" | "all";
type FinanceAccess = "none" | "read" | "write";
type SettingsAccess = "none" | "read" | "write";
type DashboardWidget =
  | "kpi_summary"
  | "pipeline"
  | "cash_forecast"
  | "roadmap"
  | "demand_signals"
  | "funnel_chart"
  | "alerts";
type AlertSubscription =
  | "cash_gap"
  | "stuck_deal"
  | "conversion_drop"
  | "plan_deviation"
  | "new_lead";

export interface EntityAccess {
  deals: AccessLevel;
  clients: AccessLevel;
  financials: FinanceAccess;
  settings: SettingsAccess;
}

export interface Role {
  roleId: string;
  displayName: string;
  entityAccess: EntityAccess;
  dashboardWidgets: DashboardWidget[];
  alertSubscriptions: AlertSubscription[];
}

// ── Default role for manager (narrowest permissions) ─────────────────────────

const DEFAULT_ROLE: Role = {
  roleId: "manager",
  displayName: "Менеджер",
  entityAccess: {
    deals: "own",
    clients: "own",
    financials: "none",
    settings: "none",
  },
  dashboardWidgets: ["kpi_summary", "pipeline"],
  alertSubscriptions: ["stuck_deal", "new_lead"],
};

const OWNER_ROLE: Role = {
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

export interface UseRoleResult {
  roleRecord: Role;
  loading: boolean;
}

// ── Gustoriko roles ───────────────────────────────────────────────────────────

export const GUSTORIKO_ROLES = {
  sales:      { displayName: "Менеджер продаж" },
  assembly:   { displayName: "Формирование заказа" },
  purchasing: { displayName: "Менеджер по закупкам" },
  finance:    { displayName: "Финансист" },
  director:   { displayName: "Руководитель" },
} as const;

export interface UseGustorikoRoleResult {
  roleId: string | null;
  displayName: string | null;
  loading: boolean;
}

/**
 * Читает роль из tenants/gustoriko/emailRoles/{user.email}.
 * Если записи нет — roleId=null (не сотрудник Густорико).
 */
export function useGustorikoRole(): UseGustorikoRoleResult {
  const { user } = useAuth();
  const [result, setResult] = useState<UseGustorikoRoleResult>({
    roleId: null,
    displayName: null,
    loading: true,
  });

  useEffect(() => {
    if (!user?.email) {
      setResult({ roleId: null, displayName: null, loading: false });
      return;
    }

    const docRef = doc(db, `tenants/gustoriko/emailRoles/${user.email}`);

    const unsub = onSnapshot(
      docRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as { roleId: string; displayName: string };
          setResult({ roleId: data.roleId, displayName: data.displayName, loading: false });
        } else {
          setResult({ roleId: null, displayName: null, loading: false });
        }
      },
      (err) => {
        console.error("useGustorikoRole error:", err);
        setResult({ roleId: null, displayName: null, loading: false });
      },
    );

    return () => unsub();
  }, [user?.email]);

  return result;
}

/**
 * Читает полную запись роли из tenants/{businessId}/roles/{userId}.
 * Если документа нет — возвращает DEFAULT_ROLE (manager, самые узкие права).
 * Если auth.role === "owner" и документ отсутствует — возвращает OWNER_ROLE.
 */
export function useRole(businessId: string): UseRoleResult {
  const { user, role: authRole } = useAuth();
  const [result, setResult] = useState<UseRoleResult>({ roleRecord: DEFAULT_ROLE, loading: true });

  useEffect(() => {
    if (!businessId || !user) {
      const fallback = authRole === "owner" ? OWNER_ROLE : DEFAULT_ROLE;
      setResult({ roleRecord: fallback, loading: false });
      return;
    }

    const docRef = doc(db, `tenants/${businessId}/roles/${user.uid}`);

    const unsubscribe = onSnapshot(
      docRef,
      (snap) => {
        if (snap.exists()) {
          setResult({ roleRecord: snap.data() as Role, loading: false });
        } else {
          // Нет документа — используем claim-роль или дефолт
          const fallback = authRole === "owner" ? OWNER_ROLE : DEFAULT_ROLE;
          setResult({ roleRecord: fallback, loading: false });
        }
      },
      (err) => {
        console.error("useRole onSnapshot error:", err);
        const fallback = authRole === "owner" ? OWNER_ROLE : DEFAULT_ROLE;
        setResult({ roleRecord: fallback, loading: false });
      },
    );

    return () => unsubscribe();
  }, [businessId, user, authRole]);

  return result;
}
