/**
 * COMMIT 2 runner — настоящий intake Kamchatka через Claude.
 *
 * Использует официальный пайплайн:
 *   extractPlan (ai-kit, Zod-validated) →
 *   mapToSections + gateIntake (core) →
 *   assessPlan (ai-kit, Zod-validated) →
 *   PlanIntake.parse() →
 *   Firestore (новый документ, hand-seed не трогает)
 *
 * После записи печатает DIFF vs hand-seed по гипотезам и assessment.
 *
 * Run:
 *   ANTHROPIC_API_KEY=<key> node --loader ts-node/esm tools/seed/run_intake_kamchatka.ts
 *
 * Или через tsx (если установлен):
 *   ANTHROPIC_API_KEY=<key> npx tsx tools/seed/run_intake_kamchatka.ts
 */

import { readFileSync } from "fs";
import { createSign } from "crypto";
import { randomUUID } from "crypto";

// ── Imports from monorepo packages ────────────────────────────────────────────
// Note: using deep imports to avoid build step
import { createAnthropicClient, extractPlan, assessPlan } from "../../packages/ai-kit/src/index.js";
import { mapToSections, gateIntake } from "../../packages/core/src/intake/index.js";
import { PlanIntake, AssumptionSet } from "../../packages/schemas/src/index.js";

// ── Config ────────────────────────────────────────────────────────────────────

const SA_PATH =
  "/Users/annagranenova/Downloads/Life_CRM/crm-living-bp-firebase-adminsdk-fbsvc-642d33bf13.json";
const DOC_PATH =
  "/Users/annagranenova/Downloads/🗻 Камчатка/КАМЧАТКА_Полный_план_проекта.md";
const PROJECT_ID = "crm-living-bp";
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const BUSINESS_ID = "kamchatka";

// Hand-seed intakeId to compare against (do NOT delete)
const HAND_SEED_INTAKE_ID = "19b5b1a1-ad39-4b11-9b99-5eb428c31031";

// ── Firestore REST helpers ────────────────────────────────────────────────────

interface SA {
  client_email: string;
  private_key: string;
}

function b64url(s: Buffer | string): string {
  const buf = typeof s === "string" ? Buffer.from(s) : s;
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function makeJwt(sa: SA): string {
  const now = Math.floor(Date.now() / 1000);
  const hdr = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const pld = b64url(
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
  sign.update(`${hdr}.${pld}`);
  return `${hdr}.${pld}.${b64url(sign.sign(sa.private_key))}`;
}

async function getToken(sa: SA): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: makeJwt(sa),
    }),
  });
  const data = (await res.json()) as { access_token: string };
  if (!data.access_token) throw new Error("Token failed: " + JSON.stringify(data));
  return data.access_token;
}

type FsVal =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { mapValue: { fields: Record<string, FsVal> } }
  | { arrayValue: { values: FsVal[] } };

function toFs(v: unknown): FsVal {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFs) } };
  if (typeof v === "object") {
    const f: Record<string, FsVal> = {};
    for (const [k, vv] of Object.entries(v as Record<string, unknown>)) f[k] = toFs(vv);
    return { mapValue: { fields: f } };
  }
  return { stringValue: String(v) };
}

function objToFs(obj: Record<string, unknown>): Record<string, FsVal> {
  const f: Record<string, FsVal> = {};
  for (const [k, v] of Object.entries(obj)) f[k] = toFs(v);
  return f;
}

async function fsWrite(token: string, path: string, doc: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${FS_BASE}/${path}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: objToFs(doc) }),
  });
  if (!res.ok) throw new Error(`PATCH ${path}: ${await res.text()}`);
  console.log(`  ✓ wrote ${path}`);
}

async function fsReadFields(token: string, path: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${FS_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) return null;
  const data = (await res.json()) as { fields?: Record<string, unknown> };
  return data.fields ?? null;
}

