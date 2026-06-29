/**
 * Worker: ingest — приём событий от n8n, банк-API, голоса.
 *
 * Маршруты:
 *   POST /intake  — загрузка и AI-анализ бизнес-плана (PDF / DOCX / XLSX / TXT / MD / RTF)
 *                   Auth: Firebase ID Token (Bearer)
 *   POST /        — приём BusinessEvent[]
 *                   Auth: x-api-secret
 */

import mammoth from "mammoth";
import { timingSafeEqual } from "node:crypto";
import type { Db } from "@crm/firestore-adapter";
import { BusinessEvent } from "@crm/schemas";
import { createFirestoreRestClient, saveEvents, registerTenant } from "@crm/firestore-adapter";

interface Env {
  FIREBASE_SERVICE_ACCOUNT_JSON: string;
  INGEST_API_SECRET: string;
  /** Добавить: wrangler secret put ANTHROPIC_API_KEY */
  ANTHROPIC_API_KEY: string;
  /** Добавить: wrangler secret put FIREBASE_PROJECT_ID  (значение: crm-living-bp) */
  FIREBASE_PROJECT_ID: string;
}

export type IngestResult = { events: number; skipped: number };

// ══════════════════════════════════════════════════════════════════════════════
// Firebase ID-token verification (WebCrypto, без сторонних зависимостей)
// ══════════════════════════════════════════════════════════════════════════════

interface FirebaseClaims {
  uid: string;
  businessId: string;
}

function b64decode(s: string): string {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (padded.length % 4)) % 4;
  return atob(padded + "=".repeat(pad));
}

async function verifyFirebaseIdToken(
  token: string,
  projectId: string,
): Promise<FirebaseClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [hPart, pPart, sPart] = parts as [string, string, string];

  let header: { kid?: string };
  let payload: {
    iss?: string;
    aud?: string | string[];
    exp?: number;
    sub?: string;
    businessId?: string;
  };
  try {
    header = JSON.parse(b64decode(hPart));
    payload = JSON.parse(b64decode(pPart));
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const aud = typeof payload.aud === "string" ? [payload.aud] : (payload.aud ?? []);
  if (!aud.includes(projectId)) return null;
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) return null;
  if ((payload.exp ?? 0) < now) return null;
  if (!header.kid) return null;

  // Google JWK для Firebase Auth (Google кэширует 6 ч)
  const jwksRes = await fetch(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  );
  if (!jwksRes.ok) return null;
  const { keys } = (await jwksRes.json()) as { keys: JsonWebKey[] };
  const jwk = keys.find((k) => (k as { kid?: string }).kid === header.kid);
  if (!jwk) return null;

  try {
    const pubKey = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const sigBytes = Uint8Array.from(b64decode(sPart), (c) => c.charCodeAt(0));
    const inputBytes = new TextEncoder().encode(`${hPart}.${pPart}`);
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      pubKey,
      sigBytes,
      inputBytes,
    );
    if (!valid) return null;
  } catch {
    return null;
  }

  return {
    uid: payload.sub ?? "",
    // businessId добавляется в custom claims при createCustomToken
    businessId: payload.businessId ?? payload.sub ?? "",
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// Экстракторы текста по типу файла
// ══════════════════════════════════════════════════════════════════════════════

/** RTF: убираем управляющие последовательности, оставляем читаемый текст */
function stripRtf(rtf: string): string {
  return rtf
    .replace(/\{\\\*[^}]*\}/g, " ")
    .replace(/\{\\[^}]+\}/g, " ")
    .replace(/\\[a-z-]+\d*\s?/g, " ")
    .replace(/[{}\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** base64 без Buffer.from для больших файлов (chunked) */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * xlsx: разбираем ZIP-архив вручную (DecompressionStream + ZIP-парсер),
 * извлекаем xl/sharedStrings.xml и xl/worksheets/sheet1.xml.
 * Новые зависимости не нужны — только Web API.
 */
async function extractXlsxText(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // Найти EOCD (End of Central Directory): сигнатура 0x06054b50
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("Файл не является ZIP (xlsx)");

  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);

  /** Читает и декомпрессирует файл из ZIP по имени */
  async function readZipEntry(targetName: string): Promise<string | null> {
    let pos = cdOffset;
    while (pos < cdOffset + cdSize) {
      if (view.getUint32(pos, true) !== 0x02014b50) break; // central dir signature
      const method = view.getUint16(pos + 10, true);
      const compSize = view.getUint32(pos + 20, true);
      const fnLen = view.getUint16(pos + 28, true);
      const extraLen = view.getUint16(pos + 30, true);
      const commentLen = view.getUint16(pos + 32, true);
      const localOff = view.getUint32(pos + 42, true);
      const name = new TextDecoder().decode(bytes.slice(pos + 46, pos + 46 + fnLen));
      pos += 46 + fnLen + extraLen + commentLen;

      if (name !== targetName) continue;

      const localFnLen = view.getUint16(localOff + 26, true);
      const localExtraLen = view.getUint16(localOff + 28, true);
      const dataStart = localOff + 30 + localFnLen + localExtraLen;
      const compressed = bytes.slice(dataStart, dataStart + compSize);

      if (method === 0) return new TextDecoder().decode(compressed); // stored
      if (method === 8) {
        // DEFLATE
        const ds = new DecompressionStream("deflate-raw");
        const w = ds.writable.getWriter();
        await w.write(compressed);
        await w.close();
        const out = await new Response(ds.readable).arrayBuffer();
        return new TextDecoder().decode(out);
      }
      return null; // неизвестный метод
    }
    return null;
  }

  // sharedStrings.xml содержит все строковые значения ячеек
  const ssXml = await readZipEntry("xl/sharedStrings.xml");

  // sheet1.xml — первый лист с порядком ячеек
  const sheetXml = await readZipEntry("xl/worksheets/sheet1.xml");

  if (!ssXml && !sheetXml) return "(Excel: нет текстовых данных)";

  const texts: string[] = [];

  if (ssXml) {
    const re = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(ssXml)) !== null) {
      const t = m[1]?.trim();
      if (t) texts.push(t);
    }
  }

  return texts.length > 0 ? texts.join(" | ") : "(Excel: только числа, текстовых строк нет)";
}

