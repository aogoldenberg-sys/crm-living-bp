/**
 * Firestore REST клиент для Cloudflare Workers.
 *
 * Почему REST вместо firebase-admin:
 *   firebase-admin использует gRPC (@grpc/grpc-js), который требует нативных
 *   Node.js модулей (net, http2, tls) недоступных в Workers runtime.
 *   REST API работает через стандартный fetch — без зависимостей от Node.js.
 *
 * Аутентификация: service account → RS256 JWT → OAuth2 Bearer token.
 *   Используется Web Crypto API (crypto.subtle), доступный в Workers глобально.
 *   Token кешируется внутри экземпляра класса (жизнь = один запрос/scheduled).
 *
 * Покрывает только методы, используемые адаптером:
 *   collection → doc → get/set
 *   collection → (where →)? orderBy → get
 */

import type { Db, CollectionRef, Query, DocRef, DocSnapshot, QuerySnapshot } from "./db.js";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

type FsValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { mapValue: { fields: Record<string, FsValue> } }
  | { arrayValue: { values?: FsValue[] } };

// ── Auth: JWT + token exchange ─────────────────────────────────────────────────

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function b64urlStr(s: string): string {
  return b64url(new TextEncoder().encode(s).buffer as ArrayBuffer);
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const headerB64 = b64urlStr(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payloadB64 = b64urlStr(
    JSON.stringify({
      iss: sa.client_email,
      sub: sa.client_email,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
      scope: "https://www.googleapis.com/auth/datastore",
    }),
  );

  const signingInput = `${headerB64}.${payloadB64}`;

  // Парсим PKCS#8 PEM → CryptoKey для RSASSA-PKCS1-v1_5 / SHA-256
  const pemBody = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes.buffer as ArrayBuffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );

  const jwt = `${signingInput}.${b64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!res.ok) {
    throw new Error(`OAuth2 token request failed (${res.status}): ${await res.text()}`);
  }

  const { access_token } = (await res.json()) as { access_token: string };
  return access_token;
}

// ── Codec: JS ↔ Firestore REST value format ───────────────────────────────────

function encode(v: unknown): FsValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  if (typeof v === "object") {
    const fields: Record<string, FsValue> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      fields[k] = encode(val);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

function decode(v: FsValue): unknown {
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("arrayValue" in v) return (v.arrayValue.values ?? []).map(decode);
  if ("mapValue" in v) {
    const r: Record<string, unknown> = {};
    for (const [k, fv] of Object.entries(v.mapValue.fields ?? {})) r[k] = decode(fv);
    return r;
  }
  return null;
}

function encodeFields(data: Record<string, unknown>): Record<string, FsValue> {
  const fields: Record<string, FsValue> = {};
  for (const [k, v] of Object.entries(data)) fields[k] = encode(v);
  return fields;
}

function decodeFields(fields: Record<string, FsValue>): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) r[k] = decode(v);
  return r;
}

// ── REST snapshots ─────────────────────────────────────────────────────────────

class RestDocSnapshot implements DocSnapshot {
  constructor(
    readonly id: string,
    readonly exists: boolean,
    private readonly _data: Record<string, unknown> | undefined,
  ) {}
  data() {
    return this._data;
  }
}

class RestQuerySnapshot implements QuerySnapshot {
  constructor(readonly docs: RestDocSnapshot[]) {}
}

// ── REST query builder ─────────────────────────────────────────────────────────

type WhereFilter = { field: string; op: string; value: unknown };

const OP_MAP: Record<string, string> = {
  ">=": "GREATER_THAN_OR_EQUAL",
  "<=": "LESS_THAN_OR_EQUAL",
  ">": "GREATER_THAN",
  "<": "LESS_THAN",
  "==": "EQUAL",
};

class RestQuery implements Query {
  constructor(
    protected readonly client: FirestoreRestClient,
    protected readonly collectionId: string,
    protected readonly filters: WhereFilter[] = [],
    protected readonly _orderBy: { field: string; direction: "asc" | "desc" } | null = null,
  ) {}

  where(field: string, op: string, value: unknown): RestQuery {
    return new RestQuery(this.client, this.collectionId, [...this.filters, { field, op, value }], this._orderBy);
  }

  orderBy(field: string, direction: "asc" | "desc" = "asc"): RestQuery {
    return new RestQuery(this.client, this.collectionId, this.filters, { field, direction });
  }

  async get(): Promise<RestQuerySnapshot> {
    return this.client._runQuery(this.collectionId, this.filters, this._orderBy);
  }
}

class RestCollectionRef extends RestQuery implements CollectionRef {
  doc(id: string): DocRef {
    return new RestDocRef(this.client, this.collectionId, id);
  }
}

class RestDocRef implements DocRef {
  constructor(
    private readonly client: FirestoreRestClient,
    private readonly collectionId: string,
    readonly id: string,
  ) {}

  async get(): Promise<DocSnapshot> {
    return this.client._getDoc(this.collectionId, this.id);
  }

  async set(data: Record<string, unknown>): Promise<void> {
    return this.client._setDoc(this.collectionId, this.id, data);
  }

  collection(path: string): CollectionRef {
    return new RestCollectionRef(this.client, `${this.collectionId}/${this.id}/${path}`);
  }
}

// ── FirestoreRestClient ────────────────────────────────────────────────────────

export class FirestoreRestClient implements Db {
  private readonly sa: ServiceAccount;
  /** Кеш токена — живёт внутри одного экземпляра (один запрос/scheduled run). */
  private tokenCache: { token: string; exp: number } | null = null;

  constructor(sa: ServiceAccount) {
    this.sa = sa;
  }

  private get docsBase(): string {
    return `https://firestore.googleapis.com/v1/projects/${this.sa.project_id}/databases/(default)/documents`;
  }

  private async token(): Promise<string> {
    const now = Date.now() / 1000;
    if (this.tokenCache && this.tokenCache.exp > now + 60) return this.tokenCache.token;
    const t = await getAccessToken(this.sa);
    this.tokenCache = { token: t, exp: now + 3600 };
    return t;
  }

  private async req(url: string, init: RequestInit = {}): Promise<Response> {
    const tok = await this.token();
    return fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${tok}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  }

  collection(path: string): CollectionRef {
    return new RestCollectionRef(this, path);
  }

  async _getDoc(collectionId: string, docId: string): Promise<RestDocSnapshot> {
    const url = `${this.docsBase}/${collectionId}/${docId}`;
    const res = await this.req(url);
    if (res.status === 404) return new RestDocSnapshot(docId, false, undefined);
    if (!res.ok) {
      throw new Error(`Firestore GET ${collectionId}/${docId} failed (${res.status}): ${await res.text()}`);
    }
    const doc = (await res.json()) as { fields?: Record<string, FsValue> };
    return new RestDocSnapshot(docId, true, doc.fields ? decodeFields(doc.fields) : {});
  }

  async _setDoc(collectionId: string, docId: string, data: Record<string, unknown>): Promise<void> {
    // PATCH без updateMask заменяет весь документ (create or overwrite).
    const url = `${this.docsBase}/${collectionId}/${docId}`;
    const res = await this.req(url, {
      method: "PATCH",
      body: JSON.stringify({ fields: encodeFields(data) }),
    });
    if (!res.ok) {
      throw new Error(`Firestore PATCH ${collectionId}/${docId} failed (${res.status}): ${await res.text()}`);
    }
  }

  async _runQuery(
    collectionPath: string,
    filters: WhereFilter[],
    orderBy: { field: string; direction: "asc" | "desc" } | null,
  ): Promise<RestQuerySnapshot> {
    // Support subcollection paths like "tenants/opentgp/events"
    const parts = collectionPath.split("/");
    const collectionId = parts[parts.length - 1]!;
    const parentSuffix = parts.slice(0, -1).join("/");
    const url = parentSuffix
      ? `${this.docsBase}/${parentSuffix}:runQuery`
      : `${this.docsBase}:runQuery`;

    const structuredQuery: Record<string, unknown> = {
      from: [{ collectionId }],
    };

    if (filters.length === 1) {
      const f = filters[0]!;
      structuredQuery.where = {
        fieldFilter: {
          field: { fieldPath: f.field },
          op: OP_MAP[f.op] ?? "EQUAL",
          value: encode(f.value),
        },
      };
    } else if (filters.length > 1) {
      structuredQuery.where = {
        compositeFilter: {
          op: "AND",
          filters: filters.map((f) => ({
            fieldFilter: {
              field: { fieldPath: f.field },
              op: OP_MAP[f.op] ?? "EQUAL",
              value: encode(f.value),
            },
          })),
        },
      };
    }

    if (orderBy) {
      structuredQuery.orderBy = [
        {
          field: { fieldPath: orderBy.field },
          direction: orderBy.direction === "asc" ? "ASCENDING" : "DESCENDING",
        },
      ];
    }

    const res = await this.req(url, {
      method: "POST",
      body: JSON.stringify({ structuredQuery }),
    });

    if (!res.ok) {
      throw new Error(`Firestore runQuery ${collectionPath} failed (${res.status}): ${await res.text()}`);
    }

    const results = (await res.json()) as Array<{
      document?: { name: string; fields: Record<string, FsValue> };
    }>;

    const docs: RestDocSnapshot[] = [];
    for (const item of results) {
      if (!item.document) continue;
      const parts = item.document.name.split("/");
      const id = parts[parts.length - 1] ?? "";
      docs.push(new RestDocSnapshot(id, true, decodeFields(item.document.fields)));
    }

    return new RestQuerySnapshot(docs);
  }
}

/** Создаёт REST-клиент из JSON-строки service account (для CF Workers). */
export function createFirestoreRestClient(serviceAccountJson: string): FirestoreRestClient {
  const sa = JSON.parse(serviceAccountJson) as ServiceAccount;
  return new FirestoreRestClient(sa);
}
