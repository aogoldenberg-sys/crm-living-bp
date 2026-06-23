import type { Db } from "./db.js";
import type { DemandSignals } from "@crm/core";
import { type Result, ok, err } from "@crm/core";

/**
 * Сохраняет последние сигналы спроса.
 *
 * Один документ «latest» на тенанта — пересчитывается целиком при каждом
 * compute-запуске, как saveForecast. История периодов — отдельная задача (§8).
 */
export async function saveDemandSignals(
  db: Db,
  businessId: string,
  signals: DemandSignals,
): Promise<Result<void>> {
  try {
    await db
      .collection(`tenants/${businessId}/demand_signals`)
      .doc("latest")
      .set(signals as unknown as Record<string, unknown>);
    return ok(undefined);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message });
  }
}

/**
 * Загружает последние сохранённые сигналы спроса.
 * null — ещё не сформированы (норма при первом запуске или нет лидов).
 */
export async function loadDemandSignals(
  db: Db,
  businessId: string,
): Promise<Result<DemandSignals | null>> {
  try {
    const snap = await db
      .collection(`tenants/${businessId}/demand_signals`)
      .doc("latest")
      .get();
    if (!snap.exists) return ok(null);
    return ok(snap.data() as unknown as DemandSignals);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message });
  }
}
