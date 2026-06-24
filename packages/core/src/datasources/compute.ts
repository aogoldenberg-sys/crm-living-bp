import type {
  ConnectedSources,
  DataReadinessReport,
  DataSourceId,
  DataSourceInfo,
  ModuleReadiness,
  PlanPresence,
} from "./types.js";

const SOURCE_LABELS: Record<DataSourceId, string> = {
  bank_api: "Банковский API",
  ads_api: "Рекламный кабинет",
  telephony: "Телефония",
  crm_manual: "Ручной ввод CRM",
  plan_document: "Бизнес-план",
};

/**
 * Compute the full data readiness report.
 * Pure function. No I/O.
 *
 * @param connected  which sources are currently active
 * @param plan       plan/intake presence flags
 */
export function computeDataReadiness(
  connected: ConnectedSources,
  plan: PlanPresence,
): DataReadinessReport {
  const isActive = (id: DataSourceId): boolean => {
    if (id === "crm_manual") return true;
    if (id === "plan_document") return plan.hasPlan;
    return connected.active.has(id);
  };

  // Build sources array
  const sources: DataSourceInfo[] = [
    isActive("bank_api")
      ? { id: "bank_api", label: SOURCE_LABELS.bank_api, status: "active" }
      : {
          id: "bank_api",
          label: SOURCE_LABELS.bank_api,
          status: "dormant",
          reason: "Банковский API не подключён",
          action: "Подключите интеграцию с банком",
        },
    isActive("ads_api")
      ? { id: "ads_api", label: SOURCE_LABELS.ads_api, status: "active" }
      : {
          id: "ads_api",
          label: SOURCE_LABELS.ads_api,
          status: "dormant",
          reason: "Рекламный кабинет не подключён",
          action: "Подключите Google Ads или Яндекс.Директ",
        },
    isActive("telephony")
      ? { id: "telephony", label: SOURCE_LABELS.telephony, status: "active" }
      : {
          id: "telephony",
          label: SOURCE_LABELS.telephony,
          status: "dormant",
          reason: "Телефония не подключена",
          action: "Подключите интеграцию с телефонией",
        },
    // crm_manual is always active
    { id: "crm_manual", label: SOURCE_LABELS.crm_manual, status: "active" },
    plan.hasPlan
      ? { id: "plan_document", label: SOURCE_LABELS.plan_document, status: "active" }
      : {
          id: "plan_document",
          label: SOURCE_LABELS.plan_document,
          status: "dormant",
          reason: "Бизнес-план не загружен",
          action: "Загрузите бизнес-план",
        },
  ];

  // Module definitions: [moduleId, label, requiredSources]
  const moduleDefs: Array<[string, string, DataSourceId[]]> = [
    ["uniteconomics", "Юнит-экономика", ["bank_api", "crm_manual"]],
    ["funnel", "Воронка продаж", ["crm_manual"]],
    ["forecast", "Прогноз денежного потока", ["bank_api"]],
    ["causal", "Причинный граф", ["plan_document"]],
    ["demand", "Сигналы спроса", ["ads_api", "telephony"]],
    ["lenses_abc", "ABC/XYZ анализ", ["bank_api", "crm_manual"]],
  ];

  const modules: ModuleReadiness[] = moduleDefs.map(([moduleId, label, requiredSources]) => {
    const missingActive = requiredSources.filter((sid) => !isActive(sid));

    if (missingActive.length === 0) {
      return {
        moduleId,
        label,
        status: "active",
        requiredSources,
        missingActive: [],
        reason: "Все источники подключены",
      };
    }

    // Confidence gate (§14): if ALL required sources missing AND crm_manual is not
    // among the required sources (or also missing) → unavailable
    const allMissing = missingActive.length === requiredSources.length;
    const requiresCrmManual = requiredSources.includes("crm_manual");
    const status =
      allMissing && !requiresCrmManual ? "unavailable" : "dormant";

    const missingLabels = missingActive
      .map((sid) => SOURCE_LABELS[sid])
      .join(", ");

    return {
      moduleId,
      label,
      status,
      requiredSources,
      missingActive,
      reason: `Нет данных от: ${missingLabels}`,
      action: `Подключите: ${missingLabels}`,
    };
  });

  const activeCount = sources.filter((s) => s.status === "active").length;
  // crm_manual is always active, so viable is always true
  const viable = isActive("bank_api") || isActive("crm_manual");

  return { sources, modules, activeCount, viable };
}
