/**
 * Seed script: Kamchatka glamping project
 * - Deletes fake test events from Firestore
 * - Creates tenant/kamchatka with PlanIntake + BusinessPlanV1
 * - Calls Claude API to extract + assess assumptions from the project document
 *
 * Run: ANTHROPIC_API_KEY=<key> node --loader ts-node/esm tools/seed/kamchatka.ts
 */

import { readFileSync } from "fs";
import { createSign } from "crypto";
import { randomUUID } from "crypto";
import Anthropic from "@anthropic-ai/sdk";

// ── Config ────────────────────────────────────────────────────────────────────

const SA_PATH =
  "/Users/annagranenova/Downloads/Life_CRM/crm-living-bp-firebase-adminsdk-fbsvc-642d33bf13.json";
const DOC_PATH =
  "/Users/annagranenova/Downloads/🗻 Камчатка/КАМЧАТКА_Полный_план_проекта.md";
const PROJECT_ID = "crm-living-bp";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const BUSINESS_ID = "kamchatka";

// ── Firestore JWT ─────────────────────────────────────────────────────────────

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function makeJwt(sa: ServiceAccount): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: sa.client_email,
      sub: sa.client_email,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
      scope: "https://www.googleapis.com/auth/datastore",
    }),
  );
  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${payload}`);
  const sig = base64url(sign.sign(sa.private_key));
  return `${header}.${payload}.${sig}`;
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const jwt = makeJwt(sa);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get access token: ${text}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

// ── Firestore helpers ─────────────────────────────────────────────────────────

type FirestoreValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { mapValue: { fields: Record<string, FirestoreValue> } }
  | { arrayValue: { values: FirestoreValue[] } };

function toFirestore(val: unknown): FirestoreValue {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === "boolean") return { booleanValue: val };
  if (typeof val === "number") {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (typeof val === "string") return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestore) } };
  }
  if (typeof val === "object") {
    const fields: Record<string, FirestoreValue> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      fields[k] = toFirestore(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function objToFields(obj: Record<string, unknown>): Record<string, FirestoreValue> {
  const fields: Record<string, FirestoreValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    fields[k] = toFirestore(v);
  }
  return fields;
}

async function fsWrite(
  token: string,
  path: string,
  doc: Record<string, unknown>,
): Promise<void> {
  const url = `${FIRESTORE_BASE}/${path}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: objToFields(doc) }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Firestore PATCH ${path} failed: ${text}`);
  }
  console.log(`  ✓ wrote ${path}`);
}

async function fsDelete(token: string, path: string): Promise<void> {
  const url = `${FIRESTORE_BASE}/${path}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Firestore DELETE ${path} failed: ${text}`);
  }
  console.log(`  ✓ deleted ${path} (status ${res.status})`);
}

async function fsListIds(token: string, collectionPath: string): Promise<string[]> {
  const url = `${FIRESTORE_BASE}/${collectionPath}?pageSize=100`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    if (res.status === 404) return [];
    const text = await res.text();
    throw new Error(`Firestore LIST ${collectionPath} failed: ${text}`);
  }
  const data = (await res.json()) as { documents?: Array<{ name: string }> };
  if (!data.documents) return [];
  return data.documents.map((d) => d.name.split("/").at(-1) as string);
}

// ── Claude helpers ────────────────────────────────────────────────────────────

async function extractAssumptions(
  client: Anthropic,
  docText: string,
): Promise<Record<string, unknown>> {
  const systemPrompt = readFileSync(
    new URL("../../packages/ai-kit/prompts/intake_extract.md", import.meta.url),
  ).toString();

  const userContent = `businessId: ${BUSINESS_ID}\n\nДокумент:\n${docText.slice(0, 80000)}`;

  const msg = await client.messages.create({
    model: "claude-3-5-haiku-latest",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  const text = msg.content.find((c) => c.type === "text")?.text ?? "{}";
  return JSON.parse(text) as Record<string, unknown>;
}

async function assessPlan(
  client: Anthropic,
  extracted: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const systemPrompt = readFileSync(
    new URL("../../packages/ai-kit/prompts/intake_assess.md", import.meta.url),
  ).toString();

  const userContent = `Структура плана:\n${JSON.stringify(extracted, null, 2).slice(0, 40000)}`;

  const msg = await client.messages.create({
    model: "claude-3-5-haiku-latest",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userContent }],
  });

  const text = msg.content.find((c) => c.type === "text")?.text ?? "{}";
  return JSON.parse(text) as Record<string, unknown>;
}

// ── Human-seeded data ─────────────────────────────────────────────────────────

const ROADMAP = [
  { id: "geo_807", title: "Геодезия уч. :807", date: "2026-06", cost_kopecks: 5000000, status: "planned", critical: false, origin: "human" },
  { id: "dalnedrа_license", title: "Заявление в Дальнедра (скважина)", date: "2026-06", cost_kopecks: 15000000, status: "planned", critical: true, origin: "human" },
  { id: "clearance_807", title: "Расчистка территории :807", date: "2026-06", cost_kopecks: 20000000, status: "planned", critical: false, origin: "human" },
  { id: "engineering_807", title: "Инженерные изыскания :807", date: "2026-07", cost_kopecks: 30000000, status: "planned", critical: false, origin: "human" },
  { id: "greenhouse_807", title: "Теплица 400м² на :807", date: "2026-07", cost_kopecks: 80000000, status: "planned", critical: false, origin: "human" },
  { id: "power_807", title: "Электроснабжение ГЭУ", date: "2026-07", cost_kopecks: 150000000, status: "planned", critical: true, origin: "human" },
  { id: "water_807", title: "Питьевая скважина", date: "2026-07", cost_kopecks: 40000000, status: "planned", critical: false, origin: "human" },
  { id: "sewage_807", title: "ЛОС (канализация)", date: "2026-08", cost_kopecks: 60000000, status: "planned", critical: false, origin: "human" },
  { id: "vri_notify_dec26", title: "Уведомление ВРИ (оба участка)", date: "2026-12", cost_kopecks: 0, status: "planned", critical: true, origin: "human" },
  { id: "modules_order", title: "Закупка 10 модулей (аванс)", date: "2027-01", cost_kopecks: 300000000, status: "planned", critical: true, origin: "human" },
  { id: "minek_grant_apply", title: "Подача субсидии Минэк", date: "2027-02", cost_kopecks: 0, status: "planned", critical: true, origin: "human" },
  { id: "vri_deadline", title: "ДЕДЛАЙН — уведомление ВРИ", date: "2027-03-02", cost_kopecks: 0, status: "planned", critical: true, origin: "human" },
  { id: "thermal_drill", title: "Бурение термальной скважины", date: "2027-04", cost_kopecks: 450000000, status: "planned", critical: true, origin: "human" },
  { id: "modules_install", title: "Доставка + монтаж 10 модулей", date: "2027-06", cost_kopecks: 1200000000, status: "planned", critical: true, origin: "human" },
  { id: "pools_install", title: "Купели 4шт + разводка", date: "2027-06", cost_kopecks: 120000000, status: "planned", critical: true, origin: "human" },
  { id: "fit_out", title: "Отделка, мебель, текстиль", date: "2027-07", cost_kopecks: 300000000, status: "planned", critical: false, origin: "human" },
  { id: "staff_hire", title: "Набор персонала (6 чел.)", date: "2027-08", cost_kopecks: 39000000, status: "planned", critical: false, origin: "human" },
  { id: "opening", title: "ОТКРЫТИЕ ГЛЭМПИНГА", date: "2027-09-01", cost_kopecks: 0, status: "planned", critical: true, origin: "human" },
  { id: "minek_payout", title: "Субсидия Минэк — выплата", date: "2027-09", cost_kopecks: 0, status: "planned", critical: true, origin: "human" },
];

const FINANCIAL_MODEL = {
  period: "annual",
  currency: "₽",
  years: [
    { year: 2027, revenue_kopecks: 420000000, expenses_kopecks: 390000000, ebitda_kopecks: 30000000, capex_kopecks: 3179000000, grants_kopecks: 0, note: "Partial season, opening Sep 2027" },
    { year: 2028, revenue_kopecks: 1260000000, expenses_kopecks: 780000000, ebitda_kopecks: 480000000, capex_kopecks: 0, grants_kopecks: 1500000000, note: "First full season + Minec payout" },
    { year: 2029, revenue_kopecks: 2077500000, expenses_kopecks: 900000000, ebitda_kopecks: 1177500000, capex_kopecks: 0, grants_kopecks: 1000000000, note: "Governor grant expected" },
    { year: 2030, revenue_kopecks: 2500000000, expenses_kopecks: 950000000, ebitda_kopecks: 1550000000, capex_kopecks: 0, grants_kopecks: 0 },
    { year: 2031, revenue_kopecks: 2800000000, expenses_kopecks: 1000000000, ebitda_kopecks: 1800000000, capex_kopecks: 0, grants_kopecks: 0 },
  ],
};

const SCENARIOS = [
  {
    id: "optimistic",
    label: "Оптимистичный",
    description: "Все гранты получены (23 млн), ТОР одобрен, скважина даёт 65°C, occupancy 90% летом",
    occupancy_summer_pct: 90,
    revenue_year1_kopecks: 630000000,
    payback_years: 3.5,
    key_assumptions: ["Все гранты 23 млн", "ТОР резидентство", "Термальная скважина 65°C", "Occupancy 90% летом"],
  },
  {
    id: "base",
    label: "Базовый",
    description: "Получены Минэк (15 млн) + Агростартап (5 млн), ТОР одобрен, скважина работает",
    occupancy_summer_pct: 80,
    revenue_year1_kopecks: 420000000,
    payback_years: 4.5,
    key_assumptions: ["Минэк 15 млн + Агростартап 5 млн", "ТОР резидентство", "Occupancy 80% летом"],
  },
  {
    id: "pessimistic",
    label: "Пессимистичный",
    description: "Только Агростартап (3 млн), ТОР задержан, скважина не пробурена до 2028",
    occupancy_summer_pct: 50,
    revenue_year1_kopecks: 210000000,
    payback_years: 8,
    key_assumptions: ["Только Агростартап 3 млн", "ТОР задержан", "Без скважины — нет купелей", "Occupancy 50% летом"],
  },
];

const RISKS = [
  { id: "gazprom_811", title: "Газпром запрет на :811", probability: "medium", impact: "high", mitigation: "Получить письменное согласование до строительства", origin: "human" },
  { id: "dalnedra_delay", title: "Задержка лицензии Дальнедра", probability: "high", impact: "high", mitigation: "Подать немедленно, нанять юриста с опытом лицензирования", origin: "human" },
  { id: "thermal_no_water", title: "Скважина не даёт термальную воду", probability: "low", impact: "critical", mitigation: "Геофизика ВЭЗ до бурения, выбор точки бурения специалистом", origin: "human" },
  { id: "grant_minek_miss", title: "Промах по срокам субсидии Минэк", probability: "medium", impact: "high", mitigation: "Модули должны стоять до февраля 2027, подача в феврале 2027", origin: "human" },
  { id: "vri_fz119", title: "Изъятие участка по ФЗ-119 (неосвоение)", probability: "low", impact: "critical", mitigation: "Теплица + конструкции до 31.12.2026, уведомление ВРИ до 02.03.2027", origin: "human" },
  { id: "logistics_kamchatka", title: "Логистика модулей на Камчатку (+40% к цене)", probability: "high", impact: "medium", mitigation: "Заложить в бюджет, искать местных производителей SIP-панелей", origin: "human" },
  { id: "tor_delay", title: "Задержка ТОР резидентства", probability: "medium", impact: "medium", mitigation: "Подать немедленно, иметь план Б (ОЭЗ, прямые субсидии)", origin: "human" },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY env var is required");

  console.log("Reading service account...");
  const sa = JSON.parse(readFileSync(SA_PATH, "utf-8")) as ServiceAccount;

  console.log("Getting Firestore access token...");
  const token = await getAccessToken(sa);

  console.log("Reading Kamchatka document...");
  const docText = readFileSync(DOC_PATH, "utf-8");
  console.log(`  Document length: ${docText.length} chars`);

  // ── 1. Delete fake test events ──────────────────────────────────────────────
  console.log("\n1. Deleting fake test events...");
  await fsDelete(token, "events/550e8400-e29b-41d4-a716-446655440001");
  const tenantEventIds = await fsListIds(token, "tenants/opentgp/events");
  console.log(`  Found ${tenantEventIds.length} events in tenants/opentgp/events`);
  for (const id of tenantEventIds) {
    await fsDelete(token, `tenants/opentgp/events/${id}`);
  }

  // ── 2. Create tenant kamchatka ─────────────────────────────────────────────
  console.log("\n2. Creating tenant kamchatka...");
  await fsWrite(token, "tenants/kamchatka", {
    tenantId: "kamchatka",
    name: "Глэмпинг Камчатка",
    type: "capital_project",
    stage: "pre_revenue",
    createdAt: new Date().toISOString(),
    description: "Глэмпинг + термальные купели + агро, открытие 2027-09",
  });

  // ── 3. Claude: extract assumptions ─────────────────────────────────────────
  console.log("\n3. Calling Claude to extract assumptions...");
  const client = new Anthropic({ apiKey });
  const extracted = await extractAssumptions(client, docText);
  console.log(`  Extracted ${Object.keys((extracted.assumptions as Record<string, unknown>) ?? {}).length} assumptions`);
  console.log(`  Extracted ${Object.keys((extracted.rawSections as Record<string, unknown>) ?? {}).length} sections`);

  // ── 4. Claude: assess plan ─────────────────────────────────────────────────
  console.log("\n4. Calling Claude to assess plan...");
  const assessment = await assessPlan(client, extracted);
  const strengths = (assessment.strengths as unknown[]) ?? [];
  const concerns = (assessment.concerns as unknown[]) ?? [];
  const verifiability = (assessment.verifiability as unknown[]) ?? [];
  console.log(`  Strengths: ${strengths.length}, Concerns: ${concerns.length}, Verifiability: ${verifiability.length}`);

  // ── 5. Write PlanIntake ────────────────────────────────────────────────────
  console.log("\n5. Writing PlanIntake...");
  const intakeId = randomUUID();
  const now = new Date().toISOString();

  // Map extracted rawSections to MappedSection array
  const rawSections = (extracted.rawSections as Record<string, { text: string; confidence: number }>) ?? {};
  const mappedSections = Object.entries(rawSections).map(([sectionId, s]) => ({
    sectionId,
    present: true,
    contentSummary: s.text,
    confidence: s.confidence,
  }));

  const intakeDoc = {
    intakeId,
    businessId: BUSINESS_ID,
    extractedAt: now,
    mappedSections,
    assessment: {
      strengths,
      concerns,
      gaps: [],
      assumptionsExtracted: (extracted.assumptions as Record<string, unknown>) ?? {},
      verifiability,
    },
    confidence: 0.75,
    disclaimer:
      "Оценка предварительная: факт-данных пока нет (pre-revenue проект). Все гипотезы требуют подтверждения после открытия. Потолок оценки — A3 (советник).",
    status: "draft",
  };

  await fsWrite(token, `tenants/kamchatka/plan_intakes/${intakeId}`, intakeDoc);

  // ── 6. Write BusinessPlanV1 ────────────────────────────────────────────────
  console.log("\n6. Writing BusinessPlanV1...");
  const planId = randomUUID();

  const businessPlanDoc = {
    planId,
    businessId: BUSINESS_ID,
    version: 1,
    status: "active",
    parentVersion: null,
    sourceIntakeId: intakeId,
    createdAt: now,
    assumptions: (extracted.assumptions as Record<string, unknown>) ?? {},
    // Extra fields (beyond strict schema) — written directly to Firestore
    roadmap: ROADMAP,
    financial_model: FINANCIAL_MODEL,
    scenarios: SCENARIOS,
    risks: RISKS,
  };

  await fsWrite(token, `tenants/kamchatka/business_plans/${planId}`, businessPlanDoc);

  console.log("\n✅ Seed complete!");
  console.log(`  intakeId:  ${intakeId}`);
  console.log(`  planId:    ${planId}`);
  console.log(`  tenant:    tenants/kamchatka`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
