// POST /token
// Body: { secret: string, businessId: string }
// Ответ 200: { token: string }  — Firebase Custom Token (RS256 JWT)
//
// Env vars (wrangler secret put):
//   FIREBASE_SERVICE_ACCOUNT_JSON  — сервисный аккаунт Firebase (содержит project_id)
//
// AUTH_SECRET удалён — у каждого тенанта свой секрет.
// Хэш (SHA-256) хранится в Firestore tenants/{businessId}.secretHash.
// Валидация: SHA-256(входящий_секрет) === storedHash для конкретного businessId.
// Чужой секрет → 401, даже если businessId существует.

export interface Env {
  FIREBASE_SERVICE_ACCOUNT_JSON: string;
  YANDEX_CLIENT_ID: string;
  YANDEX_CLIENT_SECRET: string;
}

// ──────────────────────────────────────────
// CORS helpers
// ──────────────────────────────────────────
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function corsJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ──────────────────────────────────────────
// Crypto helpers (exported for unit tests)
// ──────────────────────────────────────────

/** SHA-256 hex-дайджест. Работает в Workers и Node.js 18+. */
export async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Timing-safe сравнение: SHA-256(secret) против storedHash.
 * Возвращает true только если оба не пусты и совпадают.
 *
 * Экспортируется для unit-тестов (нет сетевых вызовов).
 */
export async function secretMatchesHash(
  secret: string,
  storedHash: string,
): Promise<boolean> {
  if (!secret || !storedHash) return false;
  const incoming = await sha256hex(secret);
  // Timing-safe compare через Web Crypto HMAC trick — оба строки одинаковой длины (hex)
  const enc = new TextEncoder();
  const a = enc.encode(incoming);
  const b = enc.encode(storedHash);
  if (a.length !== b.length) return false; // оба hex — не должны различаться
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return d === 0;
}

// ──────────────────────────────────────────
// Firestore REST: получить хэш тенанта
// ──────────────────────────────────────────

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function b64urlStr(s: string): string {
  return b64url(new TextEncoder().encode(s).buffer as ArrayBuffer);
}

async function getFirestoreToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64urlStr(
    JSON.stringify({
      iss: sa.client_email,
      sub: sa.client_email,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
      scope: "https://www.googleapis.com/auth/datastore",
    }),
  );
  const input = `${header}.${payload}`;
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const keyBytes = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes.buffer as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  const jwt = `${input}.${b64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  if (!res.ok) throw new Error(`OAuth2 failed (${res.status})`);
  const { access_token } = (await res.json()) as { access_token: string };
  return access_token;
}

/** Возвращает secretHash из tenants/{businessId} или null если тенант не найден. */
async function getTenantSecretHash(
  sa: ServiceAccount,
  businessId: string,
): Promise<string | null> {
  const token = await getFirestoreToken(sa);
  const url = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents/tenants/${encodeURIComponent(businessId)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore GET tenants/${businessId} failed (${res.status})`);
  const doc = (await res.json()) as {
    fields?: { secretHash?: { stringValue?: string } };
  };
  return doc.fields?.secretHash?.stringValue ?? null;
}

// ──────────────────────────────────────────
// Firebase Custom Token
// ──────────────────────────────────────────

async function createCustomToken(sa: ServiceAccount, businessId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    (() => {
      const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
      const bin = atob(pem);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes.buffer as ArrayBuffer;
    })(),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const now = Math.floor(Date.now() / 1000);
  const header = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64urlStr(
    JSON.stringify({
      iss: sa.client_email,
      sub: sa.client_email,
      aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
      iat: now,
      exp: now + 3600,
      uid: businessId,
      claims: { businessId },
    }),
  );
  const input = `${header}.${payload}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  return `${input}.${b64url(sig)}`;
}

// ──────────────────────────────────────────
// Yandex OAuth routes
// ──────────────────────────────────────────

// GET /auth/yandex — редирект на Яндекс для получения code
function handleYandexRedirect(env: Env, redirectUri: string): Response {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.YANDEX_CLIENT_ID,
    redirect_uri: redirectUri,
  });
  return Response.redirect(`https://oauth.yandex.ru/authorize?${params}`, 302);
}

