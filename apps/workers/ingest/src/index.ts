/**
 * Worker: ingest — приём событий от n8n, банк-API, голоса.
 *
 * Контракт:
 *   POST /          body: BusinessEvent | BusinessEvent[]
 *   Header:         x-api-secret: <INGEST_API_SECRET>
 *   Response 200:   { events: number; skipped: number }
 *   Response 401:   Unauthorized (нет или неверный секрет)
 *   Response 400:   Bad Request (не JSON)
 *   Response 500:   Storage error
 *
 * Идемпотентность: saveEvents использует doc(eventId).set() —
 * повторный POST с теми же событиями безопасен.
 */

import { timingSafeEqual } from "node:crypto";
import type { Db } from "@crm/firestore-adapter";
import { BusinessEvent } from "@crm/schemas";
import { createFirestoreRestClient, saveEvents } from "@crm/firestore-adapter";

interface Env {
  FIREBASE_SERVICE_ACCOUNT_JSON: string;
  INGEST_API_SECRET: string;
}

export type IngestResult = { events: number; skipped: number };

/**
 * Чистая бизнес-логика без HTTP: валидирует и сохраняет события.
 * Вынесена из fetch-хендлера чтобы тестироваться в Vitest без workerd.
 * Тест инжектирует FakeFirestore напрямую.
 */
export async function run(rawItems: unknown[], db: Db): Promise<IngestResult> {
  const valid: BusinessEvent[] = [];
  let skipped = 0;

  for (const raw of rawItems) {
    const result = BusinessEvent.safeParse(raw);
    if (!result.success) {
      console.warn("[ingest] skipped invalid event:", JSON.stringify(result.error.issues));
      skipped++;
      continue;
    }
    valid.push(result.data);
  }

  if (valid.length > 0) {
    const saveResult = await saveEvents(db, valid);
    if (!saveResult.ok) {
      // Пробрасываем как Error: вызывающий fetch-хендлер вернёт 500
      throw new Error(`saveEvents failed: ${JSON.stringify(saveResult.error)}`);
    }
  }

  return { events: valid.length, skipped };
}

/**
 * Timing-safe сравнение двух строк.
 * Простое === утекает по времени: атакующий узнаёт совпадение посимвольно.
 * timingSafeEqual гарантирует постоянное время выполнения.
 * Требует nodejs_compat_v2 в wrangler.toml.
 */
function isValidSecret(incoming: string, expected: string): boolean {
  // Разная длина — ранний reject: тоже немного утекает, но для фиксированного
  // токена (INGEST_API_SECRET всегда одной длины) это не проблема.
  if (incoming.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(incoming), Buffer.from(expected));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // ── Аутентификация (timing-safe) ──────────────────────────────────────
    const incoming = request.headers.get("x-api-secret") ?? "";
    if (!isValidSecret(incoming, env.INGEST_API_SECRET)) {
      return json({ error: "Unauthorized" }, 401);
    }

    if (request.method !== "POST") {
      return json({ error: "Method Not Allowed" }, 405);
    }

    // ── Парсинг тела ──────────────────────────────────────────────────────
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Bad Request: invalid JSON" }, 400);
    }

    const rawItems: unknown[] = Array.isArray(body) ? body : [body];

    // ── Бизнес-логика (тестируемая отдельно) ─────────────────────────────
    try {
      const db = createFirestoreRestClient(env.FIREBASE_SERVICE_ACCOUNT_JSON);
      const result = await run(rawItems, db);
      console.log(`[ingest] done: events=${result.events} skipped=${result.skipped}`);
      return json(result);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[ingest] error:", message);
      return json({ error: message }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
