import type { Db } from "./db.js";
import { type Result, ok, err } from "@crm/core";

/**
 * Регистрирует тенанта (создаёт документ в tenants/{businessId}). Идемпотентно.
 * Повторный вызов с тем же businessId просто перезапишет createdAt — безопасно.
 */
export async function registerTenant(db: Db, businessId: string): Promise<Result<void>> {
  try {
    await db.collection("tenants").doc(businessId).set({ createdAt: new Date().toISOString() });
    return ok(undefined);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message });
  }
}

/**
 * Список всех зарегистрированных businessId.
 * Возвращает массив строк (doc.id из коллекции tenants).
 */
export async function listTenants(db: Db): Promise<Result<string[]>> {
  try {
    const snapshot = await db.collection("tenants").orderBy("createdAt").get();
    const ids = snapshot.docs.map((doc) => doc.id);
    return ok(ids);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message });
  }
}
