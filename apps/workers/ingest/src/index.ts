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
import { BusinessEvent, ExternalPushSignal, RequestItem, INTAKE_TO_BOOK_ID, BOOK_SECTION_IDS, type SourceDocKind, Entitlements, BusinessPlanV1 } from "@crm/schemas";
import { handleDocuments } from "./documents.js";
import { createFirestoreRestClient, saveEvents, registerTenant, loadEvents, loadForecast, loadBusinessPlan, saveBusinessPlan } from "@crm/firestore-adapter";
import { generatePlan, ExtractedPlanSchema, AssessmentOutputSchema } from "@crm/ai-kit";
import { REQUIRED_SECTIONS, mapToSections, gateIntake, classifyDocument, checkAccess, startTrial, simulateScenario, rankScenarios, buildPlanDiff } from "@crm/core";
import { mulberry32 } from "@crm/core";
import { EXTRACT_SYSTEM, ASSESS_SYSTEM } from "./prompts.generated.js";
import { STRATEGY_LIBRARY } from "@crm/core";

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
// Sheet name → book-ID mapping (fuzzy: any included keyword wins)
const SHEET_TO_BOOK: Array<{ kw: string[]; id: string }> = [
  { kw: ["миссия", "стратегия", "резюме", "summary", "vision", "обзор"], id: "mission" },
  { kw: ["цели", "goals", "задачи", "objectives"], id: "goals" },
  { kw: ["приоритет", "priorities"], id: "priorities" },
  { kw: ["продукт", "услуга", "product", "service", "решение", "предложение"], id: "product" },
  { kw: ["рынок", "market", "аудитория", "сегмент", "целевая"], id: "markets" },
  { kw: ["маркетинг", "marketing", "продвижение", "реклама", "канал"], id: "marketing" },
  { kw: ["ресурс", "resource", "операц", "operation", "процесс"], id: "resources" },
  { kw: ["финанс", "finance", "деньг", "бюджет", "budget", "p&l", "прибыл", "убыток"], id: "finance" },
  { kw: ["прогноз продаж", "forecast", "выручк", "план продаж"], id: "forecast" },
  { kw: ["платеж", "payment", "календарь", "график"], id: "payments" },
  { kw: ["pest", "внешн", "макро", "external", "среда"], id: "pest" },
  { kw: ["конкурент", "competitor", "анализ рынка", "competitive"], id: "competitors" },
  { kw: ["преимущество", "advantage", "уникальн", "value proposition"], id: "advantages" },
  { kw: ["структура компани", "схема", "организаци"], id: "structure" },
  { kw: ["команда", "кадры", "team", "сотрудник", "персонал", "staff", "hr", "штат"], id: "team" },
  { kw: ["риск", "risk", "угроза", "swot"], id: "risks" },
  { kw: ["дорожная карта", "roadmap", "план развития", "milestone", "этап"], id: "roadmap" },
  { kw: ["kpi", "метрик", "показател", "okr"], id: "kpi" },
  { kw: ["инвестиц", "investment", "финансирование", "грант", "субсидия"], id: "investment" },
  { kw: ["заключен", "conclusion", "итог", "выход", "exit"], id: "conclusion" },
  { kw: ["приложен", "appendix", "прилож", "дополнение"], id: "appendix" },
];

function matchSheetToBookId(sheetName: string): string | null {
  const lower = sheetName.toLowerCase().trim();
  for (const { kw, id } of SHEET_TO_BOOK) {
    if (kw.some(k => lower.includes(k))) return id;
  }
  return null;
}

async function extractXlsxText(buffer: ArrayBuffer): Promise<{ text: string; sheetNames: string[] }> {
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
      if (view.getUint32(pos, true) !== 0x02014b50) break;
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

      if (method === 0) return new TextDecoder().decode(compressed);
      if (method === 8) {
        const ds = new DecompressionStream("deflate-raw");
        const w = ds.writable.getWriter();
        await w.write(compressed);
        await w.close();
        const out = await new Response(ds.readable).arrayBuffer();
        return new TextDecoder().decode(out);
      }
      return null;
    }
    return null;
  }

  // Sheet names from workbook.xml
  const wbXml = await readZipEntry("xl/workbook.xml");
  const sheetNames: string[] = [];
  if (wbXml) {
    const re = /<sheet\b[^>]*\bname="([^"]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(wbXml)) !== null) {
      if (m[1]) sheetNames.push(m[1]);
    }
  }

  // sharedStrings.xml содержит все строковые значения ячеек
  const ssXml = await readZipEntry("xl/sharedStrings.xml");

  if (!ssXml) return { text: "(Excel: нет текстовых данных)", sheetNames };

  const texts: string[] = [];
  const re = /<t[^>]*>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ssXml)) !== null) {
    const t = m[1]?.trim();
    if (t) texts.push(t);
  }

  return {
    text: texts.length > 0 ? texts.join(" | ") : "(Excel: только числа, текстовых строк нет)",
    sheetNames,
  };
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
      "anthropic-beta": "prompt-caching-2024-07-31",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 16000,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
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
// /plan-assess — холистическая оценка всего плана одним вызовом Claude
// ══════════════════════════════════════════════════════════════════════════════

const PLAN_ASSESS_SYSTEM = `Ты — независимый эксперт по due diligence бизнес-планов (методология Пола Хейга, 50 фреймворков).
Тебе дают бизнес-план, разложенный по стандартным разделам. Для КАЖДОГО заполненного раздела оцени три параметра:

1. ОБЪЕКТИВНОСТЬ — утверждения опираются на факты/расчёты или это оптимистичные декларации без основания?
2. РЕАЛИСТИЧНОСТЬ — соответствуют ли цифры, сроки и допущения типичным отраслевым бенчмаркам? Нет ли внутренних противоречий с цифрами из ДРУГИХ разделов?
3. ОБОСНОВАННОСТЬ — за каждой ключевой цифрой есть прослеживаемый расчёт/источник, или число "с потолка"?

ПРАВИЛА:
- Если раздел объективен, реалистичен и обоснован — verdict: "approved", comments: [].
- Если есть проблемы — verdict: "flagged", перечисли конкретные comments с точной цитатой (quote), степенью серьёзности (severity: low/medium/high) и конкретным предложением (suggested_fix) — не общими словами, а тем, что можно сразу подставить в текст.
- В cross_section_issues перечисли противоречия МЕЖДУ разделами с указанием, какие именно конфликтуют.
- Не занижай оценку из вежливости — это настоящий критический разбор, как от независимого инвестора.
- Отвечай только валидным JSON без markdown-разметки.

ФОРМАТ:
{
  "sections": [
    {
      "section_key": "finance",
      "verdict": "flagged",
      "scores": { "objectivity": 0.6, "realism": 0.4, "justification": 0.5 },
      "comments": [
        { "issue": "...", "quote": "...", "severity": "high", "suggested_fix": "..." }
      ]
    }
  ],
  "cross_section_issues": [
    { "sections": ["finance", "markets"], "issue": "Описание противоречия" }
  ]
}`;

