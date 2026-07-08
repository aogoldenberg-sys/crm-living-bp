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
import { BusinessEvent, ExternalSignal, RequestItem, INTAKE_TO_BOOK_ID, BOOK_SECTION_IDS } from "@crm/schemas";
import { handleDocuments } from "./documents.js";
import { createFirestoreRestClient, saveEvents, registerTenant } from "@crm/firestore-adapter";
import { generatePlan, ExtractedPlanSchema, AssessmentOutputSchema } from "@crm/ai-kit";
import { REQUIRED_SECTIONS, mapToSections, gateIntake } from "@crm/core";
import { EXTRACT_SYSTEM, ASSESS_SYSTEM } from "./prompts.generated.js";

interface Env {
  FIREBASE_SERVICE_ACCOUNT_JSON: string;
  INGEST_API_SECRET: string;
  /** Добавить: wrangler secret put ANTHROPIC_API_KEY */
  ANTHROPIC_API_KEY: string;
  /** Добавить: wrangler secret put FIREBASE_PROJECT_ID  (значение: crm-living-bp) */
  FIREBASE_PROJECT_ID: string;
}

export type IngestResult = { events: number; skipped: number };

// ── Taxonomy: translate intake-IDs → book-IDs, merge collisions ───────────────

/**
 * Строит массив mappedSections под book-ID.
 * Несколько intake-секций → один book-ID: contentSummary конкатенируется,
 * confidence = max. Все 22 book-раздела присутствуют (absent → present:false).
 */
function translateToBookSections(
  rawSections: Record<string, { text: string; confidence: number }>,
  intakeMapped: Array<{ sectionId: string; present: boolean; confidence: number }>,
): Array<{ sectionId: string; present: boolean; contentSummary: string; confidence: number }> {
  const byBookId = new Map<string, { contentSummary: string; confidence: number; present: boolean }>();

  for (const s of intakeMapped) {
    const bookId = INTAKE_TO_BOOK_ID[s.sectionId];
    if (!bookId) continue; // неизвестный intake-id — пропустить
    const text = rawSections[s.sectionId]?.text ?? "";
    const existing = byBookId.get(bookId);

    if (!existing) {
      byBookId.set(bookId, { contentSummary: text, confidence: s.confidence, present: s.present });
    } else if (s.present) {
      // Мёрж: добавляем контент, берём max confidence
      byBookId.set(bookId, {
        contentSummary: existing.contentSummary
          ? `${existing.contentSummary}\n\n${text}`.trim()
          : text,
        confidence: Math.max(existing.confidence, s.confidence),
        present: true,
      });
    }
  }

  // Заполняем все 22 book-раздела (absent → present:false)
  return BOOK_SECTION_IDS.map((bookId) => {
    const d = byBookId.get(bookId);
    return d
      ? { sectionId: bookId, ...d }
      : { sectionId: bookId, contentSummary: "", confidence: 0, present: false };
  });
}

// Ключевые слова для инференса sectionId из contentSummary (для миграции)
const MIGRATE_KEYWORDS: Record<string, string[]> = {
  executive_summary: ["резюме", "summary", "обзор", "введение", "краткое"],
  problem:           ["проблема", "боль", "приоритет", "challenge", "pain"],
  solution:          ["решение", "продукт", "сервис", "solution", "product"],
  market_size:       ["рынок", "объём", "tam", "sam", "market", "сегмент"],
  value_proposition: ["ценность", "преимущество", "уникальность", "value"],
  competitors:       ["конкурент", "competitor", "сравнение"],
  business_model:    ["модель", "монетизация", "бизнес-модель"],
  product_roadmap:   ["дорожная карта", "roadmap", "план развития"],
  marketing_strategy:["маркетинг", "реклама", "продвижение", "marketing"],
  team:              ["команда", "team", "сотрудник", "директор"],
  operations:        ["операции", "процесс", "ресурс", "поставщик"],
  finances:          ["финанс", "выручка", "прибыль", "бюджет", "доход"],
  risks:             ["риск", "risk", "угроза", "pest", "swot"],
  kpi_metrics:       ["kpi", "метрика", "показатель", "okr"],
  funding_ask:       ["инвестиц", "финансирование", "грант", "субсидия"],
  exit_strategy:     ["выход", "exit", "заключение", "итог"],
};

