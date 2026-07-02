// Polyfill: Cloudflare Workers expose `crypto` as a global.
// Node ≥20 has globalThis.crypto natively (read-only getter) — no assignment needed.
// Node 18: property doesn't exist → Object.defineProperty is safe.
import { webcrypto } from "node:crypto";

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, writable: false });
}
