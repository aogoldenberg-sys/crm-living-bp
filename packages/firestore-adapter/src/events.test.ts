import { describe, it, expect } from "vitest";
import type { BusinessEvent } from "@crm/schemas";
import { loadEvents, saveEvents, type LoadEventsResult } from "./events.js";
import { FakeFirestore, ErrorFakeFirestore } from "./testing/fake-firestore.js";

/** Минимальный валидный PaymentIn для тестов. */
function makePaymentIn(overrides?: { eventId?: string; ts?: string }): BusinessEvent {
  return {
    type: "payment_in",
    eventId: overrides?.eventId ?? "00000000-0000-0000-0000-000000000001",
    ts: (overrides?.ts ?? "2026-01-01T10:00:00Z"),
    valueDate: "2026-01-01",
    amount: 100_00,
    counterpartyInn: null,
    counterpartyName: "ООО Тест",
    purpose: "Оплата услуг",
    matchedInvoiceId: null,
    source: "manual",
    businessId: "test-biz",
  } as BusinessEvent;
}

describe("saveEvents + loadEvents", () => {
  it("saveEvents сохраняет документы с правильными eventId", async () => {
    const db = new FakeFirestore() ;
    const event = makePaymentIn();

    const result = await saveEvents(db, "test-biz", [event]);
    expect(result.ok).toBe(true);

    const loaded = await loadEvents(db, "test-biz");
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value.events).toHaveLength(1);
      expect(loaded.value.events[0]?.eventId).toBe(event.eventId);
      expect(loaded.value.skipped).toBe(0);
    }
  });

  it("loadEvents без since возвращает все события", async () => {
    const db = new FakeFirestore() ;
    const events = [
      makePaymentIn({ eventId: "00000000-0000-0000-0000-000000000001", ts: "2026-01-01T10:00:00Z" }),
      makePaymentIn({ eventId: "00000000-0000-0000-0000-000000000002", ts: "2026-06-01T10:00:00Z" }),
    ];

    await saveEvents(db, "test-biz", events);
    const result = await loadEvents(db, "test-biz");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.events).toHaveLength(2);
      expect(result.value.skipped).toBe(0);
    }
  });

  it("loadEvents с since фильтрует по полю ts", async () => {
    const db = new FakeFirestore() ;
    const old = makePaymentIn({ eventId: "00000000-0000-0000-0000-000000000001", ts: "2025-01-01T00:00:00Z" });
    const recent = makePaymentIn({ eventId: "00000000-0000-0000-0000-000000000002", ts: "2026-06-01T00:00:00Z" });

    await saveEvents(db, "test-biz", [old, recent]);
    const result = await loadEvents(db, "test-biz", "2026-01-01T00:00:00Z");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.events).toHaveLength(1);
      expect(result.value.events[0]?.eventId).toBe(recent.eventId);
    }
  });

  it("loadEvents: невалидный документ пропускается, skipped инкрементируется", async () => {
    const db = new FakeFirestore() ;
    const valid = makePaymentIn({ eventId: "00000000-0000-0000-0000-000000000001" });

    await saveEvents(db, "test-biz", [valid]);

    // Вручную кладём мусор в коллекцию events через «внутренности» фейка
    const rawFake = db as unknown as FakeFirestore;
    const col = rawFake.collection("tenants/test-biz/events");
    const badDoc = col.doc("bad-doc-id");
    await badDoc.set({ type: "unknown_garbage", foo: 123 });

    const result = await loadEvents(db, "test-biz");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.events).toHaveLength(1);
      expect(result.value.events[0]?.eventId).toBe(valid.eventId);
      // Счётчик потерь виден вызывающему коду — тихих потерь нет
      expect(result.value.skipped).toBe(1);
    }
  });

  it("saveEvents идемпотентно: повторный save того же eventId не создаёт дублей", async () => {
    const db = new FakeFirestore() ;
    const event = makePaymentIn();

    await saveEvents(db, "test-biz", [event]);
    await saveEvents(db, "test-biz", [event]); // повторный вызов

    const result = await loadEvents(db, "test-biz");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.events).toHaveLength(1);
    }
  });

  it("ИЗОЛЯЦИЯ: события тенанта А не видны тенанту Б", async () => {
    const db = new FakeFirestore();
    const eventA = makePaymentIn({ eventId: "00000000-0000-0000-0000-aaaaaaaaaaaa" });
    const eventB = makePaymentIn({ eventId: "00000000-0000-0000-0000-bbbbbbbbbbbb" });

    await saveEvents(db, "tenant-a", [eventA]);
    await saveEvents(db, "tenant-b", [eventB]);

    const resultA = await loadEvents(db, "tenant-a");
    const resultB = await loadEvents(db, "tenant-b");

    expect(resultA.ok).toBe(true);
    expect(resultB.ok).toBe(true);
    if (resultA.ok && resultB.ok) {
      // Tenant A видит только своё событие
      expect(resultA.value.events).toHaveLength(1);
      expect(resultA.value.events[0]?.eventId).toBe(eventA.eventId);

      // Tenant B видит только своё событие
      expect(resultB.value.events).toHaveLength(1);
      expect(resultB.value.events[0]?.eventId).toBe(eventB.eventId);

      // Кросс-проверка: eventId тенанта Б отсутствует у тенанта А
      const idsA = resultA.value.events.map((e) => e.eventId);
      expect(idsA).not.toContain(eventB.eventId);

      const idsB = resultB.value.events.map((e) => e.eventId);
      expect(idsB).not.toContain(eventA.eventId);
    }
  });

  it("STORAGE_ERROR: возвращает err при сбое db", async () => {
    const db = new ErrorFakeFirestore(
      new Error("Firestore unavailable"),
    ) ;

    const saveResult = await saveEvents(db, "test-biz", [makePaymentIn()]);
    expect(saveResult.ok).toBe(false);
    if (!saveResult.ok) {
      expect(saveResult.error.code).toBe("STORAGE_ERROR");
      expect(saveResult.error.message).toBe("Firestore unavailable");
    }

    const loadResult = await loadEvents(db, "test-biz");
    expect(loadResult.ok).toBe(false);
    if (!loadResult.ok) {
      expect(loadResult.error.code).toBe("STORAGE_ERROR");
    }
  });
});
