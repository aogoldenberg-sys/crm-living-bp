import { describe, it, expect, vi } from "vitest";

vi.mock("../firebase", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({}));

import { buildPlIndex, computePlMatches, plLookupCode } from "./plIndex";
import type { loadPricelist } from "./useOrders";

type Pl = Awaited<ReturnType<typeof loadPricelist>>[number];
const pl = (p: Partial<Pl>): Pl => ({
  sid: "s1", sname: "Поставщик", name: "Товар", barcode: null, sku: null,
  price: 10000, quant: null, note: null, ...p,
});

describe("buildPlIndex / computePlMatches — нормализация штрихкодов", () => {
  const index = buildPlIndex([
    pl({ sid: "a", sname: "Альфа", name: "Паста Барилла спагетти", barcode: "4607007729208", price: 15000 }),
    // штрихкод числом (как бывает после Google Sheets) — должен находиться по строке
    pl({ sid: "b", sname: "Бета", name: "Паста Барилла спагетти", barcode: 4607007729208 as unknown as string, price: 14000 }),
    pl({ sid: "c", sname: "Гамма", name: "Оливки зелёные", barcode: "0012345678905", sku: "ART-77", price: 9000 }),
    pl({ sid: "d", sname: "Дельта", name: "Мусор", barcode: "1", price: 20_000_000 }),
  ]);

  it("строка и число — один ключ, сортировка по цене", () => {
    const m = computePlMatches(index, { productName: "что угодно", barcode: "4607007729208" });
    expect(m.map(x => x.supplierName)).toEqual(["Бета", "Альфа"]);
    expect(m.every(x => typeof x.barcode === "string")).toBe(true);
  });

  it("пробелы, '.0' и ведущие нули в позиции заказа не мешают", () => {
    expect(computePlMatches(index, { productName: "", barcode: "4607 0077 29208" })).toHaveLength(2);
    expect(computePlMatches(index, { productName: "", barcode: "4607007729208.0" })).toHaveLength(2);
    expect(computePlMatches(index, { productName: "", barcode: "12345678905" })[0].supplierName).toBe("Гамма");
  });

  it("артикул (sku) через productId, регистр не важен", () => {
    expect(computePlMatches(index, { productName: "", barcode: null, productId: "art-77" })[0].supplierName).toBe("Гамма");
  });

  it("фолбэк на поиск по названию сохранён", () => {
    const m = computePlMatches(index, { productName: "Оливки зелёные 300г", barcode: "999" });
    expect(m[0]?.supplierName).toBe("Гамма");
  });

  it("мусорные цены не индексируются; plLookupCode нормализует запрос", () => {
    expect(plLookupCode(index, "1")).toBeUndefined();
    expect(plLookupCode(index, " 0004607007729208 ")).toHaveLength(2);
    expect(plLookupCode(index, "")).toBeUndefined();
  });
});