// ══════════════════════════════════════════════════════════════════════════════
// Claude API (вызов напрямую через fetch)
// ══════════════════════════════════════════════════════════════════════════════

// Встроенные промпты (readFileSync недоступен в CF Workers)
const EXTRACT_SYSTEM = `Ты — аналитик бизнес-планов. Тебе дан текст документа.

Задача: извлечь структурированные данные в JSON строго по схеме ExtractedPlan.

Схема:
{
  "businessId": "<передаётся в запросе>",
  "rawSections": {
    "<sectionId>": { "text": "<краткое содержание>", "confidence": <0.0–1.0> }
  },
  "assumptions": {
    "<key>": {
      "key": "<key>",
      "value": { "point": <число> } | { "lo": <число>, "hi": <число> },
      "unit": "<₽ | % | дней | шт | ...>",
      "origin": "ai_extracted",
      "confidence": <0.0–1.0>,
      "sourceSection": "<sectionId или null>",
      "verifiability": {
        "verifiableBy": "<способ верификации или null>",
        "afterEvent": "<событие-триггер или null>"
      }
    }
  }
}

Денежные значения в value — ЦЕЛЫЕ КОПЕЙКИ (₽ × 100). Пример: 1 500 000 ₽ → 150000000.
Если значение — диапазон, используй { "lo": ..., "hi": ... }.
Если точное значение — { "point": ... }.
Pre-revenue гипотезы (проект ещё не открыт): verifiableBy: null, afterEvent: null.
Гипотезы, верифицируемые после открытия: verifiableBy: "bank_api" / "OTA_stats" / "accounting", afterEvent: "N недель после открытия".

Обязательные ключи для туристических/капитальных проектов (извлекай если есть):
- occupancy_summer, occupancy_shoulder, occupancy_winter (unit: "%")
- avg_night_price (unit: "₽", копейки)
- trip_check (unit: "₽", копейки)
- capex_total (unit: "₽", копейки)
- grant_minek, grant_agrostartup, grant_governor, grant_minvostok (unit: "₽", копейки)
- modules_count (unit: "шт")
- ebitda_margin (unit: "%")
- payback_years (unit: "лет")

Известные sectionId: executive_summary, problem, solution, market_size, target_audience,
value_proposition, competitors, business_model, pricing, product_roadmap, go_to_market,
sales_channels, marketing_strategy, team, operations, finances, unit_economics,
risks, legal, kpi_metrics, funding_ask, exit_strategy.

confidence = насколько уверен в качестве извлечённого содержимого (0.0–1.0).
Если раздел не найден — не включай в rawSections.
Верни ТОЛЬКО валидный JSON без обёрток markdown.`;

