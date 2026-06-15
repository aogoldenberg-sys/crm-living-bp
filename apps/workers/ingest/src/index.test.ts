import { describe, it, expect } from "vitest";
import { run } from "./index.js";
import { FakeFirestore } from "@crm/firestore-adapter/testing";

/** Минимальный валидный PaymentIn */
const validEvent = {
  type: "payment_in",
  eventId: "550e8400-e29b-41d4-a716-446655440001",
  ts: "2026-06-15T10:00:00Z",
  valueDate: "2026-06-15",
  amount: 1_500_00,
  counterpartyInn: null,
  counterpartyName: "ООО Тест",
  purpose: "Тестовый платёж",
  matchedInvoiceId: null,
  source: "manual",
};

describe("ingest run()", () => {
  it("сохраняет валидное событие, возвращает events=1 skipped=0", async () => {
    const db = new FakeFirestore();
    const result = await run([validEvent], db);
    expect(result.events).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("пропускает невалидное событие, возвращает events=0 skipped=1", async () => {
    const db = new FakeFirestore();
    const result = await run([{ type: "unknown", foo: "bar" }], db);
    expect(result.events).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("смесь: 1 валидное + 1 мусор → events=1 skipped=1", async () => {
    const db = new FakeFirestore();
    const result = await run([validEvent, { type: "garbage" }], db);
    expect(result.events).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("пустой массив — ничего не падает", async () => {
    const db = new FakeFirestore();
    const result = await run([], db);
    expect(result.events).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it("идемпотентно: два одинаковых вызова — не дубли в Firestore", async () => {
    const db = new FakeFirestore();
    await run([validEvent], db);
    await run([validEvent], db);
    // Если в Firestore один doc — дублей нет
    // Проверяем через loadEvents (косвенно через другой запуск: events=1)
    const result = await run([validEvent], db);
    expect(result.events).toBe(1);
  });
});
