import type { Db } from "./db.js";
import type { ForecastPlan } from "@crm/core/forecast";
import { type Result, ok, err } from "@crm/core";

const COLLECTION = "business_plan";
const DOC_ID = "active";

/**
 * Загружает активный бизнес-план (входные данные для прогноза).
 * Возвращает null если план ещё не настроен — UI обязан обработать это явно.
 */
export async function loadPlan(
  db: Db,
): Promise<Result<ForecastPlan | null>> {
  try {
    const snap = await db.collection(COLLECTION).doc(DOC_ID).get();

    if (!snap.exists) {
      return ok(null);
    }

    return ok(snap.data() as unknown as ForecastPlan);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message });
  }
}

/**
 * Сохраняет активный бизнес-план.
 *
 * Почему set без merge: план заменяется целиком при каждом сохранении.
 * Частичные обновления (merge) оставляют устаревшие поля, что ломает
 * детерминированность прогноза. Полная замена — безопаснее для MVP.
 */
export async function savePlan(
  db: Db,
  plan: ForecastPlan,
): Promise<Result<void>> {
  try {
    await db.collection(COLLECTION).doc(DOC_ID).set(plan);
    return ok(undefined);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message });
  }
}