const ASSESS_SYSTEM = `Ты — независимый бизнес-аналитик. Тебе дана структура бизнес-плана.

Задача: симметричная оценка §20.3 — не льстить и не громить.
Верни JSON строго по схеме:
{
  "strengths": [{ "point": "...", "sectionRef": "...", "evidence": "..." }],
  "concerns":  [{ "point": "...", "severity": "red"|"yellow", "sectionRef": "...", "rationale": "..." }],
  "verifiability": [{ "assumption": "...", "howValidated": "...", "dataSourceNeeded": "..." }]
}

Правила:
- strengths: минимум 2, максимум 5. Только реальные — если сильных сторон нет, укажи 0.
- concerns: severity "red" = критический риск, "yellow" = внимание. Минимум 1 если есть.
- verifiability: для каждой числовой гипотезы из assumptions.
  Для pre-revenue гипотез (verifiableBy: null) — опиши как будет верифицировано ПОСЛЕ открытия.
Верни ТОЛЬКО валидный JSON без обёрток markdown.`;

type ClaudeContentBlock =
  | { type: "text"; text: string }
  | { type: "document"; source: { type: "base64"; media_type: string; data: string } };

async function callClaude(
  apiKey: string,
  system: string,
  content: ClaudeContentBlock[],
): Promise<unknown> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-5-haiku-latest",
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Claude ${res.status}: ${txt.slice(0, 200)}`);
  }
  const msg = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  const block = msg.content[0];
  if (!block || block.type !== "text" || !block.text) {
    throw new Error("Claude вернул пустой ответ");
  }
  // Claude иногда оборачивает JSON в ```json ... ```
  const raw = block.text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
  return JSON.parse(raw);
}

// ══════════════════════════════════════════════════════════════════════════════
// /intake handler
// ══════════════════════════════════════════════════════════════════════════════

const MIME = {
  PDF: "application/pdf",
  DOC: "application/msword",
  DOCX: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  XLS: "application/vnd.ms-excel",
  XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  RTF1: "text/rtf",
  RTF2: "application/rtf",
} as const;

const IMPORTANT_SECTIONS = new Set([
  "executive_summary", "market_size", "target_audience", "business_model",
  "pricing", "finances", "unit_economics", "risks", "funding_ask",
]);

const DISCLAIMER =
  "Данный анализ сформирован автоматически на основе загруженного документа. " +
  "Носит информационный характер. Для принятия финансовых и инвестиционных решений " +
  "рекомендуется привлечение профессиональных консультантов.";

async function handleIntake(request: Request, env: Env): Promise<Response> {
  // ── 1. Auth: Firebase ID Token ──────────────────────────────────────────
  const authHeader = request.headers.get("Authorization") ?? "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!idToken) return jsonCors({ error: "Unauthorized" }, 401);

  const projectId = env.FIREBASE_PROJECT_ID || "crm-living-bp";
  const claims = await verifyFirebaseIdToken(idToken, projectId);
  if (!claims) return jsonCors({ error: "Unauthorized" }, 401);

  const { businessId } = claims;

  // ── 2. Parse multipart ───────────────────────────────────────────────────
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonCors({ error: "Bad Request: ожидался multipart/form-data" }, 400);
  }

  const fileEntry = form.get("file");
  if (!fileEntry || typeof fileEntry === "string") {
    return jsonCors({ error: "Bad Request: поле file отсутствует" }, 400);
  }
  const file = fileEntry as File;

  // mimeType явно передаётся от клиента — защита от кириллических имён файлов
  const mimeType = ((form.get("mimeType") as string | null) ?? file.type ?? "").toLowerCase();

  // ── 3. Извлечение текста / подготовка content для Claude ────────────────
  let claudeContent: ClaudeContentBlock[];

  switch (true) {
    case mimeType === MIME.DOC:
      return jsonCors(
        { error: "Формат .doc не поддерживается. Сохраните файл как .docx или PDF." },
        400,
      );

    case mimeType === MIME.XLS:
      return jsonCors(
        { error: "Формат .xls не поддерживается. Сохраните файл как .xlsx или экспортируйте в CSV." },
        400,
      );

    case mimeType === MIME.PDF: {
      const buf = await file.arrayBuffer();
      claudeContent = [
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: toBase64(buf) },
        },
        { type: "text", text: "Проанализируй бизнес-план из приложенного документа." },
      ];
      break;
    }

    case mimeType === MIME.DOCX: {
      const buf = await file.arrayBuffer();
      const { value: text } = await mammoth.extractRawText({ arrayBuffer: buf });
      if (!text.trim()) return jsonCors({ error: "DOCX: документ пустой или нечитаем" }, 422);
      claudeContent = [{ type: "text", text }];
      break;
    }

    case mimeType === MIME.XLSX: {
      const buf = await file.arrayBuffer();
      const text = await extractXlsxText(buf);
      claudeContent = [{ type: "text", text }];
      break;
    }

    case mimeType === MIME.RTF1:
    case mimeType === MIME.RTF2: {
      const raw = await file.text();
      claudeContent = [{ type: "text", text: stripRtf(raw) }];
      break;
    }

    case mimeType.startsWith("text/"): {
      const text = await file.text();
      if (!text.trim()) return jsonCors({ error: "Файл пустой" }, 422);
      claudeContent = [{ type: "text", text }];
      break;
    }

    default:
      return jsonCors({ error: `Неподдерживаемый тип файла: ${mimeType}` }, 400);
  }

  // ── 4. Claude: извлечение структуры ─────────────────────────────────────
  interface ExtractResult {
    rawSections?: Record<string, { text?: string; confidence?: number }>;
    assumptions?: Record<string, unknown>;
  }
  let extracted: ExtractResult;
  try {
    extracted = (await callClaude(env.ANTHROPIC_API_KEY, EXTRACT_SYSTEM, claudeContent)) as ExtractResult;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonCors({ error: `Ошибка извлечения данных: ${msg}` }, 500);
  }

  // ── 5. Claude: оценка §20.3 ──────────────────────────────────────────────
  interface AssessResult {
    strengths?: Array<{ point?: string; sectionRef?: string; evidence?: string }>;
    concerns?: Array<{ point?: string; severity?: string; sectionRef?: string; rationale?: string }>;
    verifiability?: Array<{ assumption?: string; howValidated?: string; dataSourceNeeded?: string }>;
  }
  let assessed: AssessResult;
  try {
    assessed = (await callClaude(env.ANTHROPIC_API_KEY, ASSESS_SYSTEM, [
      { type: "text", text: JSON.stringify(extracted) },
    ])) as AssessResult;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonCors({ error: `Ошибка оценки плана: ${msg}` }, 500);
  }

  // ── 6. Формируем intake-документ ────────────────────────────────────────
  const intakeId = crypto.randomUUID();
  const extractedAt = new Date().toISOString();
  const foundSections = new Set(Object.keys(extracted.rawSections ?? {}));
  const gaps = [...IMPORTANT_SECTIONS]
    .filter((s) => !foundSections.has(s))
    .map((s) => ({ missingSection: s }));

  const intakeDoc = {
    intakeId,
    businessId,
    extractedAt,
    assessment: {
      strengths: (assessed.strengths ?? []).map((s) => s.point ?? "").filter(Boolean),
      concerns: (assessed.concerns ?? []).map((c) => ({
        description: c.point ?? "",
        severity: c.severity === "red" ? "red" : "yellow",
        rationale: c.rationale,
      })),
      gaps,
      assumptionsExtracted: extracted.assumptions ?? {},
      verifiability: assessed.verifiability ?? [],
    },
    disclaimer: DISCLAIMER,
    status: "draft",
    narrativeReady: false,
  };

  // ── 7. Сохранение в Firestore → tenants/{businessId}/plan_intakes ────────
  // Коллекция plan_intakes (мн. ч.) — именно её читает useIntake.ts
  const db = createFirestoreRestClient(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  try {
    await db
      .collection(`tenants/${businessId}/plan_intakes`)
      .doc(intakeId)
      .set(intakeDoc as unknown as Record<string, unknown>);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonCors({ error: `Ошибка сохранения: ${msg}` }, 500);
  }

  return jsonCors({ intakeId, status: "ok", sectionsFound: foundSections.size });
}

// ══════════════════════════════════════════════════════════════════════════════
// Существующая бизнес-логика: приём BusinessEvent[]
// ══════════════════════════════════════════════════════════════════════════════

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
    const businessIds = [...new Set(valid.map((e) => e.businessId))];
    if (businessIds.length > 1) {
      throw new Error("Mixed businessIds in single batch");
    }

    const businessId = valid[0]!.businessId;

    const registerResult = await registerTenant(db, businessId);
    if (!registerResult.ok) {
      throw new Error(`registerTenant failed: ${JSON.stringify(registerResult.error)}`);
    }

    const saveResult = await saveEvents(db, businessId, valid);
    if (!saveResult.ok) {
      throw new Error(`saveEvents failed: ${JSON.stringify(saveResult.error)}`);
    }
  }

  return { events: valid.length, skipped };
}

function isValidSecret(incoming: string, expected: string): boolean {
  if (incoming.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(incoming), Buffer.from(expected));
}

// ══════════════════════════════════════════════════════════════════════════════
// /register handler — создание аккаунта пользователя в Firestore
// ══════════════════════════════════════════════════════════════════════════════

async function handleRegister(request: Request, env: Env): Promise<Response> {
  const authHeader = request.headers.get("Authorization") ?? "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) return jsonCors({ error: "Missing token" }, 401);

  const projectId = env.FIREBASE_PROJECT_ID || "crm-living-bp";
  const claims = await verifyFirebaseIdToken(idToken, projectId);
  if (!claims) return jsonCors({ error: "Invalid token" }, 401);

  const uid = claims.uid;
  const db = createFirestoreRestClient(env.FIREBASE_SERVICE_ACCOUNT_JSON);

  // Idempotent: if users/{uid} already exists, return existing businessId
  const userDoc = await db.collection("users").doc(uid).get();
  if (userDoc.exists) {
    const data = userDoc.data() as { businessId: string };
    return jsonCors({ businessId: data.businessId });
  }

  // New user: businessId = uid (server-generated by Firebase)
  const businessId = uid;
  const now = new Date().toISOString();

  await db
    .collection("tenants")
    .doc(businessId)
    .collection("_meta")
    .doc("info")
    .set({
      createdAt: now,
      ownerUid: uid,
    });
  await db.collection("users").doc(uid).set({
    businessId,
    role: "owner",
    createdAt: now,
  });

  return jsonCors({ businessId });
}

// ══════════════════════════════════════════════════════════════════════════════
// Main fetch handler
// ══════════════════════════════════════════════════════════════════════════════

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // ── /register — регистрация нового пользователя ──────────────────────
    if (request.method === "POST" && url.pathname === "/register") {
      return handleRegister(request, env);
    }

    // ── /intake — бизнес-план (Firebase auth) ────────────────────────────
    if (request.method === "POST" && url.pathname === "/intake") {
      return handleIntake(request, env);
    }

    // ── / — события (API secret) ──────────────────────────────────────────
    const incoming = request.headers.get("x-api-secret") ?? "";
    if (!isValidSecret(incoming, env.INGEST_API_SECRET)) {
      return json({ error: "Unauthorized" }, 401);
    }

    if (request.method !== "POST") {
      return json({ error: "Method Not Allowed" }, 405);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Bad Request: invalid JSON" }, 400);
    }

    const rawItems: unknown[] = Array.isArray(body) ? body : [body];

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

// ── Helpers ──────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonCors(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
