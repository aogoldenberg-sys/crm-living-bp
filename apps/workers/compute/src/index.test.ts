/**
 * Unit-тесты для compute-воркера.
 *
 * Запускаются в Vitest + FakeFirestore — workerd не нужен.
 * Цель: доказать изоляцию тенантов в цикле runWithDb до того,
 * как в систему потекут реальные деньги клиентов.
 *
 * Инварианты:
 *   1. Цикл обрабатывает все тенанты независимо.
 *   2. Сбой одного тенанта (storage error) не останавливает остальных.
 *   3. Результаты сохраняются раздельно: planfact А не перезаписывает planfact Б.
 */

import { describe, it, expect } from "vitest";
import type { BusinessEvent } from "@crm/schemas";
import { FakeFirestore } from "@crm/firestore-adapter/testing";
import {
  registerTenant,
  saveEvents,
  loadPlanfact,
  type Db,
  type CollectionRef,
} from "@crm/firestore-adapter";
import { runWithDb } from "./index.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makePaymentIn(businessId: string, eventId: string, amount: number): BusinessEvent {
  return {
    type: "payment_in",
    businessId,
    eventId,
    ts: "2026-01-15T10:00:00Z",
    valueDate: "2026-01-15",
    amount,
    counterpartyInn: null,
    counterpartyName: "ООО Тест",
    purpose: "Оплата услуг",
    matchedInvoiceId: null,
    source: "manual",
  } as BusinessEvent;
}

/** Создаёт Db, который бросает только для конкретного пути коллекции. */
function makePartialErrorDb(inner: FakeFirestore, failCollectionPath: string): Db {
  const storageError = new Error(`Simulated storage failure for ${failCollectionPath}`);

  function throwingCollection(): CollectionRef {
    const throwingQuery = {
      where: () => throwingQuery,
      orderBy: () => throwingQuery,
      get: async () => { throw storageError; },
    };
    return {
      ...throwingQuery,
      doc: () => ({
        id: "fake",
        get: async () => { throw storageError; },
        set: async () => { throw storageError; },
      }),
    } as unknown as CollectionRef;
  }

  return {
    collection(path: string): CollectionRef {
      if (path === failCollectionPath) return throwingCollection();
      return inner.collection(path);
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("runWithDb — мультитенантный цикл", () => {
  it("обрабатывает двух тенантов: каждый получает свой planfact", async () => {
    const db = new FakeFirestore();

    // Регистрируем два тенанта
    await registerTenant(db, "alpha");
    await registerTenant(db, "beta");

    // Alpha: 150 000 ₽ поступление
    await saveEvents(db, "alpha", [
      makePaymentIn("alpha", "00000000-0000-0000-0000-000000000001", 150_000_00),
    ]);

    // Beta: 50 000 ₽ поступление
    await saveEvents(db, "beta", [
      makePaymentIn("beta", "00000000-0000-0000-0000-000000000002", 50_000_00),
    ]);

    await runWithDb(db);

    const alphaResult = await loadPlanfact(db, "alpha");
    const betaResult = await loadPlanfact(db, "beta");

    expect(alphaResult.ok).toBe(true);
    expect(betaResult.ok).toBe(true);

    if (alphaResult.ok && betaResult.ok) {
      expect(alphaResult.value).not.toBeNull();
      expect(betaResult.value).not.toBeNull();

      // Суммы не смешались: у каждого тенанта своя
      expect(alphaResult.value!.totalIn).toBe(150_000_00);
      expect(betaResult.value!.totalIn).toBe(50_000_00);

      // Результат Alpha не «утёк» к Beta и наоборот
      expect(alphaResult.value!.totalIn).not.toBe(betaResult.value!.totalIn);
    }
  });

  it("сбой одного тенанта не останавливает обработку другого", async () => {
    const inner = new FakeFirestore();

    // Регистрируем оба тенанта
    await registerTenant(inner, "good-tenant");
    await registerTenant(inner, "bad-tenant");

    // good-tenant имеет валидные события
    await saveEvents(inner, "good-tenant", [
      makePaymentIn("good-tenant", "00000000-0000-0000-0000-aaaaaaaaaa01", 75_000_00),
    ]);

    // bad-tenant: симулируем storage failure при чтении его событий
    const db = makePartialErrorDb(inner, "tenants/bad-tenant/events");

    // runWithDb должен завершиться без throw — bad-tenant логирует ошибку и пропускается
    await expect(runWithDb(db)).resolves.toBeUndefined();

    // good-tenant всё равно обработан и сохранён
    const goodResult = await loadPlanfact(inner, "good-tenant");
    expect(goodResult.ok).toBe(true);
    if (goodResult.ok) {
      expect(goodResult.value).not.toBeNull();
      expect(goodResult.value!.totalIn).toBe(75_000_00);
    }

    // bad-tenant planfact не был записан (storage error до aggregation)
    const badResult = await loadPlanfact(inner, "bad-tenant");
    expect(badResult.ok).toBe(true);
    if (badResult.ok) {
      expect(badResult.value).toBeNull(); // planfact не записан
    }
  });

  it("нет тенантов — runWithDb завершается без ошибок", async () => {
    const db = new FakeFirestore();
    await expect(runWithDb(db)).resolves.toBeUndefined();
  });
});