async function callClaudeAssess(apiKey: string, planText: string): Promise<unknown> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 10000,
      thinking: { type: "enabled", budget_tokens: 5000 },
      system: [{ type: "text", text: PLAN_ASSESS_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: planText }],
    }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Claude assess ${res.status}: ${txt.slice(0, 200)}`);
  }
  const msg = (await res.json()) as { content: Array<{ type: string; text?: string }> };
  const raw = msg.content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("\n\n")
    .replace(/^```(?:json)?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();
  if (!raw) throw new Error("Claude вернул пустой ответ (оценка плана)");
  return JSON.parse(raw);
}

async function handlePlanAssess(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const authHeader = request.headers.get("Authorization") ?? "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!idToken) return jsonCors({ error: "Unauthorized" }, 401);

  const claims = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID || "crm-living-bp");
  if (!claims) return jsonCors({ error: "Unauthorized" }, 401);

  const db = createFirestoreRestClient(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const userDoc = await db.collection("users").doc(claims.uid).get();
  if (!userDoc.exists) return jsonCors({ error: "User not registered" }, 400);
  const { businessId } = userDoc.data() as { businessId: string };

  let body: { planId?: string };
  try {
    body = await request.json() as typeof body;
  } catch {
    return jsonCors({ error: "Invalid JSON" }, 400);
  }
  const { planId } = body;
  if (!planId) return jsonCors({ error: "Missing planId" }, 400);

  // ── Billing gate ──────────────────────────────────────────────────────────
  const ent = await loadEntitlements(db, businessId);
  const access = checkAccess(ent, "plan_assess", planId, new Date().toISOString());
  if (!access.allowed) return jsonCors({ error: access.reason, requiredProduct: access.requiredProduct, requiredTier: access.requiredTier }, 402);

  const intakeRef = db.collection(`tenants/${businessId}/plan_intakes`).doc(planId);
  const intakeDoc = await intakeRef.get();
  if (!intakeDoc.exists) return jsonCors({ error: "Plan not found" }, 404);

  const intakeData = intakeDoc.data() as Record<string, unknown>;
  const sections = Array.isArray(intakeData.mappedSections)
    ? (intakeData.mappedSections as Array<Record<string, unknown>>)
    : [];

  const present = sections.filter(
    s => Boolean(s.present) && typeof s.contentSummary === "string" && (s.contentSummary as string).length > 10,
  );
  if (present.length === 0) {
    return jsonCors({ error: "Нет разделов для оценки. Загрузите бизнес-план." }, 422);
  }

  const planText = present
    .map(s => `[${s.sectionId}]:\n${s.contentSummary}`)
    .join("\n\n---\n\n");

  // Сразу пишем статус "processing" и отвечаем — тяжёлый LLM идёт в фоне
  await intakeRef.set(
    { ...intakeData, assessmentStatus: "processing", assessmentError: null } as unknown as Record<string, unknown>,
  );

  ctx.waitUntil(
    (async () => {
      try {
        const result = await callClaudeAssess(env.ANTHROPIC_API_KEY, planText);
        const holisticAssessment = {
          ...(result as Record<string, unknown>),
          assessedAt: new Date().toISOString(),
        };
        await intakeRef.set(
          { ...intakeData, holisticAssessment, assessmentStatus: "done", assessmentError: null } as unknown as Record<string, unknown>,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[plan-assess] LLM error:", msg);
        await intakeRef.set(
          { ...intakeData, assessmentStatus: "error", assessmentError: msg } as unknown as Record<string, unknown>,
        ).catch(() => {});
      }
    })(),
  );

  return jsonCors({ planId, status: "queued" });
}

// ══════════════════════════════════════════════════════════════════════════════
// /plan-reform — переформирование плана с учётом принятых правок + каскад
// POST { planId, acceptedChanges: AcceptedChange[] }
// ══════════════════════════════════════════════════════════════════════════════

interface AcceptedChange {
  section_key: string;
  original_issue: string;
  applied_text: string;
  user_edited: boolean;
}

const PLAN_REFORM_SYSTEM = `Ты — редактор бизнес-планов (методология Пола Хейга).
Тебе дан бизнес-план по разделам и список ПРИНЯТЫХ пользователем правок.

ЗАДАЧА: перепиши только затронутые разделы, внедрив каждую правку.
ВАЖНО: если правка в одном разделе требует согласованных изменений в других
(например, снижение прогноза продаж должно отразиться в финансах и инвестициях) —
синхронизируй связанные разделы автоматически. Разделы без логической связи с
правками не трогай — сохраняй исходный текст дословно.

Верни ТОЛЬКО валидный JSON без markdown:
{ "sections": { "<sectionId>": "<новый текст раздела>" } }
Включай в sections ТОЛЬКО изменённые разделы.`;

async function handlePlanReform(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const authHeader = request.headers.get("Authorization") ?? "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!idToken) return jsonCors({ error: "Unauthorized" }, 401);

  const claims = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID || "crm-living-bp");
  if (!claims) return jsonCors({ error: "Unauthorized" }, 401);

  const db = createFirestoreRestClient(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const userDoc = await db.collection("users").doc(claims.uid).get();
  if (!userDoc.exists) return jsonCors({ error: "User not registered" }, 400);
  const { businessId } = userDoc.data() as { businessId: string };

  let body: { planId?: string; acceptedChanges?: AcceptedChange[] };
  try {
    body = await request.json() as typeof body;
  } catch {
    return jsonCors({ error: "Invalid JSON" }, 400);
  }
  const { planId, acceptedChanges } = body;
  if (!planId) return jsonCors({ error: "Missing planId" }, 400);
  if (!acceptedChanges?.length) return jsonCors({ error: "No accepted changes" }, 400);

  // ── Billing gate ──────────────────────────────────────────────────────────
  const entR = await loadEntitlements(db, businessId);
  const accessR = checkAccess(entR, "plan_reform", planId, new Date().toISOString());
  if (!accessR.allowed) return jsonCors({ error: accessR.reason, requiredProduct: accessR.requiredProduct, requiredTier: accessR.requiredTier }, 402);

  const intakeRef = db.collection(`tenants/${businessId}/plan_intakes`).doc(planId);
  const intakeDoc = await intakeRef.get();
  if (!intakeDoc.exists) return jsonCors({ error: "Plan not found" }, 404);

  const intakeData = intakeDoc.data() as Record<string, unknown>;
  const sections = Array.isArray(intakeData.mappedSections)
    ? (intakeData.mappedSections as Array<Record<string, unknown>>)
    : [];

  const original: Record<string, string> = {};
  for (const s of sections) {
    if (s.present && typeof s.contentSummary === "string" && s.contentSummary.length > 5) {
      original[String(s.sectionId)] = s.contentSummary;
    }
  }

  const userInput = JSON.stringify({ original, accepted_changes: acceptedChanges });

  await intakeRef.set(
    { ...intakeData, reformStatus: "processing" } as unknown as Record<string, unknown>,
  );

  ctx.waitUntil(
    (async () => {
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "prompt-caching-2024-07-31",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 12000,
            system: [{ type: "text", text: PLAN_REFORM_SYSTEM, cache_control: { type: "ephemeral" } }],
            messages: [{ role: "user", content: userInput }],
          }),
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`Claude reform ${res.status}: ${txt.slice(0, 200)}`);
        }
        const msg = (await res.json()) as { content: Array<{ type: string; text?: string }> };
        const raw = msg.content
          .filter(b => b.type === "text" && b.text)
          .map(b => b.text!)
          .join("\n\n")
          .replace(/^```(?:json)?\n?/i, "")
          .replace(/\n?```$/i, "")
          .trim();
        const result = JSON.parse(raw) as { sections?: Record<string, string> };

        if (!result.sections || typeof result.sections !== "object") throw new Error("Некорректный ответ AI");

        const updatedSections = sections.map(s => {
          const newText = result.sections![String(s.sectionId)];
          if (!newText) return s;
          return { ...s, contentSummary: newText, present: true, confidence: Math.max(Number(s.confidence) || 0, 0.85) };
        });

        await intakeRef.set({
          ...intakeData,
          mappedSections: updatedSections,
          lastReformedAt: new Date().toISOString(),
          reformChangesCount: acceptedChanges.length,
          reformStatus: "done",
        } as unknown as Record<string, unknown>);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[plan-reform] error:", msg);
        await intakeRef.set({ ...intakeData, reformStatus: "error", reformError: msg } as unknown as Record<string, unknown>).catch(() => {});
      }
    })(),
  );

  return jsonCors({ planId, status: "queued" });
}

