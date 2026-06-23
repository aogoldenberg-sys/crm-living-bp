/**
 * Очищает синтетические сделки и события из тенанта kamchatka.
 * Воронку (funnels/main) и бизнес-план НЕ трогает.
 *
 * Run: node_modules/.bin/tsx tools/seed/clear-kamchatka-deals.ts
 */

import { readFileSync } from "fs";
import { createFirestoreClientFromJson } from "../../packages/firestore-adapter/src/client.js";

const SA_PATH =
  "/Users/annagranenova/Downloads/Life_CRM/crm-living-bp-firebase-adminsdk-fbsvc-642d33bf13.json";
const BUSINESS_ID = "kamchatka";

async function deleteCollection(
  db: FirebaseFirestore.Firestore,
  path: string,
): Promise<number> {
  const snap = await db.collection(path).limit(200).get();
  if (snap.empty) return 0;
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  // Рекурсивно если было 200 (маловероятно для dev)
  return snap.size + (snap.size === 200 ? await deleteCollection(db, path) : 0);
}

async function main() {
  console.log("=== clear-kamchatka-deals ===\n");

  const saJson = readFileSync(SA_PATH, "utf-8");
  const db = createFirestoreClientFromJson(saJson);

  const collections = [
    `tenants/${BUSINESS_ID}/deals`,
    `tenants/${BUSINESS_ID}/events`,
    `tenants/${BUSINESS_ID}/funnel_metrics`,
  ];

  for (const col of collections) {
    const n = await deleteCollection(db, col);
    console.log(`  ✓ deleted ${n} docs from ${col}`);
  }

  console.log("\n✅ Done. tenants/kamchatka теперь чист от синтетики.");
  console.log("   Воронка (funnels/main), план и оценка — сохранены.");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
