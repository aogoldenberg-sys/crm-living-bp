import type { Db } from "./db.js";
import type { IsoDateTime, Deal } from "@crm/schemas";
import { DealStageChanged, Funnel } from "@crm/schemas";
import type { FunnelMetrics } from "@crm/core";
import { type Result, ok, err } from "@crm/core";

/**
 * Загружает только события deal_stage_changed для тенанта.
 *
 * Фильтр по type на стороне Firestore: не тянем платёжные события
 * и прочий мусор в compute-шаг воронки.
 * Невалидные документы логируются и пропускаются (та же политика, что в loadEvents).
 */
export async function loadDealEvents(
  db: Db,
  businessId: string,
  since?: IsoDateTime,
): Promise<Result<{ events: DealStageChanged[]; skipped: number }>> {
  try {
    const col = db.collection(`tenants/${businessId}/events`);
    // Фильтр type на клиенте: составной индекс (type, ts) не нужен.
    const query = since !== undefined
      ? col.where("ts", ">=", since).orderBy("ts")
      : col.orderBy("ts");

    const snapshot = await query.get();
    const events: DealStageChanged[] = [];
    let skipped = 0;

    for (const doc of snapshot.docs) {
      const raw = doc.data();
      // Пропускаем не-deal_stage_changed события без логирования
      if (raw == null || raw["type"] !== "deal_stage_changed") continue;
      const parsed = DealStageChanged.safeParse(raw);
      if (!parsed.success) {
        console.warn(
          `[firestore-adapter] loadDealEvents: invalid doc id=${doc.id}, skipping.`,
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
 * Загружает конфигурацию одной воронки.
 * null — воронка ещё не настроена (нормально при первом запуске).
 */
export async function loadFunnel(
  db: Db,
  businessId: string,
  funnelId: string,
): Promise<Result<Funnel | null>> {
  try {
    const snap = await db
      .collection(`tenants/${businessId}/funnels`)
      .doc(funnelId)
      .get();
    if (!snap.exists) return ok(null);
    const parsed = Funnel.safeParse(snap.data());
    if (!parsed.success) {
      console.warn(
        `[firestore-adapter] loadFunnel: invalid funnel doc funnelId=${funnelId}`,
        parsed.error.issues,
      );
      return ok(null);
    }
    return ok(parsed.data);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message });
  }
}

/**
 * Загружает все воронки тенанта.
 * Возвращает пустой массив если коллекция пуста.
 */
export async function loadFunnels(
  db: Db,
  businessId: string,
): Promise<Result<Funnel[]>> {
  try {
    const snapshot = await db
      .collection(`tenants/${businessId}/funnels`)
      .orderBy("funnelId")
      .get();

    const funnels: Funnel[] = [];
    for (const doc of snapshot.docs) {
      const parsed = Funnel.safeParse(doc.data());
      if (!parsed.success) {
        console.warn(
          `[firestore-adapter] loadFunnels: invalid funnel doc id=${doc.id}, skipping.`,
          parsed.error.issues,
        );
        continue;
      }
      funnels.push(parsed.data);
    }
    return ok(funnels);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message });
  }
}

/**
 * Сохраняет проекцию сделок: один документ на сделку.
 * Путь: tenants/{businessId}/deals/{dealId}.
 *
 * Идемпотентно: повторный вызов перезаписывает snapshot текущего момента.
 * daysInStage в документе — возраст на момент compute-запуска, не живая цифра.
 */
export async function saveDealsProjection(
  db: Db,
  businessId: string,
  deals: Map<string, Deal>,
): Promise<Result<void>> {
  try {
    await Promise.all(
      [...deals.entries()].map(([dealId, deal]) =>
        db
          .collection(`tenants/${businessId}/deals`)
          .doc(dealId)
          .set(deal as unknown as Record<string, unknown>),
      ),
    );
    return ok(undefined);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message });
  }
}

/**
 * Сохраняет конфигурацию воронки (используется при сидировании/настройке).
 * Путь: tenants/{businessId}/funnels/{funnelId}.
 */
export async function saveFunnel(
  db: Db,
  businessId: string,
  funnel: Funnel,
): Promise<Result<void>> {
  try {
    await db
      .collection(`tenants/${businessId}/funnels`)
      .doc(funnel.funnelId)
      .set(funnel as unknown as Record<string, unknown>);
    return ok(undefined);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message });
  }
}

/**
 * Сохраняет агрегированные метрики воронки.
 * Путь: tenants/{businessId}/funnel_metrics/{funnelId}.
 * Один документ на воронку — перезаписывается при каждом compute-запуске.
 */
export async function saveFunnelMetrics(
  db: Db,
  businessId: string,
  funnelId: string,
  metrics: FunnelMetrics,
): Promise<Result<void>> {
  try {
    await db
      .collection(`tenants/${businessId}/funnel_metrics`)
      .doc(funnelId)
      .set(metrics as unknown as Record<string, unknown>);
    return ok(undefined);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message });
  }
}