// ══════════════════════════════════════════════════════════════════════════════
// /plan-roadmap — LLM-дорожная карта из финального плана
// POST { planId }
// ══════════════════════════════════════════════════════════════════════════════

const PLAN_ROADMAP_SYSTEM = `Ты — операционный консультант. На основе бизнес-плана составь конкретную дорожную карту реализации.
НЕ общие фразы ("развивать проект"). ТОЛЬКО конкретные действия:
"Подать заявку в Минэкономразвития", "Зарегистрировать ООО через ФНС онлайн", "Подписать договор аренды".

Верни ТОЛЬКО валидный JSON без markdown:
{
  "phases": [
    {
      "phase": 1,
      "title": "Название фазы",
      "actions": ["Конкретное действие 1", "Конкретное действие 2"],
      "dueInDays": 30,
      "depends_on": [],
      "deliverable": "Что конкретно будет готово"
    }
  ]
}`;

async function handlePlanRoadmap(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const authHeader = request.headers.get("Authorization") ?? "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!idToken) return jsonCors({ error: "Unauthorized" }, 401);

  const claims = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID || "crm-living-bp");
  if (!claims) return jsonCors({ error: "Unauthorized" }, 401);

  const db = createFirestoreRestClient(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const userDoc = await db.collection("users").doc(claims.uid).get();
  if (!userDoc.exists) return jsonCors({ error: "User not registered" }, 400);
  const { businessId } = userDoc.data() as { businessId: string };

  let body: { planId?: string };
  try {
    body = await request.json() as typeof body;
  } catch {
    return jsonCors({ error: "Invalid JSON" }, 400);
  }
  const { planId } = body;
  if (!planId) return jsonCors({ error: "Missing planId" }, 400);

  // ── Billing gate ──────────────────────────────────────────────────────────
  const entRm = await loadEntitlements(db, businessId);
  const accessRm = checkAccess(entRm, "plan_roadmap", planId, new Date().toISOString());
  if (!accessRm.allowed) return jsonCors({ error: accessRm.reason, requiredProduct: accessRm.requiredProduct, requiredTier: accessRm.requiredTier }, 402);

  const intakeRef = db.collection(`tenants/${businessId}/plan_intakes`).doc(planId);
  const intakeDoc = await intakeRef.get();
  if (!intakeDoc.exists) return jsonCors({ error: "Plan not found" }, 404);

  const intakeData = intakeDoc.data() as Record<string, unknown>;
  const sections = Array.isArray(intakeData.mappedSections)
    ? (intakeData.mappedSections as Array<Record<string, unknown>>)
    : [];

  const planText = sections
    .filter(s => Boolean(s.present) && typeof s.contentSummary === "string" && (s.contentSummary as string).length > 10)
    .map(s => `[${s.sectionId}]: ${s.contentSummary}`)
    .join("\n\n");

  if (!planText) return jsonCors({ error: "Нет данных для построения дорожной карты" }, 422);

  await intakeRef.set(
    { ...intakeData, roadmapStatus: "processing" } as unknown as Record<string, unknown>,
  );

  ctx.waitUntil(
    (async () => {
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "prompt-caching-2024-07-31",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 4000,
            system: [{ type: "text", text: PLAN_ROADMAP_SYSTEM, cache_control: { type: "ephemeral" } }],
            messages: [{ role: "user", content: planText }],
          }),
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`Claude roadmap ${res.status}: ${txt.slice(0, 200)}`);
        }
        const msg = (await res.json()) as { content: Array<{ type: string; text?: string }> };
        const raw = msg.content
          .filter(b => b.type === "text" && b.text)
          .map(b => b.text!)
          .join("\n\n")
          .replace(/^```(?:json)?\n?/i, "")
          .replace(/\n?```$/i, "")
          .trim();
        const result = JSON.parse(raw) as { phases?: unknown[] };

        if (!Array.isArray(result.phases)) throw new Error("Некорректный ответ AI");

        const generatedRoadmap = { phases: result.phases, generatedAt: new Date().toISOString() };
        await intakeRef.set(
          { ...intakeData, generatedRoadmap, roadmapStatus: "done" } as unknown as Record<string, unknown>,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[plan-roadmap] error:", msg);
        await intakeRef.set({ ...intakeData, roadmapStatus: "error", roadmapError: msg } as unknown as Record<string, unknown>).catch(() => {});
      }
    })(),
  );

  return jsonCors({ planId, status: "queued" });
}

// ══════════════════════════════════════════════════════════════════════════════
// /plan-grant — адаптация плана под грантовую программу
// POST { planId, grantType }
// ══════════════════════════════════════════════════════════════════════════════

type GrantType = "minek" | "agrostartup" | "governor" | "minvostok" | "skolkovo" | "fondprez";

