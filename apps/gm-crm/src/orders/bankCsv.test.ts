import { describe, it, expect } from "vitest";
import {
  parseCsv, parseAmountKopecks, normalizeInn, parseBankDate, fmtRuDate,
  parseTBankCsv, assignTxIds, legacyTxId, safeDocId, findMatchingOrder,
} from "./bankCsv";

describe("parseCsv", () => {
  it("простые ячейки", () => {
    expect(parseCsv("a;b;c\n1;2;3", ";")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });
  it("разделитель внутри кавычек", () => {
    expect(parseCsv('x;"оплата; по счёту 5, 6";y', ";")).toEqual([["x", "оплата; по счёту 5, 6", "y"]]);
  });
  it('экранированные кавычки ""', () => {
    expect(parseCsv('"ООО ""Ромашка""";2', ";")).toEqual([['ООО "Ромашка"', "2"]]);
  });
  it("перенос строки внутри кавычек, CRLF, пустые строки, BOM", () => {
    const t = '﻿a;b\r\n"line1\r\nline2";z\r\n\r\n1;2\r\n';
    expect(parseCsv(t, ";")).toEqual([["a", "b"], ["line1\r\nline2", "z"], ["1", "2"]]);
  });
  it("пустые ячейки сохраняются", () => {
    expect(parseCsv(";;x;", ";")).toEqual([["", "", "x", ""]]);
  });
});

describe("parseAmountKopecks", () => {
  it.each([
    ["1 234,56", 123456],
    ["1 234,56", 123456],
    ["1 234.56", 123456],
    ["1.234,56", 123456],
    ["1,234.56", 123456],
    ["0,29", 29],
    ["0.1", 10],
    ["1 000 000", 100000000],
    ["15000", 1500000],
    ["-500,00", -50000],
    ["1 234,56 ₽", 123456],
    ["1.005", 101],
  ])("%s → %d", (raw, kop) => {
    expect(parseAmountKopecks(raw)).toBe(kop);
  });
  it("не число → NaN", () => {
    expect(parseAmountKopecks("")).toBeNaN();
    expect(parseAmountKopecks("abc")).toBeNaN();
  });
});

describe("normalizeInn", () => {
  it.each([
    ["7701234567/770101001", "7701234567"],
    [" 7701234567 / 770101001 ", "7701234567"],
    ["ИНН 7701234567 КПП 770101001", "7701234567"],
    ["7701234567 770101001", "7701234567"],
    ['="0274012345"', "0274012345"],
    ["'0274012345", "0274012345"],
    ["274012345", "0274012345"],          // Excel срезал ведущий ноль (юрлицо)
    ["77012345678", "077012345678"],       // ИП, 12 цифр без ведущего нуля
    ["771234567890", "771234567890"],
    ["", ""],
  ])("%s → %s", (raw, inn) => {
    expect(normalizeInn(raw)).toBe(inn);
  });
  it("null/undefined", () => {
    expect(normalizeInn(null)).toBe("");
    expect(normalizeInn(undefined)).toBe("");
  });
});

describe("parseBankDate / fmtRuDate", () => {
  it.each([
    ["05.03.2026", "2026-03-05"],
    ["5.3.2026", "2026-03-05"],
    ["05.03.2026 14:22", "2026-03-05"],
    ["05.03.2026 14:22:01", "2026-03-05"],
    ["05.03.26", "2026-03-05"],
    ["2026-03-05", "2026-03-05"],
    ["2026-03-05T10:00:00Z", "2026-03-05"],
    ["31.02.2026", ""],
    ["мусор", ""],
  ])("parseBankDate(%s) → %s", (raw, iso) => {
    expect(parseBankDate(raw)).toBe(iso);
  });
  it("fmtRuDate показывает и ISO, и старый формат", () => {
    expect(fmtRuDate("2026-03-05")).toBe("05.03.2026");
    expect(fmtRuDate("05.03.2026")).toBe("05.03.2026");
    expect(fmtRuDate("05.03.2026 14:22")).toBe("05.03.2026");
    expect(fmtRuDate("")).toBe("");
    expect(fmtRuDate("мусор")).toBe("мусор");
    expect(fmtRuDate(new Date(2026, 2, 5, 12).toISOString())).toBe(new Date(2026, 2, 5, 12).toLocaleDateString("ru-RU"));
  });
});

const CSV = [
  "Выписка по счёту 40702810910002035693",
  "Период: 01.03.2026 - 31.03.2026",
  "",
  'Дата операции;Номер документа;Наименование контрагента;ИНН/КПП контрагента;Зачислено;Списано;Назначение платежа',
  '05.03.2026 10:15;123;"ООО ""Ромашка""";7701234567/770101001;"1 234,56";;"Оплата по счёту №5; 6, без НДС"',
  '05.03.2026;124;ИП Иванов;="077012345678";15 000,00;;"Оплата\nпо счёту 7"',
  '06.03.2026;;ООО Расход;7709999999/770901001;;500,00;Списание',
].join("\r\n");

describe("parseTBankCsv", () => {
  it("колонки не съезжают при ; , \" и переносе в назначении", () => {
    const rows = parseTBankCsv(CSV);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      date: "2026-03-05", dateRaw: "05.03.2026 10:15", credit: 123456,
      payerName: 'ООО "Ромашка"', payerInn: "7701234567", innRaw: "7701234567",
      purpose: "Оплата по счёту №5; 6, без НДС", docNumber: "123",
    });
    expect(rows[1]).toMatchObject({
      date: "2026-03-05", credit: 1500000, payerInn: "077012345678", purpose: "Оплата\nпо счёту 7",
    });
  });
  it("разделитель-запятая", () => {
    const t = 'Дата,Контрагент,ИНН,Зачислено,Назначение\n01.04.2026,ООО А,7701234567,"1 000,50","оплата, аванс"';
    expect(parseTBankCsv(t)).toEqual([expect.objectContaining({ credit: 100050, purpose: "оплата, аванс", date: "2026-04-01" })]);
  });
  it("нет заголовка → []", () => {
    expect(parseTBankCsv("a;b;c\n1;2;3")).toEqual([]);
  });
});

