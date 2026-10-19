/**
 * Worker: crm-matrix — прокси и вебхук-приёмник Matrix Telecom АТС.
 *
 * Маршруты:
 *   POST /call      — click-to-call (CRM → Matrix makeCall)
 *   GET  /history   — история звонков (CRM → Matrix history)
 *   POST /webhook   — события от Matrix PBX → KV
 *   GET  /events    — активные входящие звонки (фронт опрашивает)
 *   POST /contact   — запрос имени звонящего от Matrix (PBX → CRM)
 *
 * Секреты (wrangler secret put):
 *   MATRIX_DOMAIN       e.g. "company.matrixtelecom.ru"
 *   MATRIX_TOKEN        API-токен из ЛК
 *   MATRIX_CRM_TOKEN    токен валидации входящих вебхуков
 *
 * Vars (wrangler.toml):
 *   FIREBASE_PROJECT_ID   проект, чьи ID token принимаются на /call, /history, /events
 *   AUTH_REQUIRED         "1" — запросы без Bearer-токена отклоняются; иначе пропускаются с логом (переходный режим)
 */

import { checkEmployee } from "./auth";

interface Env {
  MATRIX_DOMAIN: string;
  MATRIX_TOKEN: string;
  MATRIX_CRM_TOKEN: string;
  CALL_EVENTS: KVNamespace;
  FIREBASE_PROJECT_ID: string;
  AUTH_REQUIRED?: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function matrixPost(env: Env, params: Record<string, string>): Promise<Response> {
  const body = new URLSearchParams({ token: env.MATRIX_TOKEN, ...params });
  return fetch(`https://${env.MATRIX_DOMAIN}/sys/crm_api.wcgp`, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handleCall(req: Request, env: Env): Promise<Response> {
  const { phone, user } = await req.json() as { phone: string; user: string };
  if (!phone || !user) return json({ error: "phone and user required" }, 400);
  const r = await matrixPost(env, { cmd: "makeCall", phone, user });
  const data = await r.json() as unknown;
  return json(data);
}

async function handleHistory(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const period = url.searchParams.get("period") ?? "today";
  const type   = url.searchParams.get("type")   ?? "all";
  const r = await matrixPost(env, { cmd: "history", period, type, limit: "200" });
  const text = await r.text();

  // Matrix возвращает CSV: UID,type,client,account,via,start,wait,duration,record
  const lines = text.trim().split("\n").filter(l => l.trim() && !l.startsWith("UID"));
  const calls = lines.map(line => {
    const [uid, callType, client, account, via, start, wait, duration, record] = line.split(",");
    return {
      uid: uid?.trim(),
      type: callType?.trim(),   // in | out | missed
      client: client?.trim(),   // номер клиента
      account: account?.trim(), // внутренний номер менеджера
      via: via?.trim(),
      start: start?.trim(),
      wait: Number(wait) || 0,
      duration: Number(duration) || 0,
      record: record?.trim() || null,
    };
  });
  return json(calls);
}

async function handleWebhook(req: Request, env: Env): Promise<Response> {
  // Matrix отправляет application/x-www-form-urlencoded
  let params: URLSearchParams;
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = await req.json() as Record<string, string>;
    params = new URLSearchParams(body);
  } else {
    params = new URLSearchParams(await req.text());
  }

  const crmToken = params.get("crm_token");
  if (crmToken !== env.MATRIX_CRM_TOKEN) return new Response("Unauthorized", { status: 401 });

  const cmd = params.get("cmd") ?? params.get("command") ?? "";

  if (cmd === "event") {
    const callid = params.get("callid") ?? `${Date.now()}`;
    const event = {
      type:    params.get("type"),     // INCOMING | ACCEPTED | COMPLETED | CANCELLED | OUTGOING
      phone:   params.get("phone"),
      account: params.get("account"),
      callid,
      ts: Date.now(),
    };
    // INCOMING: TTL 90с (пока не подняли трубку)
    // COMPLETED/CANCELLED: TTL 5с (стираем попап)
    const ttl = (event.type === "INCOMING" || event.type === "OUTGOING") ? 90 : 5;
    await env.CALL_EVENTS.put(`event:${callid}`, JSON.stringify(event), { expirationTtl: ttl });
  }

  if (cmd === "history") {
    const callid = params.get("callid") ?? `${Date.now()}`;
    const record = {
      phone:    params.get("phone"),
      account:  params.get("account"),
      status:   params.get("status"),
      start:    params.get("start"),
      duration: Number(params.get("duration") ?? 0),
      record:   params.get("link"),
      callid,
      ts: Date.now(),
    };
    // Хранить 30 дней
    await env.CALL_EVENTS.put(`history:${callid}`, JSON.stringify(record), { expirationTtl: 86400 * 30 });
  }

  return new Response("OK");
}

async function handleEvents(_req: Request, env: Env): Promise<Response> {
  const list = await env.CALL_EVENTS.list({ prefix: "event:" });
  const events = await Promise.all(
    list.keys.map(k => env.CALL_EVENTS.get(k.name).then(v => v ? JSON.parse(v) : null))
  );
  const active = events.filter((e): e is NonNullable<typeof e> => !!e && e.type === "INCOMING");
  return json(active);
}

// Matrix PBX запрашивает имя звонящего — возвращаем пустую строку
// TODO: в будущем — поиск по Firestore tenants/gustoriko/orders по полю phone
async function handleContact(req: Request, env: Env): Promise<Response> {
  const params = new URLSearchParams(await req.text());
  const crmToken = params.get("crm_token");
  if (crmToken !== env.MATRIX_CRM_TOKEN) return new Response("Unauthorized", { status: 401 });
  return json({ contact: "", manager: "" });
}

// ── Router ────────────────────────────────────────────────────────────────────

// Маршруты, которые дёргает фронт CRM. /webhook и /contact — от АТС, у них свой crm_token.
const CRM_ROUTES = new Set(["/call", "/history", "/events"]);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });
    const { pathname } = new URL(req.url);

    if (CRM_ROUTES.has(pathname)) {
      const verdict = await checkEmployee(req, env.FIREBASE_PROJECT_ID);
      if (verdict === "denied") return json({ error: "forbidden" }, 403);
      if (verdict === "anonymous") {
        if (env.AUTH_REQUIRED === "1") return json({ error: "unauthorized" }, 401);
        console.warn(`crm-matrix: ${pathname} без токена — пропущено (переходный режим)`);
      }
    }

    if (pathname === "/call"    && req.method === "POST") return handleCall(req, env);
    if (pathname === "/history" && req.method === "GET")  return handleHistory(req, env);
    if (pathname === "/webhook" && req.method === "POST") return handleWebhook(req, env);
    if (pathname === "/events"  && req.method === "GET")  return handleEvents(req, env);
    if (pathname === "/contact" && req.method === "POST") return handleContact(req, env);

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  },
};
