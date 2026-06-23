import type { Db } from "./db.js";
import { BusinessPlanV1 } from "@crm/schemas";
import { type Result, ok, err } from "@crm/core";

/**
 * Сохраняет BusinessPlanV1.
 *
 * Путь: tenants/{businessId}/business_plans/{plan.planId}
 *
 * Каждый план под собственным ID (не "active") — чтобы хранить историю версий.
 * ForecastPlan в business_plan/active — отдельный механизм, не трогаем.
 */
export async function saveBusinessPlan(
  db: Db,
  businessId: string,
  plan: BusinessPlanV1,
): Promise<Result<void>> {
  try {
    await db
      .collection(`tenants/${businessId}/business_plans`)
      .doc(plan.planId)
      .set(plan as unknown as Record<string, unknown>);
    return ok(undefined);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message });
  }
}

/**
 * Загружает BusinessPlanV1 по planId.
 * Возвращает null если документ не найден.
 * Валидирует через BusinessPlanV1.parse() перед возвратом.
 */
export async function loadBusinessPlan(
  db: Db,
  businessId: string,
  planId: string,
): Promise<Result<BusinessPlanV1 | null>> {
  try {
    const snap = await db
      .collection(`tenants/${businessId}/business_plans`)
      .doc(planId)
      .get();

    if (!snap.exists) {
      return ok(null);
    }

    const raw = snap.data();
    const parsed = BusinessPlanV1.safeParse(raw);

    if (!parsed.success) {
      return err({
        code: "STORAGE_ERROR",
        message: `Документ business_plans/${planId} не прошёл валидацию: ${parsed.error.message}`,
      });
    }

    return ok(parsed.data);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message });
  }
}
