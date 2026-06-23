import { describe, it, expect } from "vitest";
import {
  Role,
  EntityAccess,
  DashboardWidget,
  AlertSubscription,
  ROLE_OWNER,
  ROLE_MANAGER,
  ROLE_MARKETER,
  ROLE_PRESETS,
} from "./roles.js";

// ── EntityAccess ──────────────────────────────────────────────────────────────

describe("EntityAccess schema", () => {
  it("принимает валидный объект", () => {
    const result = EntityAccess.safeParse({
      deals: "all",
      clients: "own",
      financials: "read",
      settings: "none",
    });
    expect(result.success).toBe(true);
  });

  it("принимает deals = 'team'", () => {
    const result = EntityAccess.safeParse({
      deals: "team",
      clients: "own",
      financials: "read",
      settings: "none",
    });
    expect(result.success).toBe(true);
  });

  it("отклоняет невалидный уровень доступа", () => {
    const result = EntityAccess.safeParse({
      deals: "admin",  // не в enum
      clients: "own",
      financials: "read",
      settings: "none",
    });
    expect(result.success).toBe(false);
  });

  it(".strict() — отклоняет лишние поля", () => {
    const result = EntityAccess.safeParse({
      deals: "all",
      clients: "own",
      financials: "read",
      settings: "none",
      extraField: "oops",
    });
    expect(result.success).toBe(false);
  });
});

// ── Role schema ───────────────────────────────────────────────────────────────

describe("Role schema", () => {
  it("принимает валидную роль", () => {
    const result = Role.safeParse(ROLE_OWNER);
    expect(result.success).toBe(true);
  });

  it("roleId не может быть пустой строкой", () => {
    const result = Role.safeParse({ ...ROLE_OWNER, roleId: "" });
    expect(result.success).toBe(false);
  });

  it("displayName не может быть пустой строкой", () => {
    const result = Role.safeParse({ ...ROLE_OWNER, displayName: "" });
    expect(result.success).toBe(false);
  });

  it(".strict() — отклоняет лишние поля", () => {
    const result = Role.safeParse({ ...ROLE_OWNER, unknown: "field" });
    expect(result.success).toBe(false);
  });

  it("dashboardWidgets может быть пустым массивом", () => {
    const result = Role.safeParse({ ...ROLE_MANAGER, dashboardWidgets: [] });
    expect(result.success).toBe(true);
  });

  it("невалидный виджет отклоняется", () => {
    const result = Role.safeParse({
      ...ROLE_MANAGER,
      dashboardWidgets: ["kpi_summary", "nonexistent_widget"],
    });
    expect(result.success).toBe(false);
  });

  it("невалидный алерт отклоняется", () => {
    const result = Role.safeParse({
      ...ROLE_MANAGER,
      alertSubscriptions: ["stuck_deal", "unknown_alert"],
    });
    expect(result.success).toBe(false);
  });
});

// ── Пресет: owner ─────────────────────────────────────────────────────────────

describe("ROLE_OWNER пресет", () => {
  it("roleId = 'owner'", () => {
    expect(ROLE_OWNER.roleId).toBe("owner");
  });

  it("deals = 'all' (владелец видит все сделки)", () => {
    expect(ROLE_OWNER.entityAccess.deals).toBe("all");
  });

  it("financials = 'write'", () => {
    expect(ROLE_OWNER.entityAccess.financials).toBe("write");
  });

  it("settings = 'write'", () => {
    expect(ROLE_OWNER.entityAccess.settings).toBe("write");
  });

  it("видит cash_forecast и roadmap", () => {
    expect(ROLE_OWNER.dashboardWidgets).toContain("cash_forecast");
    expect(ROLE_OWNER.dashboardWidgets).toContain("roadmap");
  });

  it("подписан на все алерты", () => {
    const allAlerts: string[] = AlertSubscription.options;
    allAlerts.forEach((a) => {
      expect(ROLE_OWNER.alertSubscriptions).toContain(a);
    });
  });

  it("валидируется по схеме Role", () => {
    expect(Role.safeParse(ROLE_OWNER).success).toBe(true);
  });
});

// ── Пресет: manager ───────────────────────────────────────────────────────────

describe("ROLE_MANAGER пресет", () => {
  it("roleId = 'manager'", () => {
    expect(ROLE_MANAGER.roleId).toBe("manager");
  });

  it("deals = 'own' (только свои сделки)", () => {
    expect(ROLE_MANAGER.entityAccess.deals).toBe("own");
  });

  it("financials = 'none'", () => {
    expect(ROLE_MANAGER.entityAccess.financials).toBe("none");
  });

  it("не видит cash_forecast и roadmap", () => {
    expect(ROLE_MANAGER.dashboardWidgets).not.toContain("cash_forecast");
    expect(ROLE_MANAGER.dashboardWidgets).not.toContain("roadmap");
  });

  it("не подписан на cash_gap и plan_deviation", () => {
    expect(ROLE_MANAGER.alertSubscriptions).not.toContain("cash_gap");
    expect(ROLE_MANAGER.alertSubscriptions).not.toContain("plan_deviation");
  });

  it("валидируется по схеме Role", () => {
    expect(Role.safeParse(ROLE_MANAGER).success).toBe(true);
  });
});

// ── Пресет: marketer ─────────────────────────────────────────────────────────

describe("ROLE_MARKETER пресет", () => {
  it("roleId = 'marketer'", () => {
    expect(ROLE_MARKETER.roleId).toBe("marketer");
  });

  it("deals = 'none' (аналитика из demand_signals, не из сделок, §6)", () => {
    expect(ROLE_MARKETER.entityAccess.deals).toBe("none");
  });

  it("clients = 'none' (нет доступа к персональным данным)", () => {
    expect(ROLE_MARKETER.entityAccess.clients).toBe("none");
  });

  it("видит demand_signals и funnel_chart", () => {
    expect(ROLE_MARKETER.dashboardWidgets).toContain("demand_signals");
    expect(ROLE_MARKETER.dashboardWidgets).toContain("funnel_chart");
  });

  it("не видит cash_forecast и roadmap", () => {
    expect(ROLE_MARKETER.dashboardWidgets).not.toContain("cash_forecast");
    expect(ROLE_MARKETER.dashboardWidgets).not.toContain("roadmap");
  });

  it("подписан на conversion_drop и new_lead", () => {
    expect(ROLE_MARKETER.alertSubscriptions).toContain("conversion_drop");
    expect(ROLE_MARKETER.alertSubscriptions).toContain("new_lead");
  });

  it("не имеет доступа к сделкам (deals === 'none')", () => {
    expect(ROLE_MARKETER.entityAccess.deals).toBe("none");
  });

  it("валидируется по схеме Role", () => {
    expect(Role.safeParse(ROLE_MARKETER).success).toBe(true);
  });
});

// ── ROLE_PRESETS ──────────────────────────────────────────────────────────────

describe("ROLE_PRESETS", () => {
  it("содержит 3 пресета", () => {
    expect(ROLE_PRESETS).toHaveLength(3);
  });

  it("все пресеты имеют уникальные roleId", () => {
    const ids = ROLE_PRESETS.map((r) => r.roleId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("все пресеты валидируются по схеме Role", () => {
    ROLE_PRESETS.forEach((preset) => {
      expect(Role.safeParse(preset).success).toBe(true);
    });
  });
});
