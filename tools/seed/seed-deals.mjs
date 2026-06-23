/**
 * Seed-прогон: воронка + deal-события → compute → читаем Firestore.
 * Standalone ESM, без TypeScript, без workspace-imports.
 *
 * Run: node tools/seed/seed-deals.mjs
 */

import { createSign, randomUUID } from "crypto";
import { readFileSync } from "fs";

const SA_PATH =
  "/Users/annagranenova/Downloads/Life_CRM/crm-living-bp-firebase-adminsdk-fbsvc-642d33bf13.json";
const PROJECT_ID = "crm-living-bp";
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
// ВАЖНО: демо-данные пишутся только под тенант "demo"
const BUSINESS_ID = "demo";

// ── JWT / access token ────────────────────────────────────────────────────────

function b64url(input) {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function makeJwt(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    iss: sa.client_email, sub: sa.client_email,
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
    scope: "https://www.googleapis.com/auth/datastore",
  }));
  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${payload}`);
  const sig = b64url(sign.sign(sa.private_key));
  return `${header}.${payload}.${sig}`;
}

async function getToken(sa) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: makeJwt(sa),
    }),
  });
  if (!res.ok) throw new Error(`Token error: ${await res.text()}`);
  return (await res.json()).access_token;
}

// ── Firestore REST helpers ────────────────────────────────────────────────────

function toFsVal(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsVal) } };
  if (typeof v === "object") {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = toFsVal(val);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

function toFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) fields[k] = toFsVal(v);
  return fields;
}

function fromFsVal(v) {
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("stringValue" in v) return v.stringValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromFsVal);
  if ("mapValue" in v) {
    const obj = {};
    for (const [k, val] of Object.entries(v.mapValue.fields || {})) obj[k] = fromFsVal(val);
    return obj;
  }
  return null;
}

function fromFields(fields) {
  const obj = {};
  for (const [k, v] of Object.entries(fields)) obj[k] = fromFsVal(v);
  return obj;
}

async function fsWrite(token, path, doc) {
  const res = await fetch(`${FS_BASE}/${path}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: toFields(doc) }),
  });
  if (!res.ok) throw new Error(`PATCH ${path}: ${await res.text()}`);
}

async function fsRead(token, path) {
  const res = await fetch(`${FS_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${path}: ${await res.text()}`);
  const doc = await res.json();
  return doc.fields ? fromFields(doc.fields) : null;
}

