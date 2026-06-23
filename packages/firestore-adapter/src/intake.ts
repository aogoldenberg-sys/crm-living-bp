import type { Db } from "./db.js";
import { PlanIntake } from "@crm/schemas";
import { type Result, ok, err } from "@crm/core";

/**
 * Сохраняет результат intake-анализа бизнес-плана.
 *
 * Путь: tenants/{businessId}/plan_intake/{intakeId}
 *
 * Почему явный ID (intakeId): intake создаётся один раз и ссылается на него
 * из других документов. Firestore auto-ID создал бы непредсказуемый ключ,
 * который пришлось бы читать обратно. UUID из schemas гарантирует уникальность.
 *
 * status НЕ меняется: saveIntake сохраняет как есть — переход в "accepted_as_v1"
 * только явным действием человека, не автоматически.
 */
export async function saveIntake(
  db: Db,
  businessId: string,
  intake: PlanIntake,
): Promise<Result<void>> {
  try {
    await db
      .collection(`tenants/${businessId}/plan_intake`)
      .doc(intake.intakeId)
      .set(intake as unknown as Record<string, unknown>);
    return ok(undefined);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message });
  }
}

/**
 * Загружает intake по ID.
 * Возвращает null если документ не найден.
 * Валидирует через PlanIntake.parse() перед возвратом: защита от грязи в Firestore.
 */
export async function loadIntake(
  db: Db,
  businessId: string,
  intakeId: string,
): Promise<Result<PlanIntake | null>> {
  try {
    const snap = await db
      .collection(`tenants/${businessId}/plan_intake`)
      .doc(intakeId)
      .get();

    if (!snap.exists) {
      return ok(null);
    }

    const raw = snap.data();
    const parsed = PlanIntake.safeParse(raw);

    if (!parsed.success) {
      return err({
        code: "STORAGE_ERROR",
        message: `Документ plan_intake/${intakeId} не прошёл валидацию: ${parsed.error.message}`,
      });
    }

    return ok(parsed.data);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message });
  }
}