// ── Diff helpers ──────────────────────────────────────────────────────────────

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "object" && "point" in (v as Record<string, unknown>))
    return String((v as { point: unknown }).point);
  if (
    typeof v === "object" &&
    "lo" in (v as Record<string, unknown>) &&
    "hi" in (v as Record<string, unknown>)
  ) {
    const r = v as { lo: unknown; hi: unknown };
    return `${r.lo}–${r.hi}`;
  }
  return JSON.stringify(v);
}

function printDiff(
  handAssumptions: Record<string, unknown>,
  aiAssumptions: Record<string, unknown>,
): void {
  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log("DIFF: AI-extraction vs Hand-seed (по гипотезам)");
  console.log("══════════════════════════════════════════════════════════════════");

  const allKeys = new Set([...Object.keys(handAssumptions), ...Object.keys(aiAssumptions)]);

  const rows: string[] = [];
  let matches = 0;
  let diffs = 0;
  let aiOnly = 0;
  let handOnly = 0;

  for (const key of [...allKeys].sort()) {
    const hand = handAssumptions[key] as Record<string, unknown> | undefined;
    const ai = aiAssumptions[key] as Record<string, unknown> | undefined;

    if (!hand) {
      rows.push(`  [AI only]  ${key}: ${fmtValue(ai?.value)} ${ai?.unit ?? ""}`);
      aiOnly++;
    } else if (!ai) {
      rows.push(`  [hand only] ${key}: ${fmtValue(hand.value)} ${hand.unit ?? ""}`);
      handOnly++;
    } else {
      const handVal = fmtValue(hand.value);
      const aiVal = fmtValue(ai.value);
      const match = handVal === aiVal;
      if (match) {
        rows.push(`  ✓ ${key}: ${handVal} ${hand.unit ?? ""}`);
        matches++;
      } else {
        rows.push(`  ≠ ${key}: hand=${handVal} vs ai=${aiVal} ${hand.unit ?? ""}`);
        diffs++;
      }
    }
  }

  console.log(rows.join("\n"));
  console.log(
    `\nИтог: ${matches} совпадений / ${diffs} расхождений / ${aiOnly} только у AI / ${handOnly} только у hand`,
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required");

  // 0. Setup
  console.log("Reading service account...");
  const sa = JSON.parse(readFileSync(SA_PATH, "utf-8")) as SA;
  const token = await getToken(sa);
  console.log("  Firestore token OK");

  console.log("Reading Kamchatka document...");
  const docText = readFileSync(DOC_PATH, "utf-8");
  console.log(`  ${docText.length} chars`);

  // 1. extractPlan via Claude — Zod-validated
  console.log("\n1. extractPlan (Claude → ExtractedPlanSchema.parse)...");
  const client = createAnthropicClient(apiKey);
  const extractResult = await extractPlan(client, BUSINESS_ID, docText);
  if (!extractResult.ok) {
    throw new Error(`extractPlan failed: ${extractResult.error.message}`);
  }
  const extracted = extractResult.value;
  console.log(`  rawSections: ${Object.keys(extracted.rawSections).length}`);
  console.log(`  assumptions: ${Object.keys(extracted.assumptions).length}`);

  // Validate assumptions through Zod (belt-and-suspenders)
  const assumptionCheck = AssumptionSet.safeParse(extracted.assumptions);
  if (!assumptionCheck.success) {
    throw new Error(`AssumptionSet validation failed: ${assumptionCheck.error.message}`);
  }
  console.log(`  AssumptionSet.parse() ✓`);

  // 2. mapToSections + gateIntake — confidence computed by pipeline logic
  console.log("\n2. mapToSections + gateIntake...");
  const { sections, gaps } = mapToSections(extracted);
  const presentCount = sections.filter((s) => s.present).length;
  console.log(`  sections present: ${presentCount}/22`);
  console.log(`  gaps: ${gaps.length}`);

  const gate = gateIntake(sections, BUSINESS_ID);
  console.log(`  confidence: ${gate.confidence.toFixed(3)} (by gate logic, not hardcoded)`);
  console.log(`  verdict: ${gate.verdict}`);
  console.log(`  disclaimer: ${gate.disclaimer.slice(0, 60)}...`);

  // 3. assessPlan via Claude — Zod-validated
  console.log("\n3. assessPlan (Claude → AssessmentOutputSchema.parse)...");
  const assessResult = await assessPlan(client, extracted);
  if (!assessResult.ok) {
    throw new Error(`assessPlan failed: ${assessResult.error.message}`);
  }
  const assessment = assessResult.value;
  console.log(`  strengths: ${assessment.strengths.length}`);
  console.log(`  concerns: ${assessment.concerns.length}`);
  console.log(`  verifiability: ${assessment.verifiability.length}`);

  // 4. Assemble PlanIntake and validate through Zod
  console.log("\n4. Assembling PlanIntake and validating...");
  const intakeId = randomUUID();
  const now = new Date().toISOString();

  const planIntakeRaw = {
    intakeId,
    businessId: BUSINESS_ID,
    extractedAt: now,
    mappedSections: sections,
    assessment: {
      strengths: assessment.strengths,
      concerns: assessment.concerns,
      gaps,
      assumptionsExtracted: extracted.assumptions,
      verifiability: assessment.verifiability,
    },
    confidence: gate.confidence,
    disclaimer: gate.disclaimer,
    status: "draft" as const,
  };

  const planIntake = PlanIntake.parse(planIntakeRaw);
  console.log(`  PlanIntake.parse() ✓`);
  console.log(`  intakeId: ${intakeId}`);

  // 5. Write to Firestore — NEW document alongside hand-seed
  console.log("\n5. Writing to Firestore (hand-seed preserved)...");
  await fsWrite(token, `tenants/kamchatka/plan_intakes/${intakeId}`, planIntake);

  // 6. Read hand-seed and print diff
  console.log("\n6. Reading hand-seed for diff...");
  const handFields = await fsReadFields(
    token,
    `tenants/kamchatka/plan_intakes/${HAND_SEED_INTAKE_ID}`,
  );

  if (handFields) {
    // Extract assumptions from Firestore mapValue structure
    const getMapFields = (f: Record<string, unknown>): Record<string, unknown> => {
      const mv = f as { mapValue?: { fields?: Record<string, unknown> } };
      return mv.mapValue?.fields ?? {};
    };
    const assessF = getMapFields(
      (handFields.assessment as Record<string, unknown>) ?? {},
    );
    const handAssumptionsRaw = getMapFields(
      (assessF.assumptionsExtracted as Record<string, unknown>) ?? {},
    );

    // Convert Firestore mapValue to plain objects for diff
    function fromFs(v: unknown): unknown {
      if (!v || typeof v !== "object") return v;
      const fv = v as Record<string, unknown>;
      if ("stringValue" in fv) return fv.stringValue;
      if ("integerValue" in fv) return Number(fv.integerValue);
      if ("doubleValue" in fv) return fv.doubleValue;
      if ("booleanValue" in fv) return fv.booleanValue;
      if ("nullValue" in fv) return null;
      if ("arrayValue" in fv) {
        const av = fv.arrayValue as { values?: unknown[] };
        return (av.values ?? []).map(fromFs);
      }
      if ("mapValue" in fv) {
        const mv = fv.mapValue as { fields?: Record<string, unknown> };
        const out: Record<string, unknown> = {};
        for (const [k, vv] of Object.entries(mv.fields ?? {})) out[k] = fromFs(vv);
        return out;
      }
      return v;
    }

    const handAssumptions: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(handAssumptionsRaw)) {
      handAssumptions[k] = fromFs(v);
    }

    printDiff(handAssumptions, extracted.assumptions as Record<string, unknown>);
  } else {
    console.log("  Hand-seed not found, skipping diff");
  }

  console.log("\n══════════════════════════════════════════════════════════════════");
  console.log("COMMIT 3 COMPLETE — настоящий intake записан:");
  console.log(`  intakeId (AI):   ${intakeId}`);
  console.log(`  intakeId (hand): ${HAND_SEED_INTAKE_ID}`);
  console.log(`  confidence:      ${gate.confidence.toFixed(3)} (вычислен gateIntake, не захардкожен)`);
  console.log(`  verdict:         ${gate.verdict}`);
  console.log("══════════════════════════════════════════════════════════════════");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