const GRANT_META: Record<GrantType, { label: string; maxRub: string; required: string[] }> = {
  minek:       { label: "Минэкономразвития «Мой бизнес»", maxRub: "500 000 ₽",  required: ["mission", "markets", "finance", "team", "kpi"] },
  agrostartup: { label: "Агростартап (МСХП)",             maxRub: "3 000 000 ₽", required: ["mission", "resources", "finance", "team", "kpi"] },
  governor:    { label: "Губернаторский грант",            maxRub: "по региону",  required: ["mission", "markets", "team", "kpi", "investment"] },
  minvostok:   { label: "Минвостокразвития (ДФО)",         maxRub: "5 000 000 ₽", required: ["mission", "markets", "finance", "team", "resources", "risks"] },
  skolkovo:    { label: "Сколково",                        maxRub: "до 5 млн ₽",  required: ["mission", "markets", "team", "investment"] },
  fondprez:    { label: "Президентский фонд культурных инициатив", maxRub: "по конкурсу", required: ["mission", "marketing", "team", "investment"] },
};

const GRANT_ADAPT_SYSTEM = (meta: typeof GRANT_META[GrantType]) =>
  `Ты — эксперт по российским грантовым программам (${meta.label}, до ${meta.maxRub}).
Тебе дан бизнес-план. Переформатируй его под требования этой программы:
- Используй официальную терминологию фонда
- Разделы, которых не хватает, добавь с пометкой "[ТРЕБУЕТ ЗАПОЛНЕНИЯ]"
- Выдели социальный и экономический эффект — это критично для грантового комитета
- Укажи соответствие критериям отбора программы
- Обоснуй запрашиваемую сумму конкретными статьями расходов

Верни ТОЛЬКО валидный JSON без markdown:
{
  "readinessScore": 0–100,
  "missingSections": ["sectionId", ...],
  "weakSections": ["sectionId", ...],
  "adaptedSections": { "<sectionId>": "<переформатированный текст или [ТРЕБУЕТ ЗАПОЛНЕНИЯ]>" },
  "grantSummary": "Краткое резюме готовности плана под эту программу (3-4 предложения)"
}`;

