import { describe, it, expect } from "vitest";
import { itemQty, itemTotalKopecks, itemUnitKopecks, vatInside, splitVat, orderItemToUpd } from "./money";

describe("НДС внутри суммы", () => {
  it("итог не меняется, НДС = round(total × 22/122)", () => {
    const s = splitVat([12200]);
    expect(s.total).toBe(12200);
    expect(s.vat).toBe(2200);
    expect(s.net).toBe(10000);
    expect(vatInside(100)).toBe(18);
  });

  it("сумма строк сходится с итогом до копейки, остаток — на последнюю", () => {
    const lines = [333, 333, 334, 1, 99999, 7];
    const s = splitVat(lines);
    expect(s.lines.reduce((a, l) => a + l.vat, 0)).toBe(s.vat);
    expect(s.lines.reduce((a, l) => a + l.net, 0)).toBe(s.net);
    expect(s.lines.reduce((a, l) => a + l.total, 0)).toBe(s.total);
    expect(s.vat).toBe(vatInside(s.total));
    for (const l of s.lines) {
      expect(Number.isInteger(l.vat)).toBe(true);
      expect(l.net + l.vat).toBe(l.total);
    }
  });

  it("пустой список", () => {
    expect(splitVat([])).toEqual({ lines: [], total: 0, vat: 0, net: 0 });
  });
});

describe("цена позиции", () => {
  it("от totalKopecks и количества, без float-хвоста", () => {
    const it1 = { quantity: 3, unitPrice: 3, totalKopecks: 1000 };   // unitPrice в рублях (НаПолке)
    expect(itemUnitKopecks(it1)).toBe(333);
    expect(itemTotalKopecks(it1)).toBe(1000);
  });
  it("без totalKopecks — unitPrice (коп.)", () => {
    const it1 = { quantity: 2, unitPrice: 15050, totalKopecks: 0 };
    expect(itemUnitKopecks(it1)).toBe(15050);
    expect(itemTotalKopecks(it1)).toBe(30100);
  });
  it("количество: quantity ?? qty", () => {
    expect(itemQty({ qty: 4 })).toBe(4);
    expect(itemQty({ quantity: 2, qty: 4 })).toBe(2);
    expect(itemUnitKopecks({ qty: 4, totalKopecks: 1000 })).toBe(250);
  });
  it("строка УПД: цена в рублях до копеек, итог из заказа", () => {
    const u = orderItemToUpd({ productName: "Сыр", quantity: 3, unitPrice: 3, totalKopecks: 1000 });
    expect(u).toMatchObject({ name: "Сыр", qty: 3, unit: "шт", price: 3.33, totalKopecks: 1000 });
  });
});
