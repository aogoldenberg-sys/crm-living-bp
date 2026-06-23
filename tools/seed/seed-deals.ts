/**
 * Seed-прогон слайса 3: воронка (с terminal) + deal-события → compute → читаем Firestore.
 *
 * Импортирует @crm/core — НЕ дублирует логику.
 * Run: node_modules/.bin/tsx tools/seed/seed-deals.ts
 */

import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { createFirestoreClientFromJson } from "../../packages/firestore-adapter/src/client.js";
import {
  registerTenant,
  saveEvents,
  saveFunnel,
  loadDealEvents,
  loadFunnels,
  saveDealsProjection,
  saveFunnelMetrics,
} from "../../packages/firestore-adapter/src/index.js";
import { reduceDeals, funnelMetrics } from "../../packages/core/src/index.js";
import type { BusinessEvent, Funnel } from "../../packages/schemas/src/index.js";

const SA_PATH =
  "/Users/annagranenova/Downloads/Life_CRM/crm-living-bp-firebase-adminsdk-fbsvc-642d33bf13.json";
// ВАЖНО: демо-данные пишутся ТОЛЬКО под тенант "demo".
// Реальные тенанты (kamchatka и др.) синтетику не получают.
const BUSINESS_ID = "demo";

// ── Воронка (с terminal=true для won) ────────────────────────────────────────

const FUNNEL: Funnel = {
  funnelId: "main",
  name: "Основная воронка",
  stages: [
    { id: "new",      name: "Новый",          normConversion: 0.8, normDays: 3,  terminal: false },
    { id: "qual",     name: "Квалификация",   normConversion: 0.6, normDays: 7,  terminal: false },
    { id: "proposal", name: "КП отправлено",  normConversion: 0.5, normDays: 14, terminal: false },
    { id: "won",      name: "Закрыто",        normConversion: 1.0, normDays: 1,  terminal: true  },
  ],
};

const OWNER = "550e8400-e29b-41d4-a716-446655440001";

function makeEvent(
  dealId: string, fromStage: string, toStage: string, ts: string, amount: number,
): BusinessEvent {
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
  } as BusinessEvent;
}

const D1 = randomUUID(); // new → qual → proposal → won
const D2 = randomUUID(); // new → qual (застрял 10+ дней, норма 7)
const D3 = randomUUID(); // new (2 дня — в норме)
const D4 = randomUUID(); // new → qual → proposal

const EVENTS: BusinessEvent[] = [
  makeEvent(D1, "",         "new",      "2026-06-01T09:00:00Z", 120_000_00),
  makeEvent(D1, "new",      "qual",     "2026-06-02T09:00:00Z", 120_000_00),
  makeEvent(D1, "qual",     "proposal", "2026-06-05T09:00:00Z", 120_000_00),
  makeEvent(D1, "proposal", "won",      "2026-06-10T09:00:00Z", 120_000_00),
  makeEvent(D2, "",         "new",      "2026-06-08T09:00:00Z",  80_000_00),
  makeEvent(D2, "new",      "qual",     "2026-06-10T09:00:00Z",  80_000_00),
  makeEvent(D3, "",         "new",      "2026-06-19T09:00:00Z",  50_000_00),
  makeEvent(D4, "",         "new",      "2026-06-12T09:00:00Z", 200_000_00),
  makeEvent(D4, "new",      "qual",     "2026-06-13T09:00:00Z", 200_000_00),
  makeEvent(D4, "qual",     "proposal", "2026-06-15T09:00:00Z", 200_000_00),
];

