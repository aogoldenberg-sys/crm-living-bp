import { describe, it, expect } from "vitest";
import { PaymentCalendar, PaymentCalendarEntry } from "./paymentCalendar.js";

const validEntry = {
  entryId: "550e8400-e29b-41d4-a716-446655440060",
  dueDate: "2026-07-05",
  amount: 300_000,
  direction: "outbound" as const,
  counterpartyName: "Арендодатель",
  description: "Аренда офиса июль",
  status: "planned" as const,
  linkedPaymentEventId: null,
  category: "аренда",
};

const validCalendar = {
  periodStart: "2026-07-01",
  periodEnd: "2026-07-31",
  openingBalanceKopecks: 5_000_000,
  entries: [validEntry],
};

describe("PaymentCalendarEntry", () => {
  it("принимает валидную запись", () => {
    expect(PaymentCalendarEntry.parse(validEntry)).toEqual(validEntry);
  });
  it("принимает linkedPaymentEventId с UUID", () => {
    expect(
      PaymentCalendarEntry.parse({
        ...validEntry,
        linkedPaymentEventId: "550e8400-e29b-41d4-a716-446655440001",
        status: "paid",
      }),
    ).toBeTruthy();
  });
  it("отклоняет float в amount", () => {
    expect(() => PaymentCalendarEntry.parse({ ...validEntry, amount: 300_000.1 })).toThrow();
  });
  it("отклоняет неизвестный status", () => {
    expect(() =>
      PaymentCalendarEntry.parse({ ...validEntry, status: "pending" }),
    ).toThrow();
  });
  it("отклоняет неизвестный direction", () => {
    expect(() =>
      PaymentCalendarEntry.parse({ ...validEntry, direction: "transfer" }),
    ).toThrow();
  });
  it("отклоняет некорректный UUID в linkedPaymentEventId", () => {
    expect(() =>
      PaymentCalendarEntry.parse({ ...validEntry, linkedPaymentEventId: "not-uuid" }),
    ).toThrow();
  });
  it("отклоняет лишние поля (.strict)", () => {
    expect(() => PaymentCalendarEntry.parse({ ...validEntry, note: "test" })).toThrow();
  });
});

describe("PaymentCalendar", () => {
  it("принимает валидный календарь", () => {
    expect(PaymentCalendar.parse(validCalendar)).toEqual(validCalendar);
  });
  it("принимает пустой массив entries", () => {
    expect(PaymentCalendar.parse({ ...validCalendar, entries: [] })).toBeTruthy();
  });
  it("отклоняет float в openingBalanceKopecks", () => {
    expect(() =>
      PaymentCalendar.parse({ ...validCalendar, openingBalanceKopecks: 5_000_000.5 }),
    ).toThrow();
  });
  it("отклоняет неверный формат periodStart", () => {
    expect(() =>
      PaymentCalendar.parse({ ...validCalendar, periodStart: "01.07.2026" }),
    ).toThrow();
  });
  it("отклоняет лишние поля (.strict)", () => {
    expect(() => PaymentCalendar.parse({ ...validCalendar, currency: "RUB" })).toThrow();
  });
});
