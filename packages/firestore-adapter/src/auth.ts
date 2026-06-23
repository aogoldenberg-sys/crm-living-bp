/**
 * Провижининг тенанта: генерация уникального секрета и хранение его хэша.
 *
 * Архитектура:
 *   - Секрет генерируется один раз, передаётся клиенту открытым текстом ОДИН раз.
 *   - В Firestore хранится ТОЛЬКО hex-SHA-256 секрета — не сам секрет.
 *   - Auth Worker валидирует: SHA-256(входящий секрет) === storedHash для businessId.
 *
 * Изоляция: у каждого тенанта свой хэш → секрет тенанта A не откроет доступ к B.
 */

import type { Db } from "./db.js";
import { type Result, ok, err } from "@crm/core";

/**
 * SHA-256 hex-дайджест строки.
 * Работает в Node.js 18+ и Cloudflare Workers (оба имеют crypto.subtle).
 */
export async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Генерирует уникальный секрет для тенанта, сохраняет в Firestore ТОЛЬКО хэш.
 *
 * Возвращает секрет открытым текстом — он должен быть показан клиенту один раз
 * и больше нигде не храниться.
 *
 * Идемпотентно по businessId — повторный вызов ротирует секрет (старый инвалидируется).
 */
export async function provisionTenantSecret(
  db: Db,
  businessId: string,
): Promise<Result<string>> {
  try {
    // 32 случайных байта → base64url → секрет ~43 символа
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    const secret = btoa(String.fromCharCode(...randomBytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");

    const secretHash = await sha256hex(secret);

    // Читаем существующий документ тенанта, чтобы не затереть другие поля
    const snap = await db.collection("tenants").doc(businessId).get();
    const existing: Record<string, unknown> = snap.exists ? (snap.data() ?? {}) : {};

    await db.collection("tenants").doc(businessId).set({
      ...existing,
      secretHash,
      provisionedAt: new Date().toISOString(),
    });

    // Секрет возвращается открытым текстом — caller должен передать клиенту и НЕ хранить
    return ok(secret);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message });
  }
}
