import type { Db } from "./db.js";
import type { CashForecast } from "@crm/core/forecast";
import { type Result, ok, err } from "@crm/core";

const COLLECTION = "cash_forecast";
const DOC_ID = "latest";

/**
 * Сохраняет актуальный прогноз денежного потока.
 *
 * Почему один документ latest вместо коллекции: прогноз пересчитывается
 * целиком при каждом запуске. Хранить историю прогнозов — отдельная задача
 * (аудит-лог), не входящая в MVP. Один документ = O(1) чтение без индексов.
 */
export async function saveForecast(
  db: Db,
  forecast: CashForecast,
): Promise<Result<void>> {
  try {
    await db.collection(COLLECTION).doc(DOC_ID).set(forecast);
    return ok(undefined);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message });
  }
}

/**
 * Загружает последний сохранённый прогноз.
 * Возвращает null если прогноз ещё не был сформирован (первый запуск системы).
 */
export async function loadForecast(
  db: Db,
): Promise<Result<CashForecast | null>> {
  try {
    const snap = await db.collection(COLLECTION).doc(DOC_ID).get();

    if (!snap.exists) {
      return ok(null);
    }

    // Приводим через unknown: данные из Firestore типизированы как DocumentData,
    // но мы доверяем структуре, записанной нашим же saveForecast.
    return ok(snap.data() as unknown as CashForecast);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message });
  }
}
