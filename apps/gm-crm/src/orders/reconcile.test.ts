import { describe, it, expect } from "vitest";
import { normalizePartyName, paymentBelongsTo, paymentDisplayDate, sortReconRows } from "./reconcile";

describe("акт сверки: даты", () => {
  it("txDate в ISO и в старом ДД.ММ.ГГГГ", () => {
    expect(paymentDisplayDate({ txDate: "2026-03-05" })).toBe("05.03.2026");
    expect(paymentDisplayDate({ txDate: "05.03.2026" })).toBe("05.03.2026");
    expect(paymentDisplayDate({ txDate: "5.3.2026 12:30" })).toBe("05.03.2026");
  });
  it("нет/мусор в txDate → createdAt", () => {
    const d = paymentDisplayDate({ txDate: "", createdAt: "2026-03-07T10:00:00.000Z" });
    expect(d).toMatch(/^0[67]\.03\.2026$/);
    expect(paymentDisplayDate({ txDate: "мусор", createdAt: "2026-03-07" })).toBe("07.03.2026");
  });
  it("сортировка по дате, а не по строке; нераспознанные в конец", () => {
    const rows = [
      { date: "10.02.2026", id: 1 }, { date: "Invalid Date", id: 2 },
      { date: "05.03.2025", id: 3 }, { date: "01.02.2026", id: 4 }, { date: "2026-01-15", id: 5 },
    ];
    expect(sortReconRows(rows).map(r => r.id)).toEqual([3, 5, 4, 1, 2]);
  });
});

describe("акт сверки: поиск платежей по плательщику", () => {
  it("кавычки/регистр/пробелы", () => {
    expect(normalizePartyName('ООО ""Ромашка""')).toBe("ооо ромашка");
    expect(normalizePartyName("ооо  «Ромашка» ")).toBe("ооо ромашка");
    expect(normalizePartyName('ООО "Ромашка"')).toBe(normalizePartyName("ООО Ромашка"));
  });
  it("по имени или по ИНН", () => {
    expect(paymentBelongsTo({ payerName: 'ООО ""Ромашка""' }, 'ООО "Ромашка"')).toBe(true);
    expect(paymentBelongsTo({ payerName: "ИП Иванов", payerInn: "7701234567" }, "Ромашка", "7701234567/770101001")).toBe(true);
    expect(paymentBelongsTo({ payerName: "ООО Лютик", payerInn: "7701234568" }, "ООО Ромашка", "7701234567")).toBe(false);
    expect(paymentBelongsTo({ payerName: "" }, "")).toBe(false);
  });
});