async function fsList(token, path) {
  const res = await fetch(`${FS_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`LIST ${path}: ${await res.text()}`);
  const data = await res.json();
  return (data.documents || []).map(doc => ({ id: doc.name.split("/").pop(), ...fromFields(doc.fields || {}) }));
}

// ── Бизнес-логика: reduceDeals ────────────────────────────────────────────────

function reduceDeals(events, asOf = new Date()) {
  const sorted = [...events].sort((a, b) => {
    const d = a.ts.localeCompare(b.ts);
    return d !== 0 ? d : a.eventId.localeCompare(b.eventId);
  });

  const state = new Map();
  for (const ev of sorted) {
    const prev = state.get(ev.dealId);
    const stageChanged = prev === undefined || prev.currentStage !== ev.toStage;
    state.set(ev.dealId, {
      dealId: ev.dealId,
      funnelId: ev.funnelId,
      currentStage: ev.toStage,
      amount: ev.estimatedAmount ?? (prev?.amount ?? 0),
      probability: ev.probability,
      ownerId: ev.ownerId,
      clientId: ev.clientId ?? (prev?.clientId ?? null),
      expectedCloseDate: ev.expectedCloseDate,
      expectedPaymentDate: ev.expectedPaymentDate,
      stageEnteredAt: stageChanged ? ev.ts : (prev?.stageEnteredAt ?? ev.ts),
      updatedAt: ev.ts,
    });
  }

  const result = new Map();
  const asOfMs = asOf.getTime();
  for (const [dealId, s] of state) {
    const enteredMs = new Date(s.stageEnteredAt).getTime();
    const daysInStage = Math.max(0, Math.floor((asOfMs - enteredMs) / 86_400_000));
    result.set(dealId, { ...s, daysInStage });
    delete result.get(dealId).stageEnteredAt;
  }
  return result;
}

// ── Бизнес-логика: funnelMetrics ─────────────────────────────────────────────

function funnelMetrics(deals, funnel) {
  const stageIds = funnel.stages.map(s => s.id);
  const dealsInFunnel = [...deals.values()].filter(d => d.funnelId === funnel.funnelId);

  const stages = funnel.stages.map((stage, idx) => {
    const atStage = dealsInFunnel.filter(d => d.currentStage === stage.id);
    const enteredCount = dealsInFunnel.filter(d => stageIds.indexOf(d.currentStage) >= idx).length;
    const convertedCount = dealsInFunnel.filter(d => stageIds.indexOf(d.currentStage) > idx).length;
    const factConversion = enteredCount > 0 ? convertedCount / enteredCount : 0;
    const avgDays = atStage.length > 0 ? atStage.reduce((s, d) => s + d.daysInStage, 0) / atStage.length : 0;
    const stuck = atStage.filter(d => d.daysInStage > stage.normDays).map(d => d.dealId);
    const weightedPipeline = atStage.reduce((s, d) => s + d.amount * d.probability, 0);
    return { stageId: stage.id, stageName: stage.name, count: atStage.length, factConversion, normConversion: stage.normConversion, avgDays, normDays: stage.normDays, stuck, weightedPipeline };
  });

  return { funnelId: funnel.funnelId, stages, totalWeightedPipeline: stages.reduce((s, st) => s + st.weightedPipeline, 0) };
}

// ── Данные ────────────────────────────────────────────────────────────────────

const FUNNEL = {
  funnelId: "main",
  name: "Основная воронка",
  stages: [
    { id: "new",      name: "Новый",          normConversion: 0.8, normDays: 3  },
    { id: "qual",     name: "Квалификация",   normConversion: 0.6, normDays: 7  },
    { id: "proposal", name: "КП отправлено",  normConversion: 0.5, normDays: 14 },
    { id: "won",      name: "Закрыто",        normConversion: 1.0, normDays: 1  },
  ],
};

const OWNER = "550e8400-e29b-41d4-a716-446655440001";

function makeEvent(dealId, fromStage, toStage, ts, amount) {
  return {
    type: "deal_stage_changed",
    eventId: randomUUID(),
    ts,
    dealId,
    leadId: randomUUID(),
    fromStage,
    toStage,
    funnelId: "main",
    estimatedAmount: amount,
    probability: 0.5,
    expectedCloseDate: null,
    expectedPaymentDate: null,
    clientId: null,
    ownerId: OWNER,
    counterpartyInn: null,
    counterpartyName: "Тест-клиент",
    managerId: OWNER,
    source: "manual",
    businessId: BUSINESS_ID,
  };
}

const D1 = randomUUID(); // new → qual → proposal → won
const D2 = randomUUID(); // new → qual (застрял 10 дней, норма 7)
const D3 = randomUUID(); // new (2 дня, в норме)
const D4 = randomUUID(); // new → qual → proposal

const EVENTS = [
  makeEvent(D1, "",         "new",      "2026-06-01T09:00:00Z", 120_000_00),
  makeEvent(D1, "new",      "qual",     "2026-06-02T09:00:00Z", 120_000_00),
  makeEvent(D1, "qual",     "proposal", "2026-06-05T09:00:00Z", 120_000_00),
  makeEvent(D1, "proposal", "won",      "2026-06-10T09:00:00Z", 120_000_00),
  makeEvent(D2, "",         "new",      "2026-06-08T09:00:00Z", 80_000_00),
  makeEvent(D2, "new",      "qual",     "2026-06-10T09:00:00Z", 80_000_00),
  makeEvent(D3, "",         "new",      "2026-06-18T09:00:00Z", 50_000_00),
  makeEvent(D4, "",         "new",      "2026-06-12T09:00:00Z", 200_000_00),
  makeEvent(D4, "new",      "qual",     "2026-06-13T09:00:00Z", 200_000_00),
  makeEvent(D4, "qual",     "proposal", "2026-06-15T09:00:00Z", 200_000_00),
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== seed-deals: start ===\n");
  const sa = JSON.parse(readFileSync(SA_PATH, "utf-8"));
  const token = await getToken(sa);

  // 1. Воронка
  console.log("[1] saving funnel config…");
  await fsWrite(token, `tenants/${BUSINESS_ID}/funnels/main`, FUNNEL);
  console.log("  ✓ tenants/kamchatka/funnels/main");

  // 2. События (реальный путь через events-коллекцию)
  console.log("\n[2] writing deal_stage_changed events…");
  for (const ev of EVENTS) {
    await fsWrite(token, `tenants/${BUSINESS_ID}/events/${ev.eventId}`, ev);
    process.stdout.write("  .");
  }
  console.log(`\n  ✓ ${EVENTS.length} events → tenants/${BUSINESS_ID}/events/`);

  // 3. Читаем события обратно (реальный путь)
  console.log("\n[3] loading events from Firestore…");
  const rawEvents = await fsList(token, `tenants/${BUSINESS_ID}/events`);
  const dealEvents = rawEvents.filter(e => e.type === "deal_stage_changed");
  console.log(`  total events in collection: ${rawEvents.length}`);
  console.log(`  deal_stage_changed events:  ${dealEvents.length}`);

  // 4. Compute (reduceDeals → funnelMetrics)
  console.log("\n[4] running compute (reduceDeals + funnelMetrics)…");
  const asOf = new Date("2026-06-20T12:00:00Z");
  const deals = reduceDeals(dealEvents, asOf);
  console.log(`  reduceDeals → ${deals.size} deals`);
  const metrics = funnelMetrics(deals, FUNNEL);

  // 5. Сохраняем проекцию
  console.log("\n[5] saving projection to Firestore…");
  for (const [dealId, deal] of deals) {
    await fsWrite(token, `tenants/${BUSINESS_ID}/deals/${dealId}`, deal);
    process.stdout.write("  .");
  }
  console.log(`\n  ✓ ${deals.size} deals → tenants/${BUSINESS_ID}/deals/`);

  await fsWrite(token, `tenants/${BUSINESS_ID}/funnel_metrics/main`, metrics);
  console.log("  ✓ tenants/kamchatka/funnel_metrics/main");

  // 6. Читаем итог
  console.log("\n[6] reading back from Firestore…");
  console.log("\n  deals:");
  for (const [label, id] of [["D1 (won)", D1], ["D2 (stuck/qual)", D2], ["D3 (new)", D3], ["D4 (proposal)", D4]]) {
    const d = await fsRead(token, `tenants/${BUSINESS_ID}/deals/${id}`);
    if (d) {
      console.log(`    ${label}: currentStage=${d.currentStage} daysInStage=${d.daysInStage} amount=${d.amount}`);
    } else {
      console.log(`    ${label}: NOT FOUND`);
    }
  }

  const m = await fsRead(token, `tenants/${BUSINESS_ID}/funnel_metrics/main`);
  if (m) {
    console.log("\n  funnel_metrics/main:");
    for (const s of m.stages) {
      const stuckCount = Array.isArray(s.stuck) ? s.stuck.length : 0;
      console.log(`    ${String(s.stageId).padEnd(10)} count=${s.count} stuck=${stuckCount} avgDays=${Number(s.avgDays).toFixed(1)} factConv=${Number(s.factConversion).toFixed(2)} pipeline=${s.weightedPipeline}`);
    }
    console.log(`  totalWeightedPipeline: ${m.totalWeightedPipeline}`);
  } else {
    console.log("  funnel_metrics/main: NOT FOUND");
  }

  console.log("\n=== seed-deals: done ===");
}

main().catch(err => { console.error("FATAL:", err); process.exit(1); });