function inferIntakeId(text: string): string | null {
  const t = text.toLowerCase().slice(0, 500); // первые 500 символов достаточно
  let best: string | null = null;
  let bestScore = 0;
  for (const [id, kws] of Object.entries(MIGRATE_KEYWORDS)) {
    const score = kws.reduce((n, k) => n + (t.includes(k) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = id; }
  }
  return bestScore >= 1 ? best : null;
}

// ══════════════════════════════════════════════════════════════════════════════
// Firebase ID-token verification (WebCrypto, без сторонних зависимостей)
// ══════════════════════════════════════════════════════════════════════════════

interface FirebaseClaims {
  uid: string;
  email_verified: boolean;
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
    iat?: number;
    sub?: string;
    email_verified?: boolean;

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
  if (!payload.sub) return null;
  if ((payload.iat ?? 0) > now + 60) return null;  // reject future-dated tokens (clock skew > 60s)
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

  return { uid: payload.sub, email_verified: !!payload.email_verified };
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

// Промпты импортируются из prompts.generated.ts (единственный источник — packages/ai-kit/prompts/*.md)
// Для регенерации: node tools/generate-prompts.mjs

type ClaudeContentBlock =
  | { type: "text"; text: string }
  | { type: "document"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } };

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
      model: "claude-haiku-4-5-20251001",
      max_tokens: 16000,
      system,
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Claude ${res.status}: ${txt.slice(0, 200)}`);
  }
  const msg = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  // Collect ALL text blocks, not just first
  const rawText = msg.content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("\n\n");
  if (!rawText) {
    throw new Error("Claude вернул пустой ответ");
  }
  // Strip markdown wrappers
  const raw = rawText.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
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

async function handleIntake(request: Request, env: Env): Promise<Response> {
  // ── 0. File size limit: 15 MB ──────────────────────────────────────────
  const contentLength = parseInt(request.headers.get("content-length") ?? "0", 10);
  if (contentLength > 15 * 1024 * 1024) {
    return jsonCors({ error: "Файл слишком большой. Максимальный размер: 15 МБ." }, 413);
  }

  // ── 1. Auth: Firebase ID Token ──────────────────────────────────────────
  const authHeader = request.headers.get("Authorization") ?? "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!idToken) return jsonCors({ error: "Unauthorized" }, 401);

  const projectId = env.FIREBASE_PROJECT_ID || "crm-living-bp";
  const claims = await verifyFirebaseIdToken(idToken, projectId);
  if (!claims) return jsonCors({ error: "Unauthorized" }, 401);
  if (!claims.email_verified) return jsonCors({ error: "Email not verified" }, 403);

  // ── 1b. Резолв businessId из Firestore (uid ≠ businessId) ────────────────
  const db = createFirestoreRestClient(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const userDoc = await db.collection("users").doc(claims.uid).get();
  if (!userDoc.exists) return jsonCors({ error: "User not registered. Call /register first." }, 400);
  const { businessId } = userDoc.data() as { businessId: string };

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
      let xlsxText: string;
      try {
        xlsxText = await extractXlsxText(buf);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return jsonCors({ error: `Ошибка чтения Excel: ${msg}. Попробуйте сохранить как PDF или DOCX.` }, 422);
      }
      if (xlsxText.startsWith("(Excel:")) {
        return jsonCors(
          { error: "Excel-файл не содержит текстовых ячеек. Добавьте описание разделов или экспортируйте в PDF." },
          422,
        );
      }
      claudeContent = [{ type: "text", text: xlsxText }];
      break;
    }

    case mimeType === MIME.RTF1:
    case mimeType === MIME.RTF2: {
      const raw = await file.text();
      claudeContent = [{ type: "text", text: stripRtf(raw) }];
      break;
    }

    case mimeType.startsWith("text/"):
    // text/markdown, text/plain, text/csv and other text/* types
    case mimeType === "application/octet-stream" && file.name.endsWith(".md"): {
      const text = await file.text();
      if (!text.trim()) return jsonCors({ error: "Файл пустой" }, 422);
      claudeContent = [{ type: "text", text }];
      break;
    }

    default:
      // Supported: pdf, docx, xlsx, md, txt (text/*). All other formats are rejected with a clear message.
      return jsonCors(
        { error: `Неподдерживаемый тип файла: "${mimeType}". Используйте PDF, DOCX, XLSX, MD или TXT.` },
        400,
      );
  }

  // ── 4. Claude: извлечение структуры ─────────────────────────────────────
  let extractRaw: unknown;
  try {
    extractRaw = await callClaude(env.ANTHROPIC_API_KEY, EXTRACT_SYSTEM, claudeContent);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonCors({ error: `Ошибка извлечения данных: ${msg}` }, 500);
  }

  // B2: Zod validation at Claude boundary
  const extractValidated = ExtractedPlanSchema.safeParse({
    ...(extractRaw as object),
    businessId, // always override with server-resolved value
  });
  if (!extractValidated.success) {
    console.error("[intake] extract parse failed:", extractValidated.error.issues);
    return jsonCors({ error: "AI parse error (extract)", details: extractValidated.error.issues }, 502);
  }
  const extracted = extractValidated.data;

  // ── 5. Map to canonical book sections (BUG-1: store under book-ID) ────────
  const { sections: intakeSections, gaps } = mapToSections(extracted);
  const bookSections = translateToBookSections(extracted.rawSections, intakeSections);
  const { confidence, disclaimer: gateDisclaimer } = gateIntake(intakeSections, businessId);

  // ── 6. Claude: оценка §20.3 (НЕ блокирует сохранение — BUG-5 fix) ──────
  type Assessed = { strengths: Array<{ point: string }>; concerns: Array<{ point: string; severity: string; rationale: string }>; verifiability: unknown[] };
  let assessed: Assessed | null = null;
  try {
    const assessRaw = await callClaude(env.ANTHROPIC_API_KEY, ASSESS_SYSTEM, [
      { type: "text", text: JSON.stringify({ rawSections: extracted.rawSections, assumptions: extracted.assumptions }) },
    ]);
    const v = AssessmentOutputSchema.safeParse(assessRaw);
    if (v.success) {
      assessed = v.data;
    } else {
      console.warn("[intake] assess parse failed, retrying:", v.error.issues.slice(0, 2));
      const retryRaw = await callClaude(
        env.ANTHROPIC_API_KEY,
        ASSESS_SYSTEM + "\n\nВерни ТОЛЬКО валидный JSON без пояснений.",
        [{ type: "text", text: JSON.stringify({ rawSections: extracted.rawSections, assumptions: extracted.assumptions }) }],
      );
      const v2 = AssessmentOutputSchema.safeParse(retryRaw);
      if (v2.success) assessed = v2.data;
      else console.error("[intake] assess retry failed:", v2.error.issues.slice(0, 2));
    }
  } catch (e) {
    console.error("[intake] assess threw:", e instanceof Error ? e.message : String(e));
  }

  // ── 7. Формируем intake-документ §20.2 ──────────────────────────────────
  const intakeId = crypto.randomUUID();
  const extractedAt = new Date().toISOString();
  const foundSections = new Set(Object.keys(extracted.rawSections));
  const completeness = foundSections.size / REQUIRED_SECTIONS.length;

  const intakeDoc = {
    intakeId,
    businessId,
    extractedAt,
    mappedSections: bookSections,   // §20.2: под book-ID (BUG-1 fix)
    completeness,
    confidence,
    assessment: {
      strengths: assessed?.strengths.map((s) => s.point) ?? [],
      concerns: assessed?.concerns.map((c) => ({
        description: c.point,
        severity: c.severity,
        rationale: c.rationale,
      })) ?? [],
      gaps,
      assumptionsExtracted: extracted.assumptions,
      verifiability: assessed?.verifiability ?? [],
    },
    disclaimer: gateDisclaimer,
    status: "draft",
    narrativeReady: false,
  };

  // ── 8. Сохранение в Firestore → tenants/{businessId}/plan_intakes ────────
  try {
    await db
      .collection(`tenants/${businessId}/plan_intakes`)
      .doc(intakeId)
      .set(intakeDoc as unknown as Record<string, unknown>);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonCors({ error: `Ошибка сохранения: ${msg}` }, 500);
  }

  const sectionsFound = bookSections.filter(s => s.present).length;
  return jsonCors({
    intakeId,
    status: "ok",
    sectionsFound,
    completeness,
    confidence,
    message: `Загружено. ${sectionsFound} разделов заполнено.`,
    assessmentReady: assessed !== null,
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// /compliance/extract — разбор требования контролирующего органа
// ══════════════════════════════════════════════════════════════════════════════

const COMPLIANCE_EXTRACT_SYSTEM = `Роль: юридический аналитик-экстрактор.
Вход: текст или скан-изображение требования контролирующего органа (PDF/JPEG через vision).
Задача: разобрать на позиции и вернуть JSON массив RequestItem.

КРИТИЧЕСКОЕ ПРАВИЛО ПРОТИВ ФАБРИКАЦИИ:
- Если документ пустой, нечитаемый, не является требованием или не содержит явных
  запросов документов — верни ПУСТОЙ МАССИВ: []
- НИКОГДА не выдумывай позиции, которых нет в документе
- НИКОГДА не заполняй поля из общих знаний — только из буквального текста документа

Схема одного элемента:
{"itemId":"<uuid>","rawText":"<дословно из требования>","docKinds":["contract"|"act"|"invoice_facture"|"payment_order"|"bank_statement"|"account_card"|"waybill"|"invoice"|"order_internal"|"explanatory"|"other"],"periodFrom":"YYYY-MM-DD"|null,"periodTo":"YYYY-MM-DD"|null,"counterpartyInn":"XXXXXXXXXX"|null,"counterpartyName":"..."|null,"extractConfidence":0.0-1.0}

Верни ТОЛЬКО валидный JSON массив, без markdown, без комментариев.`;

async function handleComplianceExtract(request: Request, env: Env): Promise<Response> {
  const authHeader = request.headers.get("Authorization") ?? "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!idToken) return jsonCors({ error: "Unauthorized" }, 401);

  const projectId = env.FIREBASE_PROJECT_ID || "crm-living-bp";
  const claims = await verifyFirebaseIdToken(idToken, projectId);
  if (!claims) return jsonCors({ error: "Unauthorized" }, 401);

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
  const mimeType = ((form.get("mimeType") as string | null) ?? file.type ?? "").toLowerCase();

  let content: ClaudeContentBlock[];
  if (mimeType === "application/pdf") {
    const buf = await file.arrayBuffer();
    content = [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: toBase64(buf) } },
      { type: "text", text: "Разберите требование на позиции RequestItem и верните JSON массив." },
    ];
  } else if (mimeType.startsWith("image/")) {
    const buf = await file.arrayBuffer();
    const mediaType = mimeType === "image/png" ? "image/png" : "image/jpeg";
    content = [
      { type: "image", source: { type: "base64", media_type: mediaType, data: toBase64(buf) } },
      { type: "text", text: "Разберите требование на позиции RequestItem и верните JSON массив." },
    ];
  } else if (mimeType.startsWith("text/")) {
    const text = await file.text();
    if (!text.trim()) return jsonCors({ code: "INSUFFICIENT_DATA", message: "Файл пустой" }, 422);
    content = [{ type: "text", text }];
  } else {
    return jsonCors({ error: `Неподдерживаемый тип: ${mimeType}. Используйте PDF, JPEG, PNG.` }, 400);
  }

  let raw: unknown;
  try {
    raw = await callClaude(env.ANTHROPIC_API_KEY, COMPLIANCE_EXTRACT_SYSTEM, content);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[compliance/extract] Claude error:", msg);
    return jsonCors({ error: `Ошибка извлечения: ${msg}` }, 500);
  }

  const validated = RequestItem.array().safeParse(raw);
  if (!validated.success) {
    console.error("[compliance/extract] schema error:", validated.error.issues);
    return jsonCors({ error: "Ответ AI не прошёл валидацию", details: validated.error.issues }, 502);
  }

  if (validated.data.length === 0) {
    return jsonCors({ code: "INSUFFICIENT_DATA", message: "Требование не распознано" }, 422);
  }

  return jsonCors({ items: validated.data });
}

// ══════════════════════════════════════════════════════════════════════════════
// /revision-doc handler — загрузка исходного документа, dedup SHA-256
// Auth: Firebase ID Token (Bearer)
// ══════════════════════════════════════════════════════════════════════════════

const VALID_DOC_KINDS = [
  "bank_statement", "cash_report", "fin_report", "staff_schedule",
  "doc_registry", "turnover_sheet", "fixed_asset_card", "authority_request", "other",
] as const;

async function handleRevisionDoc(request: Request, env: Env): Promise<Response> {
  const authHeader = request.headers.get("Authorization") ?? "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) return jsonCors({ error: "Missing token" }, 401);

  const projectId = env.FIREBASE_PROJECT_ID || "crm-living-bp";
  const claims = await verifyFirebaseIdToken(idToken, projectId);
  if (!claims) return jsonCors({ error: "Invalid token" }, 401);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonCors({ error: "Invalid multipart form" }, 400);
  }

  const file = formData.get("file") as File | null;
  const kind = formData.get("kind") as string | null;

  if (!file || !kind) return jsonCors({ error: "Missing file or kind" }, 400);
  if (!(VALID_DOC_KINDS as readonly string[]).includes(kind)) {
    return jsonCors({ error: "Invalid kind" }, 400);
  }

  const db = createFirestoreRestClient(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const userDoc = await db.collection("users").doc(claims.uid).get();
  if (!userDoc.exists) return jsonCors({ error: "User not registered" }, 400);
  const { businessId } = userDoc.data() as { businessId: string };

  // SHA-256 dedup
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const sha256 = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  const docId = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    await db
      .collection("tenants")
      .doc(businessId)
      .collection("source_docs")
      .doc(docId)
      .set({
        docId,
        businessId,
        kind,
        fileRef: `uploads/${businessId}/${docId}/${file.name}`,
        uploadedAt: now,
        pages: 1,          // будет обновлено парсером
        mappedSections: [],
        status: "uploaded",
        sha256,
      } as unknown as Record<string, unknown>);
  } catch {
    return jsonCors({ error: "Failed to save doc record" }, 500);
  }

  return jsonCors({ docId, businessId, status: "uploaded", sha256 });
}

// ══════════════════════════════════════════════════════════════════════════════
// /intake-migrate — миграция: пустые/intake sectionId → book-ID
// POST {} — мигрирует последний intake текущего пользователя
// ══════════════════════════════════════════════════════════════════════════════

const BOOK_IDS_SET = new Set<string>(Object.values(INTAKE_TO_BOOK_ID));

async function handleIntakeMigrate(request: Request, env: Env): Promise<Response> {
  const authHeader = request.headers.get("Authorization") ?? "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!idToken) return jsonCors({ error: "Unauthorized" }, 401);

  const projectId = env.FIREBASE_PROJECT_ID || "crm-living-bp";
  const claims = await verifyFirebaseIdToken(idToken, projectId);
  if (!claims) return jsonCors({ error: "Unauthorized" }, 401);

  const db = createFirestoreRestClient(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const userDoc = await db.collection("users").doc(claims.uid).get();
  if (!userDoc.exists) return jsonCors({ error: "User not registered" }, 400);
  const { businessId } = userDoc.data() as { businessId: string };

  // Читаем последний intake
  const snap = await db
    .collection(`tenants/${businessId}/plan_intakes`)
    .orderBy("extractedAt", "desc")
    .get();

  if (!snap.docs.length) return jsonCors({ migrated: 0, message: "Нет данных для миграции" });

  const doc = snap.docs[0]!;
  const data = doc.data() as Record<string, unknown>;
  const sections = Array.isArray(data.mappedSections)
    ? (data.mappedSections as Array<Record<string, unknown>>)
    : [];

  let migratedCount = 0;
  const byBookId = new Map<string, { contentSummary: string; confidence: number; present: boolean }>();

  for (const s of sections) {
    const rawId = typeof s.sectionId === "string" ? s.sectionId : "";
    const contentSummary = typeof s.contentSummary === "string" ? s.contentSummary : "";
    const confidence = typeof s.confidence === "number" ? s.confidence : 0;
    const present = Boolean(s.present);

    let bookId: string;
    if (BOOK_IDS_SET.has(rawId)) {
      bookId = rawId; // уже book-ID
    } else if (INTAKE_TO_BOOK_ID[rawId]) {
      bookId = INTAKE_TO_BOOK_ID[rawId]!;
      migratedCount++;
    } else if (!rawId && contentSummary) {
      // Пустой sectionId: инферируем из текста
      const inferred = inferIntakeId(contentSummary);
      bookId = (inferred && INTAKE_TO_BOOK_ID[inferred]) ? INTAKE_TO_BOOK_ID[inferred]! : "appendix";
      migratedCount++;
    } else {
      continue; // пустой без контента — пропустить
    }

    const existing = byBookId.get(bookId);
    if (!existing) {
      byBookId.set(bookId, { contentSummary, confidence, present });
    } else if (present) {
      byBookId.set(bookId, {
        contentSummary: existing.contentSummary
          ? `${existing.contentSummary}\n\n${contentSummary}`.trim()
          : contentSummary,
        confidence: Math.max(existing.confidence, confidence),
        present: true,
      });
    }
  }

  if (migratedCount === 0) {
    return jsonCors({ migrated: 0, message: "Данные уже в актуальном формате" });
  }

  const updatedSections = BOOK_SECTION_IDS.map((bookId) => {
    const d = byBookId.get(bookId);
    return d
      ? { sectionId: bookId, ...d }
      : { sectionId: bookId, contentSummary: "", confidence: 0, present: false };
  });

  try {
    await db
      .collection(`tenants/${businessId}/plan_intakes`)
      .doc(doc.id)
      .set({ ...data, mappedSections: updatedSections } as unknown as Record<string, unknown>);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonCors({ error: `Ошибка сохранения: ${msg}` }, 500);
  }

  return jsonCors({ migrated: migratedCount, total: sections.length, message: `Мигрировано ${migratedCount} разделов` });
}

// ══════════════════════════════════════════════════════════════════════════════
// /intake-refine — append-only дополнение раздела бизнес-плана
// POST { planId, sectionId, gapQuestion, answer }
// Auth: Firebase ID Token (Bearer)
// ══════════════════════════════════════════════════════════════════════════════

interface RefinementEntry {
  timestamp: string;
  question: string;
  answer: string;
}

async function handleIntakeRefine(request: Request, env: Env): Promise<Response> {
  // ── 1. Auth ────────────────────────────────────────────────────────────
  const authHeader = request.headers.get("Authorization") ?? "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!idToken) return jsonCors({ error: "Unauthorized" }, 401);

  const projectId = env.FIREBASE_PROJECT_ID || "crm-living-bp";
  const claims = await verifyFirebaseIdToken(idToken, projectId);
  if (!claims) return jsonCors({ error: "Unauthorized" }, 401);

  // ── 2. Resolve businessId ──────────────────────────────────────────────
  const db = createFirestoreRestClient(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const userDoc = await db.collection("users").doc(claims.uid).get();
  if (!userDoc.exists) return jsonCors({ error: "User not registered" }, 400);
  const { businessId } = userDoc.data() as { businessId: string };

  // ── 3. Parse body ──────────────────────────────────────────────────────
  let body: { planId?: string; sectionId?: string; gapQuestion?: string; answer?: string };
  try {
    body = await request.json() as typeof body;
  } catch {
    return jsonCors({ error: "Invalid JSON" }, 400);
  }

  const { planId, sectionId, gapQuestion, answer } = body;
  if (!planId || !sectionId || !gapQuestion || !answer?.trim()) {
    return jsonCors({ error: "Missing required fields: planId, sectionId, gapQuestion, answer" }, 400);
  }

  // ── 4. Load current section content (append-only: read before write) ──
  const intakeRef = db.collection(`tenants/${businessId}/plan_intakes`).doc(planId);
  const intakeDoc = await intakeRef.get();
  if (!intakeDoc.exists) return jsonCors({ error: "Plan intake not found" }, 404);

  const intakeData = intakeDoc.data() as Record<string, unknown>;

  // Existing changelog (typed array, may be absent on first refinement)
  const existingChangelog: RefinementEntry[] = Array.isArray(intakeData.refinementChangelog)
    ? (intakeData.refinementChangelog as RefinementEntry[])
    : [];

  const timestamp = new Date().toISOString();
  const attribution = `Дополнено ${timestamp}: ${answer.trim()}`;

  const newEntry: RefinementEntry = {
    timestamp,
    question: gapQuestion,
    answer: answer.trim(),
  };

  const changelog: RefinementEntry[] = [...existingChangelog, newEntry];

  // ── 5. Append to section content (never overwrite) ────────────────────
  // sections live in mappedSections[].contentSummary — find and append
  const mappedSections = Array.isArray(intakeData.mappedSections)
    ? (intakeData.mappedSections as Array<Record<string, unknown>>)
    : [];

  let sectionFound = false;
  const updatedSections = mappedSections.map((s) => {
    if (s.sectionId !== sectionId) return s;
    sectionFound = true;
    const existing = typeof s.contentSummary === "string" ? s.contentSummary : "";
    return { ...s, contentSummary: existing ? `${existing}\n\n${attribution}` : attribution, present: true };
  });

  // If section wasn't in mappedSections at all, add it
  if (!sectionFound) {
    updatedSections.push({
      sectionId,
      present: true,
      contentSummary: attribution,
      confidence: 0.5,
    });
  }

  // Remove refined gap from assessment.gaps (append-only data stays, UI filter based on changelog)
  const assessment = typeof intakeData.assessment === "object" && intakeData.assessment !== null
    ? (intakeData.assessment as Record<string, unknown>)
    : {};

  const updatedGaps = Array.isArray(assessment.gaps)
    ? (assessment.gaps as Array<Record<string, unknown>>).filter(
        (g) => g.missingSection !== sectionId,
      )
    : [];

  // ── 6. Save (append-only: existing fields preserved, only gaps+sections updated) ──
  try {
    await intakeRef.set({
      ...intakeData,
      mappedSections: updatedSections,
      assessment: { ...assessment, gaps: updatedGaps },
      refinementChangelog: changelog,
    } as unknown as Record<string, unknown>);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonCors({ error: `Ошибка сохранения: ${msg}` }, 500);
  }

  return jsonCors({ sectionId, appended: attribution, changelog });
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

  let claims: Awaited<ReturnType<typeof verifyFirebaseIdToken>>;
  try {
    claims = await verifyFirebaseIdToken(idToken, projectId);
  } catch (e) {
    console.error("[register] verifyToken threw:", e instanceof Error ? e.message : String(e));
    return jsonCors({ error: "Ошибка верификации токена" }, 500);
  }
  if (!claims) return jsonCors({ error: "Invalid token" }, 401);

  const uid = claims.uid;

  let db: ReturnType<typeof createFirestoreRestClient>;
  try {
    db = createFirestoreRestClient(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } catch (e) {
    console.error("[register] createFirestoreClient threw:", e instanceof Error ? e.message : String(e));
    return jsonCors({ error: "Ошибка инициализации БД" }, 500);
  }

  // Idempotent: if users/{uid} already exists, return existing businessId
  let userDoc;
  try {
    userDoc = await db.collection("users").doc(uid).get();
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[register] GET users/%s threw:", uid, detail);
    return jsonCors({ error: "Ошибка чтения пользователя из БД", detail }, 500);
  }

  if (userDoc.exists) {
    const data = userDoc.data() as { businessId: string };
    return jsonCors({ businessId: data.businessId });
  }

  // New user: businessId = отдельный UUID (никогда не uid)
  const businessId = crypto.randomUUID();
  const now = new Date().toISOString();

  try {
    await db
      .collection("tenants")
      .doc(businessId)
      .collection("_meta")
      .doc("info")
      .set({ createdAt: now, ownerUid: uid });
  } catch (e) {
    console.error("[register] SET tenants/%s/_meta/info threw:", businessId, e instanceof Error ? e.message : String(e));
    return jsonCors({ error: `Ошибка создания тенанта: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }

  try {
    await db.collection("users").doc(uid).set({ businessId, role: "owner", createdAt: now });
  } catch (e) {
    console.error("[register] SET users/%s threw:", uid, e instanceof Error ? e.message : String(e));
    return jsonCors({ error: `Ошибка записи пользователя: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }

  console.log("[register] new user uid=%s businessId=%s", uid, businessId);
  return jsonCors({ businessId });
}

// ══════════════════════════════════════════════════════════════════════════════
// /events-user handler — приём событий от аутентифицированного пользователя
// Auth: Firebase ID Token (Bearer). businessId резолвится серверно из Firestore.
// ══════════════════════════════════════════════════════════════════════════════

async function handleEventsUser(request: Request, env: Env): Promise<Response> {
  // ── 1. Auth: Firebase ID Token ──────────────────────────────────────────
  const authHeader = request.headers.get("Authorization") ?? "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!idToken) return jsonCors({ error: "Unauthorized" }, 401);

  const projectId = env.FIREBASE_PROJECT_ID || "crm-living-bp";
  const claims = await verifyFirebaseIdToken(idToken, projectId);
  if (!claims) return jsonCors({ error: "Unauthorized" }, 401);
  if (!claims.email_verified) return jsonCors({ error: "Email not verified" }, 403);

  // ── 2. Резолв businessId из Firestore (uid ≠ businessId) ────────────────
  const db = createFirestoreRestClient(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const userDoc = await db.collection("users").doc(claims.uid).get();
  if (!userDoc.exists) return jsonCors({ error: "User not registered. Call /register first." }, 400);
  const { businessId } = userDoc.data() as { businessId: string };

  // ── 3. Parse body ────────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonCors({ error: "Invalid JSON" }, 400);
  }

  const rawItems: unknown[] = Array.isArray(body) ? body : [body];

  // ── 4. Inject businessId (prevent spoofing) ──────────────────────────────
  // Replace any businessId fields in events with the server-resolved value
  const sanitizedItems = rawItems.map((item) =>
    typeof item === "object" && item !== null
      ? { ...(item as Record<string, unknown>), businessId }
      : item
  );

  // ── 5. Save ──────────────────────────────────────────────────────────────
  try {
    const result = await run(sanitizedItems, db);
    return jsonCors(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return jsonCors({ error: message }, 500);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// /generate handler — генерация плана из ответов анкеты
// ══════════════════════════════════════════════════════════════════════════════

async function handleGenerate(request: Request, env: Env): Promise<Response> {
  // ── 1. Auth ──────────────────────────────────────────────────────────────
  const authHeader = request.headers.get("Authorization") ?? "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!idToken) return jsonCors({ error: "Unauthorized" }, 401);

  const projectId = env.FIREBASE_PROJECT_ID || "crm-living-bp";
  const claims = await verifyFirebaseIdToken(idToken, projectId);
  if (!claims) return jsonCors({ error: "Invalid token" }, 401);

  const uid = claims.uid;

  // ── 2. Получаем businessId из Firestore (серверная сторона — не из тела запроса) ──
  const db = createFirestoreRestClient(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const userDoc = await db.collection("users").doc(uid).get();
  if (!userDoc.exists) {
    return jsonCors({ error: "User not registered. Call /register first." }, 400);
  }
  const userData = userDoc.data() as { businessId: string };
  const businessId = userData.businessId;

  // ── 3. Разбираем ответы анкеты ───────────────────────────────────────────
  let answers: Record<string, string>;
  try {
    const body = (await request.json()) as { answers?: Record<string, string> };
    if (!body.answers || typeof body.answers !== "object") {
      return jsonCors({ error: "Missing answers" }, 400);
    }
    answers = body.answers;
  } catch {
    return jsonCors({ error: "Invalid JSON body" }, 400);
  }

  // ── 4. Генерируем план через Claude ─────────────────────────────────────
  let plan;
  try {
    plan = await generatePlan(answers, env.ANTHROPIC_API_KEY);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonCors({ error: `Ошибка генерации плана: ${msg}` }, 500);
  }

  // ── 5. Сохраняем в Firestore ─────────────────────────────────────────────
  const intakeId = crypto.randomUUID();
  const now = new Date().toISOString();

  // tenants/{businessId}/plan_intakes/{intakeId} — подхватывает useIntake hook
  try {
    await db
      .collection(`tenants/${businessId}/plan_intakes`)
      .doc(intakeId)
      .set({
        intakeId,
        businessId,
        extractedAt: now,
        source: "questionnaire",
        mappedSections: plan.mappedSections,
        assessment: plan.assessment,
        confidence: plan.confidence,
        disclaimer: plan.disclaimer,
        status: "accepted_as_v1",
      } as unknown as Record<string, unknown>);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonCors({ error: `Ошибка сохранения plan_intakes: ${msg}` }, 500);
  }

  // tenants/{businessId}/plan_versions/v1 — версионирование по спеке
  try {
    await db
      .collection(`tenants/${businessId}/plan_versions`)
      .doc("v1")
      .set({
        planId: intakeId,
        source: "questionnaire",
        answers,
        plan: plan.mappedSections,
        assessment: plan.assessment,
        createdAt: now,
      } as unknown as Record<string, unknown>);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonCors({ error: `Ошибка сохранения plan_versions: ${msg}` }, 500);
  }

  return jsonCors({ planId: intakeId, plan: plan.mappedSections, assessment: plan.assessment });
}

// ══════════════════════════════════════════════════════════════════════════════
// /external handler — приём внешних сигналов (§12)
// Auth: Firebase Bearer token ИЛИ X-Api-Key + ?businessId=
// SHA-256 dedup по (type, source, ts, payload)
// ══════════════════════════════════════════════════════════════════════════════

async function handleExternal(request: Request, env: Env): Promise<Response> {
  const projectId = env.FIREBASE_PROJECT_ID || "crm-living-bp";
  const authHeader = request.headers.get("Authorization") ?? "";
  const apiKeyHeader = request.headers.get("X-Api-Key") ?? "";

  let businessId: string;
  const db = createFirestoreRestClient(env.FIREBASE_SERVICE_ACCOUNT_JSON);

  if (authHeader.startsWith("Bearer ")) {
    // Firebase token auth — businessId resolved from Firestore users/{uid}
    const idToken = authHeader.slice(7).trim();
    const claims = await verifyFirebaseIdToken(idToken, projectId);
    if (!claims) return jsonCors({ error: "Unauthorized" }, 401);

    const userDoc = await db.collection("users").doc(claims.uid).get();
    if (!userDoc.exists) return jsonCors({ error: "User not registered" }, 400);
    businessId = (userDoc.data() as { businessId: string }).businessId;
  } else if (apiKeyHeader) {
    // API key auth — businessId from query param
    if (!isValidSecret(apiKeyHeader, env.INGEST_API_SECRET)) {
      return jsonCors({ error: "Unauthorized" }, 401);
    }
    const url = new URL(request.url);
    const bid = url.searchParams.get("businessId");
    if (!bid) return jsonCors({ error: "Missing businessId query param" }, 400);
    businessId = bid;
  } else {
    return jsonCors({ error: "Unauthorized" }, 401);
  }

  // Parse and validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonCors({ error: "Invalid JSON" }, 400);
  }

  const parsed = ExternalSignal.safeParse(body);
  if (!parsed.success) {
    return jsonCors({ error: "Validation error", details: parsed.error.issues }, 422);
  }
  const signal = parsed.data;

  // SHA-256 dedup key
  const canonical = JSON.stringify({
    type: signal.type,
    source: signal.source,
    ts: signal.ts,
    payload: signal.payload,
  });
  const hashBuf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  const hash = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Idempotent write — skip if already stored
  const existing = await db
    .collection(`tenants/${businessId}/external_signals`)
    .doc(hash)
    .get();
  if (existing.exists) {
    return jsonCors({ hash, status: "duplicate" });
  }

  await db
    .collection(`tenants/${businessId}/external_signals`)
    .doc(hash)
    .set({
      ...signal,
      hash,
      businessId,
      receivedAt: new Date().toISOString(),
    } as unknown as Record<string, unknown>);

  return jsonCors({ hash, status: "ok" });
}

// ══════════════════════════════════════════════════════════════════════════════
// Main fetch handler
// ══════════════════════════════════════════════════════════════════════════════

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await dispatchRequest(request, env);
    } catch (e) {
      // Uncaught exception — ensure CORS headers are always present
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[worker] unhandled error:", msg);
      return jsonCors({ error: "Внутренняя ошибка сервера" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function dispatchRequest(request: Request, env: Env): Promise<Response> {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // ── /register — регистрация нового пользователя ──────────────────────
    if (request.method === "POST" && url.pathname === "/register") {
      return handleRegister(request, env);
    }

    // ── /generate — генерация плана из анкеты ────────────────────────────
    if (request.method === "POST" && url.pathname === "/generate") {
      return handleGenerate(request, env);
    }

    // ── /intake — бизнес-план (Firebase auth) ────────────────────────────
    if (request.method === "POST" && url.pathname === "/intake") {
      return handleIntake(request, env);
    }

    // ── /intake-migrate — однократная миграция: intake-ID → book-ID ───────
    if (request.method === "POST" && url.pathname === "/intake-migrate") {
      return handleIntakeMigrate(request, env);
    }

    // ── /intake-refine — append-only дополнение раздела ────────────────
    if (request.method === "POST" && url.pathname === "/intake-refine") {
      return handleIntakeRefine(request, env);
    }

    // ── /external — внешние сигналы §12 (Firebase auth или API key) ───────
    if (request.method === "POST" && url.pathname === "/external") {
      return handleExternal(request, env);
    }

    // ── /events-user — события от аутентифицированного пользователя ───────
    if (request.method === "POST" && url.pathname === "/events-user") {
      return handleEventsUser(request, env);
    }

    // ── /compliance/extract — разбор требования ──────────────────────────
    if (request.method === "POST" && url.pathname === "/compliance/extract") {
      return handleComplianceExtract(request, env);
    }

    // ── /revision-doc — загрузка исходного документа ревизии, dedup SHA-256
    if (request.method === "POST" && url.pathname === "/revision-doc") {
      return handleRevisionDoc(request, env);
    }

    // ── /api/documents — приём КНД XML ───────────────────────────────────
    if (request.method === "POST" && url.pathname === "/api/documents") {
      const db = createFirestoreRestClient(env.FIREBASE_SERVICE_ACCOUNT_JSON);
      return handleDocuments(request, db);
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
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Api-Key",
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
