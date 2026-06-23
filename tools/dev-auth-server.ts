/**
 * Локальный dev-сервер, имитирующий crm-auth Cloudflare Worker.
 * Читает FIREBASE_SERVICE_ACCOUNT_JSON из файла SA,
 * проверяет secretHash в Firestore, выдаёт Firebase Custom Token.
 *
 * Run: node -r .../tsx/dist/cjs/index.cjs tools/dev-auth-server.ts
 */

import http from "http";
import crypto from "crypto";
import { readFileSync } from "fs";

// SA JSON path — задаётся через env-переменную, чтобы не хранить абсолютный путь в коде
// export FIREBASE_SA_PATH=/path/to/crm-living-bp-XXXXXXXX.json
const SA_PATH = process.env.FIREBASE_SA_PATH ?? "";
const PORT = 8788;

const sa = JSON.parse(readFileSync(SA_PATH, "utf-8")) as {
  project_id: string;
  client_email: string;
  private_key: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────

function sha256hex(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function b64urlStr(s: string): string {
  return b64url(Buffer.from(s));
}

function signRS256(input: string): string {
  const sign = crypto.createSign("RSA-SHA256");
  sign.update(input);
  return b64url(sign.sign(sa.private_key));
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64urlStr(JSON.stringify(payload));
  const sig = signRS256(`${header}.${body}`);
  return `${header}.${body}.${sig}`;
}

async function getFirestoreToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = makeJwt({
    iss: sa.client_email,
    sub: sa.client_email,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
    scope: "https://www.googleapis.com/auth/datastore",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function getTenantSecretHash(businessId: string): Promise<string | null> {
  const token = await getFirestoreToken();
  const url = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/tenants/${encodeURIComponent(businessId)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  const doc = (await res.json()) as {
    fields?: { secretHash?: { stringValue?: string } };
  };
  return doc.fields?.secretHash?.stringValue ?? null;
}

function createCustomToken(businessId: string): string {
  const now = Math.floor(Date.now() / 1000);
  return makeJwt({
    iss: sa.client_email,
    sub: sa.client_email,
    aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
    iat: now,
    exp: now + 3600,
    uid: businessId,
    claims: { businessId },
  });
}

// ── HTTP сервер ───────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (req.method !== "POST" || req.url !== "/token") {
    res.writeHead(404, CORS);
    res.end(JSON.stringify({ error: "Not Found" }));
    return;
  }

  let body = "";
  for await (const chunk of req) body += chunk;

  let parsed: { businessId?: string; secret?: string };
  try {
    parsed = JSON.parse(body) as { businessId?: string; secret?: string };
  } catch {
    res.writeHead(400, CORS);
    res.end(JSON.stringify({ error: "Bad Request" }));
    return;
  }

  const { businessId, secret } = parsed;
  if (!businessId || !secret) {
    res.writeHead(400, CORS);
    res.end(JSON.stringify({ error: "Bad Request" }));
    return;
  }

  try {
    const storedHash = await getTenantSecretHash(businessId);
    if (!storedHash) {
      res.writeHead(401, CORS);
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const incoming = sha256hex(secret);
    if (incoming !== storedHash) {
      res.writeHead(401, CORS);
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }

    const token = createCustomToken(businessId);
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ token }));
    console.log(`[auth] ✓ ${businessId}`);
  } catch (e) {
    console.error("[auth] error:", e);
    res.writeHead(500, CORS);
    res.end(JSON.stringify({ error: "Internal Server Error" }));
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`dev-auth-server running at http://localhost:${PORT}`);
  console.log(`  POST /token  { businessId, secret } → { token }`);
});