async function handlePlanGrant(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const authHeader = request.headers.get("Authorization") ?? "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!idToken) return jsonCors({ error: "Unauthorized" }, 401);

  const claims = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID || "crm-living-bp");
  if (!claims) return jsonCors({ error: "Unauthorized" }, 401);

  const db = createFirestoreRestClient(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const userDoc = await db.collection("users").doc(claims.uid).get();
  if (!userDoc.exists) return jsonCors({ error: "User not registered" }, 400);
  const { businessId } = userDoc.data() as { businessId: string };

  let body: { planId?: string; grantType?: string };
  try {
    body = await request.json() as typeof body;
  } catch {
    return jsonCors({ error: "Invalid JSON" }, 400);
  }
  const { planId, grantType } = body;
  if (!planId) return jsonCors({ error: "Missing planId" }, 400);
  if (!grantType || !(grantType in GRANT_META)) {
    return jsonCors({ error: `Неверный grantType. Допустимые: ${Object.keys(GRANT_META).join(", ")}` }, 400);
  }

  // ── Billing gate ──────────────────────────────────────────────────────────
  const entG = await loadEntitlements(db, businessId);
  const accessG = checkAccess(entG, "grant_adapt", planId, new Date().toISOString());
  if (!accessG.allowed) return jsonCors({ error: accessG.reason, requiredProduct: accessG.requiredProduct, requiredTier: accessG.requiredTier }, 402);

  const meta = GRANT_META[grantType as GrantType];

  const intakeRef = db.collection(`tenants/${businessId}/plan_intakes`).doc(planId);
  const intakeDoc = await intakeRef.get();
  if (!intakeDoc.exists) return jsonCors({ error: "Plan not found" }, 404);

  const intakeData = intakeDoc.data() as Record<string, unknown>;
  const sections = Array.isArray(intakeData.mappedSections)
    ? (intakeData.mappedSections as Array<Record<string, unknown>>)
    : [];

  // Check readiness without LLM first
  const required = meta.required;
  const presentIds = new Set(sections.filter(s => Boolean(s.present)).map(s => String(s.sectionId)));
  const missingSections = required.filter(id => !presentIds.has(id));
  const weakSections = sections
    .filter(s => Boolean(s.present) && required.includes(String(s.sectionId)) && (Number(s.confidence) || 0) < 0.6)
    .map(s => String(s.sectionId));

  const planText = sections
    .filter(s => Boolean(s.present) && typeof s.contentSummary === "string" && (s.contentSummary as string).length > 10)
    .map(s => `[${s.sectionId}]:\n${s.contentSummary}`)
    .join("\n\n---\n\n");

  if (!planText) return jsonCors({ error: "Нет данных для адаптации" }, 422);

  const existing = typeof intakeData.grantAdaptations === "object" && intakeData.grantAdaptations !== null
    ? (intakeData.grantAdaptations as Record<string, unknown>)
    : {};

  // Немедленно пишем статус для этого конкретного гранта
  await intakeRef.set({
    ...intakeData,
    grantAdaptations: { ...existing, [grantType]: { grantType, grantLabel: meta.label, status: "processing" } },
  } as unknown as Record<string, unknown>);

  const userMessage = `Программа: ${meta.label}\nТребуемые разделы: ${required.join(", ")}\n\n${planText}`;

  ctx.waitUntil(
    (async () => {
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "prompt-caching-2024-07-31",
          },
          body: JSON.stringify({
            model: "claude-sonnet-4-6",
            max_tokens: 8000,
            system: [{ type: "text", text: GRANT_ADAPT_SYSTEM(meta), cache_control: { type: "ephemeral" } }],
            messages: [{ role: "user", content: userMessage }],
          }),
        });
        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`Claude grant ${res.status}: ${txt.slice(0, 200)}`);
        }
        const msg = (await res.json()) as { content: Array<{ type: string; text?: string }> };
        const raw = msg.content
          .filter(b => b.type === "text" && b.text)
          .map(b => b.text!)
          .join("\n\n")
          .replace(/^```(?:json)?\n?/i, "")
          .replace(/\n?```$/i, "")
          .trim();
        const result = JSON.parse(raw) as {
          readinessScore?: number;
          missingSections?: string[];
          weakSections?: string[];
          adaptedSections?: Record<string, string>;
          grantSummary?: string;
        };

        const grantResult = {
          grantType,
          grantLabel: meta.label,
          maxRub: meta.maxRub,
          readinessScore: result.readinessScore ?? (missingSections.length === 0 ? 75 : Math.max(0, 75 - missingSections.length * 15)),
          missingSections: result.missingSections ?? missingSections,
          weakSections: result.weakSections ?? weakSections,
          adaptedSections: result.adaptedSections ?? {},
          grantSummary: result.grantSummary ?? "",
          generatedAt: new Date().toISOString(),
          status: "done",
        };

        await intakeRef.set({
          ...intakeData,
          grantAdaptations: { ...existing, [grantType]: grantResult },
        } as unknown as Record<string, unknown>);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error("[plan-grant] error:", errMsg);
        await intakeRef.set({
          ...intakeData,
          grantAdaptations: { ...existing, [grantType]: { grantType, grantLabel: meta.label, status: "error", errorMsg: errMsg } },
        } as unknown as Record<string, unknown>).catch(() => {});
      }
    })(),
  );

  return jsonCors({ planId, grantType, status: "queued" });
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

  // ── 3. Извлечение текста (без Claude) ────────────────────────────────────
  let rawText: string;
  const xlsxSheetBookIds = new Set<string>();

  switch (true) {
    case mimeType === MIME.DOC:
      return jsonCors({ error: "Формат .doc не поддерживается. Сохраните файл как .docx." }, 400);

    case mimeType === MIME.XLS:
      return jsonCors({ error: "Формат .xls не поддерживается. Сохраните файл как .xlsx." }, 400);

    case mimeType === MIME.PDF: {
      // Базовое извлечение текстовых строк из PDF без внешних библиотек
      const buf = await file.arrayBuffer();
      const pdfStr = new TextDecoder("latin1").decode(buf);
      const strings: string[] = [];
      const re = /\(([^)(]{3,300})\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(pdfStr)) !== null) {
        const s = (m[1] ?? "").replace(/\\[nrt]/g, " ").trim();
        if (s.length > 3) strings.push(s);
      }
      rawText = strings.join(" ");
      if (rawText.length < 30) {
        return jsonCors({ error: "PDF не читается без AI. Загрузите план в формате DOCX или XLSX." }, 422);
      }
      break;
    }

    case mimeType === MIME.DOCX: {
      const buf = await file.arrayBuffer();
      const { value: text } = await mammoth.extractRawText({ arrayBuffer: buf });
      if (!text.trim()) return jsonCors({ error: "DOCX: документ пустой или нечитаем" }, 422);
      rawText = text;
      break;
    }

    case mimeType === MIME.XLSX: {
      const buf = await file.arrayBuffer();
      let xlsxResult: { text: string; sheetNames: string[] };
      try {
        xlsxResult = await extractXlsxText(buf);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return jsonCors({ error: `Ошибка чтения Excel: ${msg}` }, 422);
      }
      rawText = xlsxResult.text;
      if (rawText.startsWith("(Excel:")) {
        return jsonCors({ error: "Excel не содержит текстовых ячеек. Экспортируйте в DOCX или добавьте текстовые описания." }, 422);
      }
      // Book-IDs from sheet names (high-confidence, no Claude needed)
      for (const sheetName of xlsxResult.sheetNames) {
        const bookId = matchSheetToBookId(sheetName);
        if (bookId) xlsxSheetBookIds.add(bookId);
      }
      break;
    }

    case mimeType === MIME.RTF1:
    case mimeType === MIME.RTF2:
      rawText = stripRtf(await file.text());
      break;

    case mimeType.startsWith("text/"):
    case mimeType === "application/octet-stream" && file.name.endsWith(".md"): {
      rawText = await file.text();
      if (!rawText.trim()) return jsonCors({ error: "Файл пустой" }, 422);
      break;
    }

    default:
      return jsonCors(
        { error: `Неподдерживаемый тип: "${mimeType}". Используйте DOCX, XLSX, PDF, TXT или MD.` },
        400,
      );
  }

  // ── 4. Keyword classification — без Claude ────────────────────────────────
  // Разбиваем на чанки ~400 символов для classifyDocument
  const CHUNK = 400;
  const chunks: string[] = [];
  for (let i = 0; i < rawText.length; i += CHUNK) chunks.push(rawText.slice(i, i + CHUNK));
  if (chunks.length === 0) chunks.push(rawText);

  const classified = classifyDocument("business_plan", chunks);

  // Строим rawSections: intake-ID → { text: сниппет, confidence }
  const rawSectionsMap: Record<string, { text: string; confidence: number }> = {};
  for (const s of classified) {
    const existing = rawSectionsMap[s.sectionId];
    if (!existing || s.confidence > existing.confidence) {
      const idx = s.pageRange[0] - 1;
      rawSectionsMap[s.sectionId] = { text: chunks[idx] ?? "", confidence: s.confidence };
    }
  }

  const intakeMapped = Object.entries(rawSectionsMap).map(([sectionId, { confidence }]) => ({
    sectionId,
    present: true,
    confidence,
  }));

  // ── 5. Translate to book-IDs ──────────────────────────────────────────────
  const rawBookSections = translateToBookSections(rawSectionsMap, intakeMapped);

  // Sheet-name overrides: mark sections present if sheet name matched
  const bookSections = xlsxSheetBookIds.size > 0
    ? rawBookSections.map(s =>
        !s.present && xlsxSheetBookIds.has(s.sectionId)
          ? { ...s, present: true, confidence: 0.85, contentSummary: "" }
          : s
      )
    : rawBookSections;

  const presentCount = bookSections.filter(s => s.present).length;
  const confidence = presentCount / bookSections.length;
  const completeness = confidence;

  // ── 6. Формируем intake-документ §20.2 ───────────────────────────────────
  const intakeId = crypto.randomUUID();
  const extractedAt = new Date().toISOString();

  const intakeDoc = {
    intakeId,
    businessId,
    extractedAt,
    mappedSections: bookSections,
    completeness,
    confidence,
    assessment: {
      strengths: [],
      concerns: [],
      gaps: bookSections.filter(s => !s.present).map(s => ({ missingSection: s.sectionId })),
      assumptionsExtracted: {},
      verifiability: [],
    },
    disclaimer: "Оценка предварительная: факт-данных пока нет. Требуется подтверждение аналитиком.",
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
    assessmentReady: false,
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
  "doc_registry", "turnover_sheet", "fixed_asset_card", "authority_request",
  "business_plan", "other",
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

  // Extract text by file type
  const mime = file.type.toLowerCase();
  let rawText: string;
  if (mime.includes("wordprocessingml") || file.name.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    rawText = result.value;
  } else if (mime.includes("spreadsheetml") || file.name.endsWith(".xlsx")) {
    rawText = (await extractXlsxText(buffer)).text;
  } else if (mime.startsWith("text/")) {
    rawText = new TextDecoder().decode(buffer);
  } else {
    rawText = " "; // KIND_BIAS in classifyDocument handles PDF/binary by kind
  }

  // Split into 600-char page chunks
  const pages: string[] = [];
  for (let i = 0; i < rawText.length; i += 600) pages.push(rawText.slice(i, i + 600));
  if (pages.length === 0) pages.push(" ");

  const docSections = classifyDocument(kind as SourceDocKind, pages);

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
        pages: pages.length,
        mappedSections: docSections,
        status: "mapped",
        sha256,
      } as unknown as Record<string, unknown>);
  } catch {
    return jsonCors({ error: "Failed to save doc record" }, 500);
  }

  // For business_plan: also write to plan_intakes (non-blocking)
  if (kind === "business_plan" && docSections.length > 0) {
    const intakeId = crypto.randomUUID();
    const bookSecs = translateToBookSections(
      Object.fromEntries(docSections.map(s => [s.sectionId, { text: "", confidence: s.confidence }])),
      docSections.map(s => ({ sectionId: s.sectionId, present: true, confidence: s.confidence })),
    );
    db.collection("tenants").doc(businessId).collection("plan_intakes").doc(intakeId).set({
      intakeId,
      mappedSections: bookSecs,
      assessment: { strengths: [], concerns: [], gaps: [], assumptionsExtracted: {} },
      disclaimer: "Загружено как бизнес-план через /revision-doc",
      status: "mapped",
      extractedAt: now,
    } as unknown as Record<string, unknown>).catch(e => console.warn("[revision-doc] plan_intakes write failed:", e));
  }

  return jsonCors({ docId, sectionsFound: docSections.length, status: "mapped", sha256, message: `Документ обработан, найдено разделов: ${docSections.length}` });
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
// /section-review — Claude оценивает раздел: реалистично / нет / предлагает версию
// POST { planId, sectionId, sectionTitle? }
// Auth: Firebase ID Token (Bearer)
// ══════════════════════════════════════════════════════════════════════════════

