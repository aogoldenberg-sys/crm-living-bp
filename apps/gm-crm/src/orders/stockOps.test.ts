import { describe, it, expect } from "vitest";
import type { OrderItem } from "./useOrders";
import { addWorkDaysMsk, avgCost, buildLine, buildStockIndex, itemQty, mergeLine, planShipment, round3, type SavedLine } from "./stockOps";

const item = (p: Partial<OrderItem> & { qty?: number }): OrderItem =>
  ({ productId: "", productName: "Сок", barcode: "460", quantity: undefined as unknown as number,
    unitPrice: 10000, totalKopecks: 0, supplierId: null, ...p });
const pm = { supplierId: "s1", supplierName: "Поставщик", priceKopecks: 5000, barcode: null, productName: "Сок" };

describe("itemQty", () => {
  it("берёт qty, если quantity нет (заказы НаПолке)", () => {
    expect(itemQty({ qty: 4 })).toBe(4);
    expect(itemQty({ quantity: 2, qty: 4 })).toBe(2);
    expect(itemQty({})).toBe(0);
  });
});

describe("остатки по регионам", () => {
  const stock = buildStockIndex([
    { productName: "Сок", barcode: "460", qty: 6, costKopecks: 4000, region: "Москва" },
    { productName: "Сок", barcode: "460", qty: 4, costKopecks: 5000, region: "msk" },
    { productName: "Сок", barcode: "460", qty: -2, costKopecks: 0, region: null },
    { productName: "Сок", barcode: "460", qty: 3, costKopecks: 9900, region: "Санкт-Петербург" },
  ]);

  it("старые «Москва»/null считаются МСК, средняя себестоимость — по приходам региона", () => {
    expect(avgCost(stock, "msk", { productName: "Сок", barcode: "460" })).toBe(4400);
    expect(avgCost(stock, "spb", { productName: "Сок", barcode: "460" })).toBe(9900);
  });

  it("Склад — только если остатка в регионе заказа хватает", () => {
    const l = buildLine(item({ qty: 8, totalKopecks: 80000 }), 0, [pm], stock, "msk");
    expect(l).toMatchObject({ supplierName: "Склад", qtyOrdered: 8, unitCostKopecks: 4400, unitSellKopecks: 10000 });
    expect(buildLine(item({ quantity: 9 }), 0, [pm], stock, "msk").supplierName).toBe("Поставщик");
    expect(buildLine(item({ quantity: 5 }), 0, [pm], stock, "spb").supplierName).toBe("Поставщик");
  });

  it("сумма остатка округляется до 0,001", () => {
    const s = buildStockIndex([0.1, 0.2].map(q => ({ productName: "Сыр", qty: q })));
    expect(s.get("msk|сыр")?.qty).toBe(0.3);
    expect(round3(0.1 + 0.2)).toBe(0.3);
  });
});

describe("mergeLine", () => {
  const prev: SavedLine = { idx: 0, productName: "Сок", barcode: "460", qtyOrdered: 1, qtyPacked: 1,
    unitSellKopecks: 1, supplierName: "Ручной", supplierId: "x", unitCostKopecks: 7, sentToPurchase: true };
  const built = buildLine(item({ quantity: 3 }), 0, [pm], new Map(), "msk");

  it("ручные правки сохраняются, кол-во берётся из заказа", () => {
    expect(mergeLine(prev, item({ quantity: 3 }), built)).toMatchObject({ supplierName: "Ручной", qtyOrdered: 3, qtyPacked: 1 });
  });
  it("позицию заменили в заказе — строка строится заново", () => {
    expect(mergeLine(prev, item({ barcode: "999", quantity: 3 }), built).supplierName).toBe("Поставщик");
  });
});

describe("planShipment", () => {
  const order = { id: "o1", customerName: "Кафе", region: null, address: "г. Санкт-Петербург, Невский 1" };
  const line = (p: Partial<SavedLine>): SavedLine => ({ idx: 0, productName: "Сок", barcode: "460", qtyOrdered: 5,
    qtyPacked: 5, unitSellKopecks: 100, supplierName: "Склад", supplierId: "stock", unitCostKopecks: 40, sentToPurchase: true, ...p });

  it("списание: детерминированный id, регион кодом, себестоимость", () => {
    const p = planShipment(order, [line({}), line({ idx: 1, supplierName: "Поставщик" })], "u", "now");
    expect(p.stock).toEqual([{ id: "o1_0", data: expect.objectContaining({ qty: -5, region: "spb", costKopecks: 40, orderId: "o1" }) }]);
    expect(p.debt).toBeNull();
  });

  it("долг по недоупакованным незаменённым позициям", () => {
    const p = planShipment(order, [line({ qtyPacked: 3.3 }), line({ idx: 1, qtyPacked: 0, replaced: true })], "u", "now");
    expect(p.debt?.items).toEqual([expect.objectContaining({ qtyDebt: 1.7, qtyShipped: 3.3 })]);
  });
});

describe("addWorkDaysMsk", () => {
  it("день считается по Москве, а не по UTC", () => {
    // 2026-10-15T22:30Z — это уже пятница 16.10 в Москве → +3 раб. дня = ср 21.10
    expect(addWorkDaysMsk("2026-10-15T22:30:00Z", 3)).toBe("2026-10-21");
    expect(addWorkDaysMsk("2026-10-15T10:00:00Z", 3)).toBe("2026-10-20");
  });
});
