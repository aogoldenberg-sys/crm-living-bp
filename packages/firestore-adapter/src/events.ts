import type { Firestore, Query, DocumentData } from "firebase-admin/firestore";
import { BusinessEvent } from "@crm/schemas";
import type { IsoDateTime } from "@crm/schemas";
import { type Result, ok, err } from "@crm/core";

const COLLECTION = "events";

/**
 * Загружает события из Firestore, начиная с момента since.
 *
 * Почему фильтр по ts, а не valueDate: ts — момент записи в систему,
 * монотонно возрастающий. Курсор по ts гарантирует отсутствие пропусков
 * при инкрементальной синхронизации. valueDate может быть в прошлом
 * (дата зачисления по банковской выписке) — курсор по нему «пропустит»
 * ретроспективные события.
 *
 * Невалидные документы логируются и пропускаются: грязь из Firestore
 * умирает на этой границе и не попадает в бизнес-логику.
 */
export async function loadEvents(
  db: Firestore,
  since?: IsoDateTime,
): Promise<Result<BusinessEvent[]>> {
  try {
    const col = db.collection(COLLECTION);
    const query: Query<DocumentData> = since !== undefined
      ? col.where("ts", ">=", since)
      : col;

    const snapshot = await query.get();
    const events: BusinessEvent[] = [];

    for (const doc of snapshot.docs) {
      const raw = doc.data();
      const parsed = BusinessEvent.safeParse(raw);

      if (!parsed.success) {
        // Предупреждение вместо краша: один испорченный документ
        // не должен блокировать загрузку всей истории.
        console.warn(
          `[firestore-adapter] loadEvents: invalid document id=${doc.id}, skipping.`,
          parsed.error.issues,
        );
        continue;
      }

      events.push(parsed.data);
    }

    return ok(events);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message });
  }
}

/**
 * Сохраняет события в Firestore используя явный ID (doc(event.eventId).set()).
 *
 * Почему set с явным ID вместо add(): идемпотентность.
 * Повторный вызов с теми же событиями не создаёт дублей.
 * add() генерирует новый ID при каждом вызове — дубли неизбежны при ретрае.
 *
 * Append-only инвариант: .update() и .delete() в этом файле запрещены.
 * Коррекции оформляются отдельным событием payment_correction (см. schemas).
 */
export async function saveEvents(
  db: Firestore,
  events: BusinessEvent[],
): Promise<Result<void>> {
  try {
    const saves = events.map((event) =>
      db.collection(COLLECTION).doc(event.eventId).set(event),
    );
    await Promise.all(saves);
    return ok(undefined);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message });
  }
}