const SECTION_REVIEW_SYSTEM = `Ты — аналитик бизнес-планов (методология Пола Хейга, 50 фреймворков, режим intake).
Оцени раздел бизнес-плана на реалистичность и соответствие рыночной практике.

Вход (JSON): { "sectionId": "...", "sectionTitle": "...", "content": "...", "context": "..." }

Верни ТОЛЬКО валидный JSON без markdown:
{
  "verdict": "realistic" | "needs_improvement" | "unrealistic" | "insufficient_data",
  "reasoning": "2-3 предложения: что конкретно и почему",
  "proposedRewrite": "альтернативный текст раздела ≤250 слов или null",
  "successScore": 0-100
}

Правила:
- insufficient_data если content пустой или < 80 символов без конкретики
- proposedRewrite = null если verdict = "realistic" или "insufficient_data"
- НЕ выдумывай цифры которых нет в тексте; основывайся только на предоставленных данных
- successScore: 80+ отлично, 50-79 требует доработки, 0-49 критично
- Всё на русском языке`;

async function handleSectionReview(request: Request, env: Env): Promise<Response> {
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

  let body: { planId?: string; sectionId?: string; sectionTitle?: string };
  try {
    body = await request.json() as typeof body;
  } catch {
    return jsonCors({ error: "Invalid JSON" }, 400);
  }

  const { planId, sectionId, sectionTitle } = body;
  if (!planId || !sectionId) return jsonCors({ error: "Missing planId or sectionId" }, 400);

  const intakeRef = db.collection(`tenants/${businessId}/plan_intakes`).doc(planId);
  const intakeDoc = await intakeRef.get();
  if (!intakeDoc.exists) return jsonCors({ error: "Plan not found" }, 404);

  const intakeData = intakeDoc.data() as Record<string, unknown>;
  const sections = Array.isArray(intakeData.mappedSections)
    ? (intakeData.mappedSections as Array<Record<string, unknown>>)
    : [];

  const section = sections.find(s => s.sectionId === sectionId);
  const content = typeof section?.contentSummary === "string" ? section.contentSummary : "";

  // Brief context from key anchor sections (not the section being reviewed)
  const anchors = ["mission", "markets", "finance", "product"];
  const context = sections
    .filter(s => anchors.includes(String(s.sectionId)) && s.sectionId !== sectionId)
    .map(s => `[${s.sectionId}]: ${String(s.contentSummary ?? "").slice(0, 300)}`)
    .join("\n");

  const claudeInput = JSON.stringify({
    sectionId,
    sectionTitle: sectionTitle ?? sectionId,
    content: content || "(пусто)",
    context,
  });

  let reviewResult: {
    verdict: string;
    reasoning: string;
    proposedRewrite: string | null;
    successScore: number;
  };
  try {
    reviewResult = await callClaude(
      env.ANTHROPIC_API_KEY,
      SECTION_REVIEW_SYSTEM,
      [{ type: "text", text: claudeInput }],
    ) as typeof reviewResult;
  } catch (e) {
    return jsonCors({ error: `Ошибка AI: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }

  const reviewEntry = {
    verdict: reviewResult.verdict,
    reasoning: reviewResult.reasoning,
    proposedRewrite: reviewResult.proposedRewrite ?? null,
    successScore: reviewResult.successScore,
    reviewedAt: new Date().toISOString(),
    accepted: false,
  };

  const updatedSections = sections.map(s =>
    s.sectionId === sectionId ? { ...s, claudeReview: reviewEntry } : s
  );

  try {
    await intakeRef.set(
      { ...intakeData, mappedSections: updatedSections } as unknown as Record<string, unknown>
    );
  } catch (e) {
    return jsonCors({ error: `Ошибка сохранения: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }

  return jsonCors({ sectionId, review: reviewEntry });
}

// ══════════════════════════════════════════════════════════════════════════════
// /section-accept — принять версию Клода (заменяет contentSummary)
// POST { planId, sectionId, acceptedContent }
// Auth: Firebase ID Token (Bearer)
// ══════════════════════════════════════════════════════════════════════════════

async function handleSectionAccept(request: Request, env: Env): Promise<Response> {
  const authHeader = request.headers.get("Authorization") ?? "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!idToken) return jsonCors({ error: "Unauthorized" }, 401);

  const claims = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID || "crm-living-bp");
  if (!claims) return jsonCors({ error: "Unauthorized" }, 401);

  const db = createFirestoreRestClient(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const userDoc = await db.collection("users").doc(claims.uid).get();
  if (!userDoc.exists) return jsonCors({ error: "User not registered" }, 400);
  const { businessId } = userDoc.data() as { businessId: string };

  let body: { planId?: string; sectionId?: string; acceptedContent?: string };
  try {
    body = await request.json() as typeof body;
  } catch {
    return jsonCors({ error: "Invalid JSON" }, 400);
  }

  const { planId, sectionId, acceptedContent } = body;
  if (!planId || !sectionId || !acceptedContent?.trim()) {
    return jsonCors({ error: "Missing planId, sectionId or acceptedContent" }, 400);
  }

  const intakeRef = db.collection(`tenants/${businessId}/plan_intakes`).doc(planId);
  const intakeDoc = await intakeRef.get();
  if (!intakeDoc.exists) return jsonCors({ error: "Plan not found" }, 404);

  const intakeData = intakeDoc.data() as Record<string, unknown>;
  const sections = Array.isArray(intakeData.mappedSections)
    ? (intakeData.mappedSections as Array<Record<string, unknown>>)
    : [];

  const updatedSections = sections.map(s => {
    if (s.sectionId !== sectionId) return s;
    const existingReview = s.claudeReview && typeof s.claudeReview === "object"
      ? s.claudeReview as Record<string, unknown>
      : {};
    return {
      ...s,
      contentSummary: acceptedContent.trim(),
      present: true,
      confidence: Math.max(typeof s.confidence === "number" ? s.confidence : 0, 0.8),
      claudeReview: { ...existingReview, accepted: true },
    };
  });

  try {
    await intakeRef.set(
      { ...intakeData, mappedSections: updatedSections } as unknown as Record<string, unknown>
    );
  } catch (e) {
    return jsonCors({ error: `Ошибка сохранения: ${e instanceof Error ? e.message : String(e)}` }, 500);
  }

  return jsonCors({ sectionId, status: "accepted" });
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

  const parsed = ExternalPushSignal.safeParse(body);
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
// Billing helpers — gate + trial
// ══════════════════════════════════════════════════════════════════════════════

const DEFAULT_ENTITLEMENTS = (businessId: string): Entitlements => ({
  businessId,
  plan: "free",
  paidUntil: null,
  freeComplianceUsed: false,
  freeReportUsed: false,
  updatedAt: new Date().toISOString() as `${string}T${string}Z`,
  tier: "free",
  trialEndsAt: null,
  purchases: [],
  usage: { complianceCases: 0, taxReports: 0, planAssessRuns: 0 },
});

async function loadEntitlements(
  db: ReturnType<typeof createFirestoreRestClient>,
  businessId: string,
): Promise<Entitlements> {
  const doc = await db.collection(`tenants/${businessId}/_meta`).doc("entitlements").get();
  if (!doc.exists) return DEFAULT_ENTITLEMENTS(businessId);
  const parsed = Entitlements.safeParse({ ...doc.data(), businessId });
  return parsed.success ? parsed.data : DEFAULT_ENTITLEMENTS(businessId);
}

async function saveEntitlements(
  db: ReturnType<typeof createFirestoreRestClient>,
  businessId: string,
  ent: Entitlements,
): Promise<void> {
  await db.collection(`tenants/${businessId}/_meta`).doc("entitlements").set(ent as unknown as Record<string, unknown>);
}

async function handleBillingStartTrial(request: Request, env: Env): Promise<Response> {
  const authHeader = request.headers.get("Authorization") ?? "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!idToken) return jsonCors({ error: "Unauthorized" }, 401);

  const claims = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID || "crm-living-bp");
  if (!claims) return jsonCors({ error: "Unauthorized" }, 401);

  const db = createFirestoreRestClient(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const userDoc = await db.collection("users").doc(claims.uid).get();
  if (!userDoc.exists) return jsonCors({ error: "User not registered" }, 400);
  const { businessId } = userDoc.data() as { businessId: string };

  let body: { tier?: string };
  try { body = await request.json() as typeof body; } catch { return jsonCors({ error: "Invalid JSON" }, 400); }

  const tier = body.tier;
  if (!tier || !["pulse", "operator", "director"].includes(tier)) {
    return jsonCors({ error: "tier должен быть pulse|operator|director" }, 400);
  }

  const ent = await loadEntitlements(db, businessId);
  const result = startTrial(ent, tier as "pulse" | "operator" | "director", new Date().toISOString());
  if (!result.ok) return jsonCors({ error: result.error.message }, 409);

  await saveEntitlements(db, businessId, result.value);
  return jsonCors({ trialEndsAt: result.value.trialEndsAt });
}

async function handleBillingState(request: Request, env: Env): Promise<Response> {
  const authHeader = request.headers.get("Authorization") ?? "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!idToken) return jsonCors({ error: "Unauthorized" }, 401);

  const claims = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID || "crm-living-bp");
  if (!claims) return jsonCors({ error: "Unauthorized" }, 401);

  const db = createFirestoreRestClient(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const userDoc = await db.collection("users").doc(claims.uid).get();
  if (!userDoc.exists) return jsonCors({ error: "User not registered" }, 400);
  const { businessId } = userDoc.data() as { businessId: string };

  const ent = await loadEntitlements(db, businessId);
  return jsonCors(ent);
}

// ══════════════════════════════════════════════════════════════════════════════
// Main fetch handler
// ══════════════════════════════════════════════════════════════════════════════

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await dispatchRequest(request, env, ctx);
    } catch (e) {
      // Uncaught exception — ensure CORS headers are always present
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[worker] unhandled error:", msg);
      return jsonCors({ error: "Внутренняя ошибка сервера" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

// ══════════════════════════════════════════════════════════════════════════════
// /scenarios/simulate — запуск Монте-Карло симуляции набора сценариев
// POST { businessId, planId }
// ══════════════════════════════════════════════════════════════════════════════

async function handleScenariosSimulate(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const authHeader = request.headers.get("Authorization") ?? "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!idToken) return jsonCors({ error: "Unauthorized" }, 401);

  const claims = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID || "crm-living-bp");
  if (!claims) return jsonCors({ error: "Unauthorized" }, 401);

  const db = createFirestoreRestClient(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const userDoc = await db.collection("users").doc(claims.uid).get();
  if (!userDoc.exists) return jsonCors({ error: "User not registered" }, 400);
  const { businessId } = userDoc.data() as { businessId: string };

  let body: { planId?: string };
  try { body = await request.json() as typeof body; } catch { return jsonCors({ error: "Invalid JSON" }, 400); }

  const { planId } = body;
  if (!planId) return jsonCors({ error: "Missing planId" }, 400);

  const ent = await loadEntitlements(db, businessId);
  const access = checkAccess(ent, "plan_roadmap", planId, new Date().toISOString());
  if (!access.allowed) return jsonCors({ error: access.reason, requiredProduct: access.requiredProduct, requiredTier: access.requiredTier }, 402);

  const runId = crypto.randomUUID();
  const runRef = db.collection(`tenants/${businessId}/scenarios`).doc(runId);
  await runRef.set({ status: "processing", createdAt: new Date().toISOString() } as unknown as Record<string, unknown>);

  ctx.waitUntil(
    (async () => {
      try {
        const [eventsResult, forecastResult, planResult] = await Promise.all([
          loadEvents(db, businessId),
          loadForecast(db, businessId),
          loadBusinessPlan(db, businessId, planId),
        ]);

        const events = eventsResult.ok ? eventsResult.value.events : [];
        const baseForecast = forecastResult.ok && forecastResult.value
          ? forecastResult.value
          : { generatedAt: new Date().toISOString().slice(0, 10), horizonDays: 90, dailyBalances: [], gapDate: null, gapAmount: null, hardGapDate: null, pessimisticGapDate: null, confidence: 0.5 };

        const businessPlan = planResult.ok ? planResult.value : null;

        // Берём 2-3 комбинации рычагов из library
        const leverCombos = [
          [STRATEGY_LIBRARY[0]!.levers[0]!],
          [STRATEGY_LIBRARY[1]!.levers[0]!, STRATEGY_LIBRARY[1]!.levers[1]!],
          [STRATEGY_LIBRARY[2]!.levers[0]!, STRATEGY_LIBRARY[2]!.levers[1]!, STRATEGY_LIBRARY[3]!.levers[0]!],
        ];

        const mockPlan: BusinessPlanV1 = businessPlan ?? {
          planId,
          businessId,
          version: 1 as const,
          status: "active" as const,
          parentVersion: null,
          sourceIntakeId: planId,
          createdAt: new Date().toISOString(),
          assumptions: {},
        };

        const results = leverCombos.map((levers, i) =>
          simulateScenario(mockPlan, levers, events, baseForecast, mulberry32(i * 1000 + Date.now()))
        );

        const ranked = rankScenarios(results.map(r => ({ ...r, runId })));
        await runRef.set({ status: "done", results: ranked, createdAt: new Date().toISOString() } as unknown as Record<string, unknown>);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[scenarios/simulate] error:", msg);
        await runRef.set({ status: "error", error: msg } as unknown as Record<string, unknown>).catch(() => {});
      }
    })(),
  );

  return jsonCors({ runId, status: "queued" });
}

// ══════════════════════════════════════════════════════════════════════════════
// /scenarios/accept — принятие сценария, создание новой версии плана
// POST { businessId, runId, scenarioId, uid }
// ══════════════════════════════════════════════════════════════════════════════

async function handleScenariosAccept(request: Request, env: Env): Promise<Response> {
  const authHeader = request.headers.get("Authorization") ?? "";
  const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!idToken) return jsonCors({ error: "Unauthorized" }, 401);

  const claims = await verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID || "crm-living-bp");
  if (!claims) return jsonCors({ error: "Unauthorized" }, 401);

  const db = createFirestoreRestClient(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const userDoc = await db.collection("users").doc(claims.uid).get();
  if (!userDoc.exists) return jsonCors({ error: "User not registered" }, 400);
  const { businessId } = userDoc.data() as { businessId: string };

  let body: { runId?: string; scenarioId?: string; planId?: string };
  try { body = await request.json() as typeof body; } catch { return jsonCors({ error: "Invalid JSON" }, 400); }

  const { runId, scenarioId, planId } = body;
  if (!runId || !scenarioId || !planId) return jsonCors({ error: "Missing runId, scenarioId or planId" }, 400);

  const ent = await loadEntitlements(db, businessId);
  const access = checkAccess(ent, "plan_roadmap", planId, new Date().toISOString());
  if (!access.allowed) return jsonCors({ error: access.reason, requiredProduct: access.requiredProduct, requiredTier: access.requiredTier }, 402);

  // Загружаем результаты симуляции
  const runDoc = await db.collection(`tenants/${businessId}/scenarios`).doc(runId).get();
  if (!runDoc.exists) return jsonCors({ error: "Run not found" }, 404);

  const runData = runDoc.data() as { results?: Array<Record<string, unknown>> };
  const scenario = runData.results?.find(r => r.scenarioId === scenarioId);
  if (!scenario) return jsonCors({ error: "Scenario not found in run" }, 404);

  // Загружаем текущий план
  const planResult = await loadBusinessPlan(db, businessId, planId);
  if (!planResult.ok || !planResult.value) return jsonCors({ error: "Plan not found" }, 404);

  const currentPlan = planResult.value;
  const leverNames = Array.isArray(scenario.levers) ? scenario.levers as string[] : [];
  const diff = buildPlanDiff(currentPlan.assumptions, leverNames);

  // Новая версия плана — append-only
  const newPlanId = crypto.randomUUID();
  const newPlan: BusinessPlanV1 = {
    planId: newPlanId,
    businessId,
    version: 1 as const,      // РЕШЕНИЕ: BusinessPlanV1 всегда version:1, новая «версия» — это новый v1 с parent трассировкой
    status: "active" as const,
    parentVersion: null,
    sourceIntakeId: currentPlan.sourceIntakeId,
    createdAt: new Date().toISOString(),
    assumptions: { ...currentPlan.assumptions },
  };

  // Архивируем старый план
  const archivedPlan: BusinessPlanV1 = { ...currentPlan, status: "archived" as const };

  await Promise.all([
    saveBusinessPlan(db, businessId, archivedPlan),
    saveBusinessPlan(db, businessId, newPlan),
    db.collection(`tenants/${businessId}/scenario_decisions`).doc(scenarioId).set({
      scenarioId,
      runId,
      decidedBy: claims.uid,
      decidedAt: new Date().toISOString(),
      accepted: true,
      newPlanId,
    } as unknown as Record<string, unknown>),
  ]);

  return jsonCors({ newPlanId, diff });
}

async function dispatchRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

    // ── /section-review — Claude оценивает раздел ──────────────────────
    if (request.method === "POST" && url.pathname === "/section-review") {
      return handleSectionReview(request, env);
    }

    // ── /section-accept — принять версию Клода ─────────────────────────
    if (request.method === "POST" && url.pathname === "/section-accept") {
      return handleSectionAccept(request, env);
    }

    // ── /billing/start-trial ─────────────────────────────────────────────
    if (request.method === "POST" && url.pathname === "/billing/start-trial") {
      return handleBillingStartTrial(request, env);
    }

    // ── /billing/state ───────────────────────────────────────────────────
    if (request.method === "GET" && url.pathname === "/billing/state") {
      return handleBillingState(request, env);
    }

    // ── /plan-assess — холистическая оценка всего плана ────────────────
    if (request.method === "POST" && url.pathname === "/plan-assess") {
      return handlePlanAssess(request, env, ctx);
    }

    // ── /plan-reform — переформирование плана с принятыми правками ─────
    if (request.method === "POST" && url.pathname === "/plan-reform") {
      return handlePlanReform(request, env, ctx);
    }

    // ── /plan-roadmap — LLM-дорожная карта из финального плана ─────────
    if (request.method === "POST" && url.pathname === "/plan-roadmap") {
      return handlePlanRoadmap(request, env, ctx);
    }

    // ── /plan-grant — адаптация под грантовую программу ────────────────
    if (request.method === "POST" && url.pathname === "/plan-grant") {
      return handlePlanGrant(request, env, ctx);
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

    // ── /scenarios/simulate — запуск симуляции сценариев ─────────────────
    if (request.method === "POST" && url.pathname === "/scenarios/simulate") {
      return handleScenariosSimulate(request, env, ctx);
    }

    // ── /scenarios/accept — принятие сценария и версионирование плана ────
    if (request.method === "POST" && url.pathname === "/scenarios/accept") {
      return handleScenariosAccept(request, env);
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