async function main() {
  console.log("=== seed-deals (слайс 3) ===\n");

  const saJson = readFileSync(SA_PATH, "utf-8");
  const db = createFirestoreClientFromJson(saJson);

  // 1. Тенант
  await registerTenant(db, BUSINESS_ID);

  // 2. Воронка с terminal=true для won
  console.log("[1] saving funnel (won: terminal=true)…");
  const fRes = await saveFunnel(db, BUSINESS_ID, FUNNEL);
  if (!fRes.ok) throw new Error(`saveFunnel: ${JSON.stringify(fRes.error)}`);
  console.log("  ✓ tenants/kamchatka/funnels/main");

  // 3. События через saveEvents (реальный путь — те же что идут через ingest)
  console.log("[2] writing events via saveEvents (same path as ingest)…");
  const eRes = await saveEvents(db, BUSINESS_ID, EVENTS);
  if (!eRes.ok) throw new Error(`saveEvents: ${JSON.stringify(eRes.error)}`);
  console.log(`  ✓ ${EVENTS.length} events → tenants/${BUSINESS_ID}/events/`);

  // 4. Загружаем события через loadDealEvents (как это делает compute worker)
  console.log("[3] loadDealEvents (как compute worker)…");
  const loadRes = await loadDealEvents(db, BUSINESS_ID);
  if (!loadRes.ok) throw new Error(`loadDealEvents: ${JSON.stringify(loadRes.error)}`);
  const { events: dealEvents, skipped } = loadRes.value;
  console.log(`  loaded ${dealEvents.length} deal events (skipped: ${skipped})`);

  // 5. reduceDeals из @crm/core — НЕ копия, настоящий код
  console.log("[4] reduceDeals (@crm/core)…");
  const deals = reduceDeals(dealEvents);
  console.log(`  → ${deals.size} deals`);

  // 6. Воронки
  const funnelsRes = await loadFunnels(db, BUSINESS_ID);
  if (!funnelsRes.ok) throw new Error(`loadFunnels: ${JSON.stringify(funnelsRes.error)}`);
  const funnels = funnelsRes.value;
  console.log(`  loaded ${funnels.length} funnel(s)`);

  // 7. funnelMetrics из @crm/core
  console.log("[5] funnelMetrics (@crm/core) + save…");
  for (const funnel of funnels) {
    const metrics = funnelMetrics(deals, funnel);
    await saveDealsProjection(db, BUSINESS_ID, deals);
    const mRes = await saveFunnelMetrics(db, BUSINESS_ID, funnel.funnelId, metrics);
    if (!mRes.ok) throw new Error(`saveFunnelMetrics: ${JSON.stringify(mRes.error)}`);

    console.log(`\n  funnel=${funnel.funnelId} stages:`);
    for (const s of metrics.stages) {
      const stuckFlag = s.stuck.length > 0 ? " ⚠ STUCK" : "";
      const termFlag  = s.terminal ? " [terminal]" : "";
      console.log(
        `    ${s.stageId.padEnd(10)} count=${s.count} stuck=${s.stuck.length}${stuckFlag}${termFlag}` +
        ` factConv=${(s.factConversion * 100).toFixed(0)}% avgDays=${s.avgDays.toFixed(1)}`,
      );
    }
    console.log(`  totalWeightedPipeline: ${metrics.totalWeightedPipeline} коп`);
  }

  // 8. Проверяем Firestore напрямую
  console.log("\n[6] reading back from Firestore…");
  for (const [label, id] of [
    ["D1 (won)",      D1],
    ["D2 (qual stuck)", D2],
    ["D3 (new)",      D3],
    ["D4 (proposal)", D4],
  ] as const) {
    const snap = await db.collection(`tenants/${BUSINESS_ID}/deals`).doc(id).get();
    if (snap.exists) {
      const d = snap.data() as Record<string, unknown>;
      console.log(
        `  ${label}: currentStage=${d["currentStage"]} daysInStage=${d["daysInStage"]}`,
      );
    } else {
      console.log(`  ${label}: NOT FOUND`);
    }
  }

  const mSnap = await db.collection(`tenants/${BUSINESS_ID}/funnel_metrics`).doc("main").get();
  if (mSnap.exists) {
    const m = mSnap.data() as { stages: Array<{ stageId: string; stuck: unknown[]; terminal: boolean }> };
    console.log("\n  funnel_metrics/main.stages:");
    for (const s of m.stages) {
      console.log(`    ${s.stageId}: stuck=${s.stuck.length} terminal=${s.terminal}`);
    }
  }

  console.log("\n=== done ===");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