describe("assignTxIds / safeDocId", () => {
  const base = { date: "2026-03-05", credit: 100, payerName: "", payerInn: "7701234567", purpose: "", docNumber: "", dateRaw: "05.03.2026", innRaw: "7701234567" };
  it("одинаковые платежи получают разные txId по порядковому номеру", () => {
    const r = assignTxIds([base, base, { ...base, credit: 200 }]);
    expect(r.map((x) => x.txId)).toEqual([
      "2026-03-05_100_7701234567_#1", "2026-03-05_100_7701234567_#2", "2026-03-05_200_7701234567_#1",
    ]);
    expect(r.map((x) => x.occurrence)).toEqual([1, 2, 1]);
  });
  it("номер документа в ключе, если есть", () => {
    expect(assignTxIds([{ ...base, docNumber: "77" }])[0].txId).toBe("2026-03-05_100_7701234567_n77");
  });
  it("стабильно при повторном импорте", () => {
    expect(assignTxIds([base, base])).toEqual(assignTxIds([base, base]));
  });
  it("legacyTxId — прежний формат", () => {
    expect(legacyTxId("05.03.2026", 100, "7701234567")).toBe("05.03.2026_100_7701234567");
  });
  it("safeDocId без / и прочих запрещённых символов, инъективен", () => {
    const id = safeDocId("2026-03-05_100_7701234567_n12/3");
    expect(id).toMatch(/^[A-Za-z0-9_~-]+$/);
    expect(safeDocId("a#1")).not.toBe(safeDocId("a~1"));
  });
});

describe("findMatchingOrder", () => {
  const orders = [
    { id: "new",  customerInn: "7701234567", totalKopecks: 100, createdAt: "2026-03-03T00:00:00Z", paid: false },
    { id: "old",  customerInn: " 7701234567/770101001", totalKopecks: 100, createdAt: "2026-03-01T00:00:00Z", paid: false },
    { id: "paid", customerInn: "7701234567", totalKopecks: 100, createdAt: "2026-02-01T00:00:00Z", paid: true },
    { id: "cancelled", customerInn: "7709999999", totalKopecks: 500, createdAt: "2026-03-01T00:00:00Z", paid: false, status: "cancelled" },
    { id: "zero", customerInn: "274012345", totalKopecks: 300, createdAt: "2026-03-01T00:00:00Z" },
  ];
  it("ИНН + точная сумма, самый старый неоплаченный", () => {
    expect(findMatchingOrder(orders, "7701234567", 100, new Set())?.id).toBe("old");
  });
  it("два одинаковых платежа → разные заказы, третий → unmatched", () => {
    const taken = new Set<string>();
    const a = findMatchingOrder(orders, "7701234567", 100, taken)!; taken.add(a.id);
    const b = findMatchingOrder(orders, "7701234567", 100, taken)!; taken.add(b.id);
    expect([a.id, b.id]).toEqual(["old", "new"]);
    expect(findMatchingOrder(orders, "7701234567", 100, taken)).toBeUndefined();
  });
  it("сумма не совпала → нет", () => {
    expect(findMatchingOrder(orders, "7701234567", 101, new Set())).toBeUndefined();
  });
  it("отменённые заказы сопоставляются (акт сверки)", () => {
    expect(findMatchingOrder(orders, "7709999999", 500, new Set())?.id).toBe("cancelled");
  });
  it("ИНН заказа нормализуется (потерянный ведущий ноль)", () => {
    expect(findMatchingOrder(orders, "0274012345", 300, new Set())?.id).toBe("zero");
  });
  it("пустой ИНН не сопоставляется", () => {
    expect(findMatchingOrder([{ id: "x", customerInn: "", totalKopecks: 1, createdAt: "" }], "", 1, new Set())).toBeUndefined();
  });
});
