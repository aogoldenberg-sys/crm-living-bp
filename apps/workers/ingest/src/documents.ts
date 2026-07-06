/**
 * POST /api/documents — приём КНД XML-документов.
 * Парсит → сохраняет в Firestore knd_documents/{docId} → отвечает кратко.
 *
 * Auth: не требуется (внутренний эндпоинт, вызывается из веб-приложения).
 * В production добавить Bearer-проверку аналогично /intake.
 */

import { parseKndXml } from "@crm/schemas";
import type { Db } from "@crm/firestore-adapter";

interface DocumentsBody {
  xml: string;
}

type DocumentsOk = { ok: true; knd: string; date: string };
type DocumentsErr = { ok: false; error: string };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function respond(body: DocumentsOk | DocumentsErr, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export async function handleDocuments(request: Request, db: Db): Promise<Response> {
  // ── 1. Parse body ─────────────────────────────────────────────────────────
  let body: Partial<DocumentsBody>;
  try {
    body = (await request.json()) as Partial<DocumentsBody>;
  } catch {
    return respond({ ok: false, error: "Тело запроса не является JSON" }, 400);
  }

  if (!body.xml || typeof body.xml !== "string" || !body.xml.trim()) {
    return respond({ ok: false, error: "Поле xml обязательно" }, 400);
  }

  // ── 2. Parse KND XML ──────────────────────────────────────────────────────
  const result = parseKndXml(body.xml);
  if (!result.ok) {
    return respond({ ok: false, error: result.error.message }, 400);
  }

  const doc = result.value;

  // ── 3. Save to Firestore ──────────────────────────────────────────────────
  // РЕШЕНИЕ: в Workers crypto — глобальный, в Node/Vitest — через node:crypto
  const { randomUUID } = await import("node:crypto").catch(() => ({ randomUUID: () => globalThis.crypto.randomUUID() }));
  const docId = randomUUID();
  const record = {
    docId,
    кнд: doc.КНД,
    дата: doc.ДатаДок,
    иннЮл: doc.ИННЮЛ ?? null,
    иннФл: doc.ИННФЛ ?? null,
    savedAt: new Date().toISOString(),
    // Сырой XML не храним — только распарсенные поля (контроль размера)
  };

  try {
    await db.collection("knd_documents").doc(docId).set(record as unknown as Record<string, unknown>);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return respond({ ok: false, error: `Ошибка сохранения: ${msg}` }, 500);
  }

  return respond({ ok: true, knd: doc.КНД, date: doc.ДатаДок }, 200);
}