// GET /auth/yandex/callback — обмен code → Yandex token → профиль → Firebase Custom Token
async function handleYandexCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const redirectUri = "https://crm-auth.aogoldenberg.workers.dev/auth/yandex/callback";

  if (!code) {
    return new Response("Yandex OAuth: code отсутствует", { status: 400 });
  }

  // 1. Обменять code на Yandex OAuth token
  const tokenRes = await fetch("https://oauth.yandex.ru/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: env.YANDEX_CLIENT_ID,
      client_secret: env.YANDEX_CLIENT_SECRET,
      redirect_uri: redirectUri,
    }).toString(),
  });
  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error("Yandex token exchange failed:", err);
    return new Response("Ошибка получения токена Яндекс", { status: 502 });
  }
  const { access_token: yandexToken } = (await tokenRes.json()) as { access_token: string };

  // 2. Получить профиль пользователя из Яндекс ID
  const profileRes = await fetch("https://login.yandex.ru/info?format=json", {
    headers: { Authorization: `OAuth ${yandexToken}` },
  });
  if (!profileRes.ok) {
    return new Response("Ошибка получения профиля Яндекс", { status: 502 });
  }
  const profile = (await profileRes.json()) as {
    id: string;
    login: string;
    default_email?: string;
    real_name?: string;
  };

  // 3. uid для Firebase — yandex:{id} (namespace чтобы не конфликтовать с Google/email)
  const uid = `yandex:${profile.id}`;
  const businessId = uid; // первый вход — businessId = uid, может быть заменён позже

  // 4. Создать Firebase Custom Token
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) as ServiceAccount;
  let customToken: string;
  try {
    customToken = await createCustomToken(sa, uid);
  } catch (e) {
    console.error("createCustomToken failed:", e);
    return new Response("Ошибка создания токена Firebase", { status: 500 });
  }

  // 5. Редирект во фронтенд с customToken в URL-фрагменте (#)
  // Фронт читает fragment, вызывает signInWithCustomToken и очищает URL.
  // РЕШЕНИЕ: fragment не попадает в сервер-логи — безопаснее query param.
  const appUrl = new URL("https://opentgp.ru/crm_life/");
  appUrl.hash = `yandex_token=${encodeURIComponent(customToken)}&businessId=${encodeURIComponent(businessId)}`;
  return Response.redirect(appUrl.toString(), 302);
}

// ──────────────────────────────────────────
// Main handler
// ──────────────────────────────────────────
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // Yandex OAuth
    if (url.pathname === "/auth/yandex" && request.method === "GET") {
      const redirectUri = url.searchParams.get("redirect_uri") ?? "";
      return handleYandexRedirect(env, redirectUri);
    }
    if (url.pathname === "/auth/yandex/callback" && request.method === "GET") {
      return handleYandexCallback(request, env);
    }

    if (request.method !== "POST" || url.pathname !== "/token") {
      return corsJson({ error: "Not Found" }, 404);
    }

    let body: { secret?: string; businessId?: string };
    try {
      body = await request.json();
    } catch {
      return corsJson({ error: "Bad Request" }, 400);
    }

    const { secret, businessId } = body;
    if (!secret || !businessId || typeof secret !== "string" || typeof businessId !== "string") {
      return corsJson({ error: "Bad Request" }, 400);
    }

    const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON) as ServiceAccount;

    // Шаг 1: получить хэш из Firestore для этого конкретного тенанта
    let storedHash: string | null;
    try {
      storedHash = await getTenantSecretHash(sa, businessId);
    } catch (e) {
      console.error("Firestore lookup failed:", e);
      return corsJson({ error: "Internal Server Error" }, 500);
    }

    if (!storedHash) {
      // Тенант не найден — такой же ответ как при неверном секрете (не раскрываем существование)
      return corsJson({ error: "Unauthorized" }, 401);
    }

    // Шаг 2: проверить секрет против хэша этого тенанта
    const valid = await secretMatchesHash(secret, storedHash);
    if (!valid) {
      return corsJson({ error: "Unauthorized" }, 401);
    }

    // Шаг 3: выдать Firebase Custom Token
    try {
      const token = await createCustomToken(sa, businessId);
      return corsJson({ token });
    } catch (e) {
      console.error("createCustomToken failed:", e);
      return corsJson({ error: "Internal Server Error" }, 500);
    }
  },
};
