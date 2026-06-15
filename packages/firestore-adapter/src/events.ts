import type { Db, Query } from "./db.js";
import { BusinessEvent } from "@crm/schemas";
import type { IsoDateTime } from "@crm/schemas";
import { type Result, ok, err } from "@crm/core";

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
export type LoadEventsResult = { events: BusinessEvent[]; skipped: number };

/**
 * Загружает события из Firestore, начиная с момента since.
 *
 * Почему фильтр по ts, а не valueDate: ts — момент записи в систему,
 * монотонно возрастающий. Курсор по ts гарантирует отсутствие пропусков
 * при инкрементальной синхронизации. valueDate может быть в прошлом
 * (дата зачисления по банковской выписке) — курсор по нему «пропустит»
 * ретроспективные события.
 *
 * orderBy("ts") обязателен: Firestore не гарантирует порядок по doc id,
 * а лексикографический порядок ts === хронологический только при Z-суффиксе
 * (инвариант из IsoDateTime в schemas).
 *
 * skipped в ответе — не тихая потеря: вызывающий код обязан залогировать
 * или передать счётчик в метрику. Игнорировать нельзя.
 */
export async function loadEvents(
  db: Db,
  businessId: string,
  since?: IsoDateTime,
): Promise<Result<LoadEventsResult>> {
  try {
    const col = db.collection(`tenants/${businessId}/events`);
    const query: Query = since !== undefined
      ? col.where("ts", ">=", since).orderBy("ts")
      : col.orderBy("ts");

    const snapshot = await query.get();
    const events: BusinessEvent[] = [];
    let skipped = 0;

    for (const doc of snapshot.docs) {
      const raw = doc.data();
      const parsed = BusinessEvent.safeParse(raw);

      if (!parsed.success) {
        // Считаем, не только предупреждаем: вызывающий код видит реальный счётчик потерь.
        console.warn(
          `[firestore-adapter] loadEvents: invalid document id=${doc.id}, skipping.`,
          parsed.error.issues,
        );
        skipped++;
        continue;
      }

      events.push(parsed.data);
    }

    return ok({ events, skipped });
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
  db: Db,
  businessId: string,
  events: BusinessEvent[],
): Promise<Result<void>> {
  try {
    const saves = events.map((event) =>
      db.collection(`tenants/${businessId}/events`).doc(event.eventId).set(event),
    );
    await Promise.all(saves);
    return ok(undefined);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message });
  }
}
