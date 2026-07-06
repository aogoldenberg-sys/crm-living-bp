import { describe, it, expect } from "vitest";
import { validateKndXml } from "./xsd.js";
import { generatePaymentPdf, generateUsnSummaryPdf } from "./pdf.js";
import type { KndPayment, KndUsnIncome } from "@crm/schemas";

// ─── XSD валидатор ───────────────────────────────────────────

describe("validateKndXml — КНД 1152017 (УСН)", () => {
  const valid = {
    КНД: "1152017",
    ДатаДок: "2024-01-31",
    ИННЮЛ: "7701234567",
    ДохНалПер: 500000000,
    НалБаза: 500000000,
    СумНал: 30000000,
  };

  it("корректные поля → ok: true", () => {
    const result = validateKndXml(valid, "1152017");
    expect(result.ok).toBe(true);
  });

  it("пустое обязательное поле ДохНалПер → violation с field и description", () => {
    const result = validateKndXml({ ...valid, ДохНалПер: undefined }, "1152017");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const v = result.violations.find((x) => x.field === "ДохНалПер");
      expect(v).toBeDefined();
      expect(v?.description).toBe("Доходы за налоговый период");
      expect(v?.reason).toBe("missing");
    }
  });

  it("пустая строка обязательного поля СумНал → violation", () => {
    const result = validateKndXml({ ...valid, СумНал: "" }, "1152017");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations.some((v) => v.field === "СумНал")).toBe(true);
    }
  });

  it("неверный паттерн ИННЮЛ (не 10 цифр) → violation", () => {
    const result = validateKndXml({ ...valid, ИННЮЛ: "123" }, "1152017");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const v = result.violations.find((x) => x.field === "ИННЮЛ");
      expect(v?.reason).toBe("pattern_mismatch");
    }
  });

  it("несколько нарушений → все violations в массиве", () => {
    const result = validateKndXml({ КНД: "1152017", ДатаДок: "bad" }, "1152017");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // ДатаДок — pattern_mismatch, ДохНалПер и СумНал — missing
      expect(result.violations.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("validateKndXml — неизвестный КНД", () => {
  it("неизвестный КНД → ok: false", () => {
    const result = validateKndXml({ КНД: "9999999" }, "9999999");
    expect(result.ok).toBe(false);
  });
});

// ─── PDF генератор ───────────────────────────────────────────

const PAYMENT: KndPayment = {
  КНД: "1161101",
  ДатаДок: "2024-03-15",
  НомерДок: "42",
  Сумма: 150000,
  ИННПлат: "7701234567",
  ИННПолуч: "5012345678",
};

const USN: KndUsnIncome = {
  КНД: "1152017",
  ДатаДок: "2024-01-31",
  ИННЮЛ: "7701234567",
  КПП: "770101001",
  ДохНалПер: 500000000,
  НалБаза: 500000000,
  СумНал: 30000000,
};

describe("generatePaymentPdf", () => {
  it("возвращает Buffer длиной > 0", async () => {
    const buf = await generatePaymentPdf(PAYMENT);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("Buffer начинается с PDF-сигнатуры %PDF", async () => {
    const buf = await generatePaymentPdf(PAYMENT);
    expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
  });
});

describe("generateUsnSummaryPdf", () => {
  it("возвращает Buffer длиной > 0", async () => {
    const buf = await generateUsnSummaryPdf(USN);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  it("Buffer начинается с PDF-сигнатуры %PDF", async () => {
    const buf = await generateUsnSummaryPdf(USN);
    expect(buf.slice(0, 4).toString("ascii")).toBe("%PDF");
  });
});
