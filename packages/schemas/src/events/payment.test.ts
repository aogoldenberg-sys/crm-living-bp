import { describe, it, expect } from "vitest";
import { PaymentIn, PaymentOut, PaymentCorrection } from "./payment.js";

const validPaymentIn = {
  type: "payment_in" as const,
  eventId: "550e8400-e29b-41d4-a716-446655440000",
  ts: "2026-06-12T10:00:00Z",
  valueDate: "2026-06-12",
  amount: 1_200_000,
  counterpartyInn: "7707083893",
  counterpartyName: "ООО Ромашка",
  purpose: "Оплата по счёту 42",
  matchedInvoiceId: null,
  source: "statement_import" as const,
};

describe("PaymentIn", () => {
  it("принимает валидное событие", () => {
    expect(PaymentIn.parse(validPaymentIn)).toEqual(validPaymentIn);
  });
  it("принимает null counterpartyInn", () => {
    expect(PaymentIn.parse({ ...validPaymentIn, counterpartyInn: null })).toBeTruthy();
  });
  it("отклоняет float-копейки", () => {
    expect(() => PaymentIn.parse({ ...validPaymentIn, amount: 100.5 })).toThrow();
  });
  it("отклоняет нулевую сумму", () => {
    expect(() => PaymentIn.parse({ ...validPaymentIn, amount: 0 })).toThrow();
  });
  it("отклоняет лишние поля (.strict)", () => {
    expect(() => PaymentIn.parse({ ...validPaymentIn, extra: 1 })).toThrow();
  });
  it("отклоняет кривой ИНН", () => {
    expect(() => PaymentIn.parse({ ...validPaymentIn, counterpartyInn: "123" })).toThrow();
  });
  it("отклоняет неверный формат даты", () => {
    expect(() => PaymentIn.parse({ ...validPaymentIn, valueDate: "12.06.2026" })).toThrow();
  });
  it("отклоняет неизвестный source", () => {
    expect(() => PaymentIn.parse({ ...validPaymentIn, source: "fax" })).toThrow();
  });
});

const validPaymentOut = {
  type: "payment_out" as const,
  eventId: "550e8400-e29b-41d4-a716-446655440001",
  ts: "2026-06-12T11:00:00Z",
  valueDate: "2026-06-12",
  amount: 50_000,
  counterpartyInn: "7707083893",
  counterpartyName: "ИП Сидоров",
  purpose: "Аренда офиса июнь",
  expenseCategory: "аренда",
  source: "bank_api" as const,
};

describe("PaymentOut", () => {
  it("принимает валидное событие", () => {
    expect(PaymentOut.parse(validPaymentOut)).toEqual(validPaymentOut);
  });
  it("отклоняет float-копейки", () => {
    expect(() => PaymentOut.parse({ ...validPaymentOut, amount: 50_000.99 })).toThrow();
  });
  it("отклоняет пустую expenseCategory", () => {
    expect(() => PaymentOut.parse({ ...validPaymentOut, expenseCategory: "" })).toThrow();
  });
  it("отклоняет лишние поля (.strict)", () => {
    expect(() => PaymentOut.parse({ ...validPaymentOut, extra: true })).toThrow();
  });
  it("отклоняет отрицательную сумму", () => {
    expect(() => PaymentOut.parse({ ...validPaymentOut, amount: -1000 })).toThrow();
  });
});

const validCorrection = {
  type: "payment_correction" as const,
  eventId: "550e8400-e29b-41d4-a716-446655440002",
  ts: "2026-06-12T12:00:00Z",
  correctedEventId: "550e8400-e29b-41d4-a716-446655440000",
  reason: "Неверная сумма — дублирование банковской выписки",
  source: "manual" as const,
};

describe("PaymentCorrection", () => {
  it("принимает валидное событие", () => {
    expect(PaymentCorrection.parse(validCorrection)).toEqual(validCorrection);
  });
  it("отклоняет пустую причину", () => {
    expect(() => PaymentCorrection.parse({ ...validCorrection, reason: "" })).toThrow();
  });
  it("отклоняет некорректный UUID correctedEventId", () => {
    expect(() =>
      PaymentCorrection.parse({ ...validCorrection, correctedEventId: "not-a-uuid" }),
    ).toThrow();
  });
  it("отклоняет лишние поля (.strict)", () => {
    expect(() => PaymentCorrection.parse({ ...validCorrection, amount: 100 })).toThrow();
  });
});
