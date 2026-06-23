// Polyfill: Cloudflare Workers expose `crypto` as a global.
// In Node.js 18+, it's on globalThis.crypto but not as bare `crypto`.
// This setup makes `crypto` accessible the same way as in Workers.
import { webcrypto } from "node:crypto";

// @ts-expect-error — assigning to global crypto for test environment
globalThis.crypto = webcrypto;
