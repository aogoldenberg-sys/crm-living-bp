// POST /auth/register-profile
// Reads uid from verified Firebase ID token, creates users/{uid} and
// tenants/{businessId}/_meta/entitlements. Idempotent: returns existing if present.

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

// ── OAuth2 token for Firestore ────────────────────────────────────────────────

function b64u(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
const b64uStr = (s: string): string => b64u(new TextEncoder().encode(s).buffer as ArrayBuffer);

async function getOAuthToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const h = b64uStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const p = b64uStr(JSON.stringify({
    iss: sa.client_email, sub: sa.client_email,
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
    scope: "https://www.googleapis.com/auth/datastore",
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const keyBytes = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", keyBytes.buffer as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${h}.${p}`));
  const jwt = `${h}.${p}.${b64u(sig)}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const { access_token } = (await res.json()) as { access_token: string };
  return access_token;
}

// ── Firebase ID token verification ───────────────────────────────────────────

/** Verifies Firebase ID token via Google JWK. Returns uid. Exported for testing. */
export async function verifyFirebaseIdToken(token: string, projectId: string): Promise<string> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid JWT");
  const [h64, p64, sig64] = parts as [string, string, string];
  const dec = (s: string) =>
    JSON.parse(atob(s.replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>;
  const header = dec(h64) as { kid: string };
  const payload = dec(p64) as { iss: string; aud: string; sub: string; exp: number };

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) throw new Error("Token expired");
  if (payload.aud !== projectId) throw new Error("Invalid aud");
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error("Invalid iss");

  const { keys } = (await (await fetch(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  )).json()) as { keys: Array<{ kid: string } & JsonWebKey> };
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("Unknown kid");

  const cryptoKey = await crypto.subtle.importKey(
    "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
  );
  const sigBytes = Uint8Array.from(
    atob(sig64.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0),
  );
  if (!await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", cryptoKey, sigBytes, new TextEncoder().encode(`${h64}.${p64}`),
  )) throw new Error("Invalid signature");

  return payload.sub;
}

// ── Firestore REST helpers ────────────────────────────────────────────────────

type FsFields = Record<string, { stringValue?: string; booleanValue?: boolean; nullValue?: string }>;
type FsDoc = { fields?: FsFields };

async function fsGet(token: string, projectId: string, path: string): Promise<FsDoc | null> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore GET ${path} failed (${res.status})`);
  return res.json() as Promise<FsDoc>;
}

async function fsPatch(token: string, projectId: string, path: string, fields: FsFields): Promise<void> {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Firestore PATCH ${path} failed (${res.status})`);
}

// ── Pure helpers (exported for unit tests) ───────────────────────────────────

/** Returns businessId from existing users/{uid} doc, or null if absent/missing field. */
export function extractBusinessId(doc: FsDoc | null): string | null {
  return doc?.fields?.businessId?.stringValue ?? null;
}

// ── CORS ──────────────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

// ── Handler ───────────────────────────────────────────────────────────────────

export async function handleRegisterProfile(
  request: Request,
  env: { FIREBASE_SERVICE_ACCOUNT_JSON: string },
): Promise<Response> {
  const idToken = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!idToken) return json({ error: "Unauthorized" }, 401);

  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) as ServiceAccount;
  const projectId = sa.project_id;

  let uid: string;
  try {
    uid = await verifyFirebaseIdToken(idToken, projectId);
  } catch {
    return json({ error: "Unauthorized" }, 401);
  }

  const fsToken = await getOAuthToken(sa);

  // Idempotent: return existing businessId without writing
  const existing = await fsGet(fsToken, projectId, `users/${uid}`);
  const existingBid = extractBusinessId(existing);
  if (existingBid) return json({ businessId: existingBid, created: false });

  // First call: assign server-generated businessId
  const businessId = crypto.randomUUID();
  const now = new Date().toISOString();

  // Email/name from already-verified token payload (safe to decode without re-verification)
  const [, p64] = idToken.split(".");
  const tp = JSON.parse(
    atob((p64 ?? "").replace(/-/g, "+").replace(/_/g, "/")),
  ) as { email?: string; name?: string };

  await fsPatch(fsToken, projectId, `users/${uid}`, {
    uid: { stringValue: uid },
    email: { stringValue: tp.email ?? "" },
    createdAt: { stringValue: now },
    businessId: { stringValue: businessId },
    emailVerified: { booleanValue: false },
    displayName: tp.name ? { stringValue: tp.name } : { nullValue: "NULL_VALUE" },
  });

  await fsPatch(fsToken, projectId, `tenants/${businessId}/_meta/entitlements`, {
    businessId: { stringValue: businessId },
    plan: { stringValue: "free" },
    paidUntil: { nullValue: "NULL_VALUE" },
    freeComplianceUsed: { booleanValue: false },
    freeReportUsed: { booleanValue: false },
    updatedAt: { stringValue: now },
    tier: { stringValue: "free" },
    trialEndsAt: { nullValue: "NULL_VALUE" },
    internal: { booleanValue: false },
  });

  return json({ businessId, created: true });
}
