import type { Db } from "./db.js";
import type { PlanFactMetrics } from "@crm/core";
import { type Result, ok, err } from "@crm/core";

const COLLECTION = "planfact";
const DOC_ID = "latest";

/**
 * Сохраняет агрегированные план/факт метрики за текущий период.
 * Пересчитывается целиком при каждом запуске compute-воркера — один документ latest.
 */
export async function savePlanfact(
  db: Db,
  metrics: PlanFactMetrics,
): Promise<Result<void>> {
  try {
    await db.collection(COLLECTION).doc(DOC_ID).set(metrics);
    return ok(undefined);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message });
  }
}

/**
 * Загружает последние сохранённые план/факт метрики.
 * null — compute ещё не запускался (первый старт системы).
 */
export async function loadPlanfact(
  db: Db,
): Promise<Result<PlanFactMetrics | null>> {
  try {
    const snap = await db.collection(COLLECTION).doc(DOC_ID).get();
    if (!snap.exists) return ok(null);
    return ok(snap.data() as unknown as PlanFactMetrics);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message });
  }
}
