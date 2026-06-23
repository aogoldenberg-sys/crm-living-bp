import { randomUUID } from "crypto";
import type { Db } from "./db.js";
import { BusinessPlanV1 } from "@crm/schemas";
import { type Result, ok, err } from "@crm/core";
import { loadIntake } from "./intake.js";
import { saveBusinessPlan } from "./businessPlan.js";

/**
 * Явное действие человека: переводит plan_intake из "draft" в "accepted_as_v1"
 * и создаёт BusinessPlanV1 под tenants/{businessId}/business_plans/{planId}.
 *
 * Идемпотентность: повторный вызов на уже принятом intake возвращает
 * err({ code: "ALREADY_ACCEPTED" }) — план второй раз не создаётся.
 *
 * Алгоритм:
 *   1. Загрузить intake; если не найден → NOT_FOUND.
 *   2. Проверить статус: "accepted_as_v1" → ALREADY_ACCEPTED (идемпотентно).
 *   3. Собрать BusinessPlanV1 из данных intake.
 *   4. Сохранить plan в business_plans/{planId}.
 *   5. Обновить intake.status → "accepted_as_v1".
 *   6. Вернуть ok({ planId }).
 */
export async function acceptIntake(
  db: Db,
  businessId: string,
  intakeId: string,
): Promise<Result<{ planId: string }>> {
  // 1. Загрузить intake
  const loadResult = await loadIntake(db, businessId, intakeId);
  if (!loadResult.ok) {
    return loadResult;
  }

  const intake = loadResult.value;

  if (intake === null) {
    return err({ code: "NOT_FOUND", message: "intake не найден" });
  }

  // 2. Идемпотентность: уже принят
  if (intake.status === "accepted_as_v1") {
    return err({ code: "ALREADY_ACCEPTED", message: "intake уже принят" });
  }

  // 3. Собрать BusinessPlanV1
  const planId = randomUUID();
  const plan: BusinessPlanV1 = {
    planId,
    businessId,
    version: 1,
    status: "active",
    parentVersion: null,
    sourceIntakeId: intakeId,
    createdAt: new Date().toISOString(),
    assumptions: intake.assessment.assumptionsExtracted,
  };

  // 4. Сохранить план
  const saveResult = await saveBusinessPlan(db, businessId, plan);
  if (!saveResult.ok) {
    return saveResult;
  }

  // 5. Обновить intake: status → "accepted_as_v1"
  try {
    await db
      .collection(`tenants/${businessId}/plan_intake`)
      .doc(intakeId)
      .set({ ...intake, status: "accepted_as_v1" } as unknown as Record<string, unknown>);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message });
  }

  // 6. Вернуть ok
  return ok({ planId });
}
