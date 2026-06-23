/**
 * Unit-тесты изоляции секретов — auth worker.
 *
 * Доказывают инвариант: секрет тенанта A не даёт доступ к тенанту B.
 *
 * Тестируются чистые функции (нет сетевых вызовов):
 *   sha256hex       — детерминированный хэш
 *   secretMatchesHash — timing-safe сравнение секрета против хранимого хэша
 *
 * Почему этого достаточно для доказательства изоляции:
 *   Каждый тенант хранит hash = SHA-256(uniqueSecret).
 *   Вход принимается только если SHA-256(incoming) === hash_для_этого_тенанта.
 *   Т.к. SHA-256 — криптографически стойкая функция (preimage resistance),
 *   из hash_B нельзя восстановить secret_B, а secret_A → SHA-256(secret_A) ≠ hash_B.
 *   Тест ниже подтверждает это численно для конкретных значений.
 */

import { describe, it, expect } from "vitest";
import { sha256hex, secretMatchesHash } from "./index.js";

// ── sha256hex ─────────────────────────────────────────────────────────────────

describe("sha256hex", () => {
  it("well-known vector: sha256('hello')", async () => {
    const h = await sha256hex("hello");
    expect(h).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("пустая строка → детерминирован", async () => {
    const h1 = await sha256hex("");
    const h2 = await sha256hex("");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // 32 байта hex
  });

  it("разные входы → разные хэши", async () => {
    const a = await sha256hex("secret-alpha");
    const b = await sha256hex("secret-beta");
    expect(a).not.toBe(b);
  });
});

// ── secretMatchesHash ─────────────────────────────────────────────────────────

describe("secretMatchesHash", () => {
  it("совпадает — правильный секрет против своего хэша", async () => {
    const secret = "correct-secret-for-kamchatka";
    const hash = await sha256hex(secret);
    expect(await secretMatchesHash(secret, hash)).toBe(true);
  });

  it("не совпадает — неправильный секрет", async () => {
    const hash = await sha256hex("correct-secret");
    expect(await secretMatchesHash("wrong-secret", hash)).toBe(false);
  });

  it("пустой секрет → отказ", async () => {
    const hash = await sha256hex("real-secret");
    expect(await secretMatchesHash("", hash)).toBe(false);
  });

  it("пустой hash → отказ", async () => {
    expect(await secretMatchesHash("any-secret", "")).toBe(false);
  });
});

// ── КЛЮЧЕВОЙ ТЕСТ: изоляция тенантов ─────────────────────────────────────────

describe("изоляция тенантов — secret_A не открывает tenant_B", () => {
  it("секрет тенанта A отвергается при валидации тенанта B", async () => {
    // Тенант A получил свой уникальный секрет
    const secretA = "unique-secret-opentgp-xK9mP2qR";
    // Тенант B получил свой уникальный секрет
    const secretB = "unique-secret-kamchatka-vL7nJ3wS";

    // Firestore хранит только хэши
    const hashA = await sha256hex(secretA);
    const hashB = await sha256hex(secretB);

    // A проходит под своим хэшем
    expect(await secretMatchesHash(secretA, hashA)).toBe(true);
    // B проходит под своим хэшем
    expect(await secretMatchesHash(secretB, hashB)).toBe(true);

    // ИЗОЛЯЦИЯ: секрет A НЕ проходит против хэша B
    expect(await secretMatchesHash(secretA, hashB)).toBe(false);
    // ИЗОЛЯЦИЯ: секрет B НЕ проходит против хэша A
    expect(await secretMatchesHash(secretB, hashA)).toBe(false);
  });

  it("подстановка хэша: хэш A не совпадает с хэшем B", async () => {
    const hashA = await sha256hex("secret-a");
    const hashB = await sha256hex("secret-b");
    // SHA-256 collision-resistant — разные секреты → разные хэши
    expect(hashA).not.toBe(hashB);
  });
});
