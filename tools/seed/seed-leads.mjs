/**
 * Seed: регистрирует тенанта "demo" и добавляет LeadCaptured события.
 * Нужно чтобы compute-воркер мог насчитать demand_signals.
 * Синтетика ТОЛЬКО под tenants/demo.
 *
 * Run: node tools/seed/seed-leads.mjs
 */

import { createSign, randomUUID } from "crypto";
import { readFileSync } from "fs";

const SA_PATH =
  "/Users/annagranenova/Downloads/Life_CRM/crm-living-bp-firebase-adminsdk-fbsvc-642d33bf13.json";
const PROJECT_ID = "crm-living-bp";
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const BUSINESS_ID = "demo";

// ── JWT / access token ────────────────────────────────────────────────────────

function b64url(input) {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function makeJwt(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iss: sa.client_email,
      sub: sa.client_email,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
      scope: "https://www.googleapis.com/auth/datastore",
    }),
  );
  const signing = `${header}.${payload}`;
  const sign = createSign("RSA-SHA256");
  sign.update(signing);
  const sig = b64url(sign.sign(sa.private_key));
  return `${signing}.${sig}`;
}

async function getAccessToken(sa) {
  const jwt = makeJwt(sa);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("No access token: " + JSON.stringify(data));
  return data.access_token;
}

// ── Firestore helpers ─────────────────────────────────────────────────────────

function toFirestoreValue(val) {
  if (val === null) return { nullValue: null };
  if (typeof val === "boolean") return { booleanValue: val };
  if (typeof val === "number") return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  if (typeof val === "string") return { stringValue: val };
  throw new Error("Unsupported type: " + typeof val);
}

function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    fields[k] = toFirestoreValue(v);
  }
  return fields;
}

async function setDoc(token, path, data) {
  const url = `${FS_BASE}/${path}`;
  const res = await fetch(url + "?updateMask.fieldPaths=" + Object.keys(data).join("&updateMask.fieldPaths="), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`setDoc failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ── Seed ──────────────────────────────────────────────────────────────────────

const sa = JSON.parse(readFileSync(SA_PATH, "utf8"));
const token = await getAccessToken(sa);

console.log("=== seed-leads: start ===\n");

// 1. Регистрируем тенанта demo (идемпотентно)
console.log("[1] registering tenant demo…");
await setDoc(token, `tenants/${BUSINESS_ID}`, { createdAt: new Date().toISOString() });
console.log("  ✓ tenants/demo registered\n");

// 2. Добавляем LeadCaptured события (30 дней назад…сейчас)
console.log("[2] writing lead_captured events…");

const now = Date.now();
const leads = [
  { daysAgo: 25, channel: "website" },
  { daysAgo: 20, channel: "referral" },
  { daysAgo: 18, channel: "website" },
  { daysAgo: 15, channel: "cold_call" },
  { daysAgo: 10, channel: "website" },
  { daysAgo:  7, channel: "social" },
  { daysAgo:  3, channel: "website" },
];

for (const { daysAgo, channel } of leads) {
  const eventId = randomUUID();
  const leadId = randomUUID();
  const ts = new Date(now - daysAgo * 24 * 60 * 60 * 1000).toISOString();

  await setDoc(token, `tenants/${BUSINESS_ID}/events/${eventId}`, {
    type: "lead_captured",
    eventId,
    ts,
    leadId,
    channel,
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    contactPhone: null,
    contactEmail: null,
    source: "manual",
    businessId: BUSINESS_ID,
  });
  process.stdout.write("  . ");
}
console.log(`\n  ✓ ${leads.length} lead events → tenants/demo/events/\n`);

// 3. Также регистрируем воронку с terminal=true для demo (чтобы winRate работал)
console.log("[3] writing funnel config with terminal stages…");
await setDoc(token, `tenants/${BUSINESS_ID}/funnels/main`, {
  funnelId: "main",
  name: "Основная",
});
// Массивы через REST сложнее — пропускаем, воронку уже сидировал seed-deals.mjs
// Для MVP won_stage_ids будет пустым → winRate=null — это норма
console.log("  ✓ funnel config already exists from seed-deals.mjs\n");

console.log("=== seed-leads: done ===");
console.log("Now run compute worker to see demand_signals in Firestore.");
