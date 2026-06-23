/**
 * Удаляет синтетические сделки и события из тенанта kamchatka.
 * Воронку (funnels/main), бизнес-план и оценку НЕ трогает.
 *
 * Run: node tools/seed/clear-kamchatka-deals.mjs
 */

import { createSign } from "crypto";
import { readFileSync } from "fs";

const SA_PATH =
  "/Users/annagranenova/Downloads/Life_CRM/crm-living-bp-firebase-adminsdk-fbsvc-642d33bf13.json";
const PROJECT_ID = "crm-living-bp";
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const BUSINESS_ID = "kamchatka";

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
  if (!res.ok) throw new Error(`token error: ${await res.text()}`);
  return (await res.json()).access_token;
}

// ── Firestore helpers ─────────────────────────────────────────────────────────

async function fsList(token, collPath) {
  const url = `${FS_BASE}/${collPath}?pageSize=200&fields=documents.name`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`LIST ${collPath}: ${await res.text()}`);
  const data = await res.json();
  if (!data.documents) return [];
  return data.documents.map((d) => d.name.split("/").pop());
}

async function fsDelete(token, docPath) {
  const url = `${FS_BASE}/${docPath}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`DELETE ${docPath}: ${await res.text()}`);
}

async function clearCollection(token, collPath) {
  const ids = await fsList(token, collPath);
  for (const id of ids) {
    await fsDelete(token, `${collPath}/${id}`);
  }
  return ids.length;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== clear-kamchatka-deals ===\n");

  const sa = JSON.parse(readFileSync(SA_PATH, "utf-8"));
  const token = await getToken(sa);

  const collections = [
    `tenants/${BUSINESS_ID}/deals`,
    `tenants/${BUSINESS_ID}/events`,
    `tenants/${BUSINESS_ID}/funnel_metrics`,
  ];

  for (const col of collections) {
    const n = await clearCollection(token, col);
    console.log(`  ✓ удалено ${n} docs из ${col}`);
  }

  console.log("\n✅ Готово. tenants/kamchatka очищен от синтетики.");
  console.log("   Сохранены: funnels/, business_plans/, plan_intakes/");
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
