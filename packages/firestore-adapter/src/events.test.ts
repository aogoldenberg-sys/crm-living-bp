import { describe, it, expect } from "vitest";
import type { BusinessEvent } from "@crm/schemas";
import type { Firestore } from "firebase-admin/firestore";
import { loadEvents, saveEvents } from "./events.js";
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
  } as BusinessEvent;
}

describe("saveEvents + loadEvents", () => {
  it("saveEvents сохраняет документы с правильными eventId", async () => {
    const db = new FakeFirestore() as unknown as Firestore;
    const event = makePaymentIn();

    const result = await saveEvents(db, [event]);
    expect(result.ok).toBe(true);

    const loaded = await loadEvents(db);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value).toHaveLength(1);
      expect(loaded.value[0]?.eventId).toBe(event.eventId);
    }
  });

  it("loadEvents без since возвращает все события", async () => {
    const db = new FakeFirestore() as unknown as Firestore;
    const events = [
      makePaymentIn({ eventId: "00000000-0000-0000-0000-000000000001", ts: "2026-01-01T10:00:00Z" }),
      makePaymentIn({ eventId: "00000000-0000-0000-0000-000000000002", ts: "2026-06-01T10:00:00Z" }),
    ];

    await saveEvents(db, events);
    const result = await loadEvents(db);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
    }
  });

  it("loadEvents с since фильтрует по полю ts", async () => {
    const db = new FakeFirestore() as unknown as Firestore;
    const old = makePaymentIn({ eventId: "00000000-0000-0000-0000-000000000001", ts: "2025-01-01T00:00:00Z" });
    const recent = makePaymentIn({ eventId: "00000000-0000-0000-0000-000000000002", ts: "2026-06-01T00:00:00Z" });

    await saveEvents(db, [old, recent]);
    const result = await loadEvents(db, "2026-01-01T00:00:00Z");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.eventId).toBe(recent.eventId);
    }
  });

  it("loadEvents: невалидный документ пропускается, валидные возвращаются", async () => {
    const db = new FakeFirestore() as unknown as Firestore;
    const valid = makePaymentIn({ eventId: "00000000-0000-0000-0000-000000000001" });

    await saveEvents(db, [valid]);

    // Вручную кладём мусор в коллекцию events через «внутренности» фейка
    const rawFake = db as unknown as FakeFirestore;
    const col = rawFake.collection("events");
    const badDoc = col.doc("bad-doc-id");
    await badDoc.set({ type: "unknown_garbage", foo: 123 });

    const result = await loadEvents(db);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Только один валидный; мусор пропущен без краша
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.eventId).toBe(valid.eventId);
    }
  });

  it("saveEvents идемпотентно: повторный save того же eventId не создаёт дублей", async () => {
    const db = new FakeFirestore() as unknown as Firestore;
    const event = makePaymentIn();

    await saveEvents(db, [event]);
    await saveEvents(db, [event]); // повторный вызов

    const result = await loadEvents(db);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
    }
  });

  it("STORAGE_ERROR: возвращает err при сбое db", async () => {
    const db = new ErrorFakeFirestore(
      new Error("Firestore unavailable"),
    ) as unknown as Firestore;

    const saveResult = await saveEvents(db, [makePaymentIn()]);
    expect(saveResult.ok).toBe(false);
    if (!saveResult.ok) {
      expect(saveResult.error.code).toBe("STORAGE_ERROR");
      expect(saveResult.error.message).toBe("Firestore unavailable");
    }

    const loadResult = await loadEvents(db);
    expect(loadResult.ok).toBe(false);
    if (!loadResult.ok) {
      expect(loadResult.error.code).toBe("STORAGE_ERROR");
    }
  });
});
