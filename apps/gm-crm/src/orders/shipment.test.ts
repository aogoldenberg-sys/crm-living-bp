import { describe, it, expect, vi, beforeEach } from "vitest";

// ── In-memory Firestore ──────────────────────────────────────────────────────
type Data = Record<string, unknown>;
const store = new Map<string, Data>();
const DEL = Symbol("deleteField");
const snap = (path: string) => ({ exists: () => store.has(path), data: () => store.get(path), ref: { path } });
const applyPatch = (path: string, patch: Data, base: Data = store.get(path) ?? {}) => {
  const next = { ...base };
  for (const [k, v] of Object.entries(patch)) { if (v === DEL) delete next[k]; else next[k] = v; }
  store.set(path, next);
};

vi.mock("../firebase", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, path: string) => ({ path }),
  collection: (_db: unknown, path: string) => ({ path }),
  where: (field: string, _op: string, val: unknown) => ({ field, val }),
  query: (col: { path: string }, ...w: { field: string; val: unknown }[]) => ({ path: col.path, w }),
  deleteField: () => DEL,
  getDoc: async (ref: { path: string }) => snap(ref.path),
  getDocs: async (q: { path: string; w?: { field: string; val: unknown }[] }) => ({
    docs: [...store.keys()]
      .filter(p => p.startsWith(q.path + "/") && !p.slice(q.path.length + 1).includes("/"))
      .filter(p => (q.w ?? []).every(c => store.get(p)?.[c.field] === c.val))
      .map(snap),
  }),
  runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({
    get: async (ref: { path: string }) => snap(ref.path),
    set: (ref: { path: string }, d: Data, o?: { merge?: boolean }) => applyPatch(ref.path, d, o?.merge ? undefined : {}),
    update: (ref: { path: string }, d: Data) => applyPatch(ref.path, d),
    delete: (ref: { path: string }) => store.delete(ref.path),
  }),
  writeBatch: () => {
    const ops: (() => void)[] = [];
    return { update: (ref: { path: string }, d: Data) => ops.push(() => applyPatch(ref.path, d)), commit: async () => ops.forEach(f => f()) };
  },
}));
vi.mock("./useOrders", async (orig) => ({ ...(await orig<typeof import("./useOrders")>()), loadPricelist: async () => [] }));

import { shipOrder, unshipOrder, linesForShipment, ensureDeliveryDate } from "./shipment";
import { buildStockIndex, type StockRow } from "./stockOps";
import type { Order } from "./useOrders";

const T = "tenants/b";
const order = {
  id: "o1", customerName: "Кафе", status: "sourcing", source: "napolke", totalKopecks: 50000, createdAt: "", managerId: "",
  region: "Санкт-Петербург",
  items: [{ productId: "p", productName: "Сок", barcode: "460", qty: 5, totalKopecks: 50000, unitPrice: 100, supplierId: null }],
} as unknown as Order;
const stockRows = () => [...store.entries()].filter(([p]) => p.startsWith(`${T}/stock/`)).map(([, d]) => d as unknown as StockRow);
const balance = (region: "msk" | "spb") => buildStockIndex(stockRows()).get(`${region}|460`)?.qty ?? 0;

beforeEach(() => {
  store.clear();
  store.set(`${T}/orders/o1`, { status: "sourcing", deliveryDate: "" });
  store.set(`${T}/stock/in1`, { productName: "Сок", barcode: "460", qty: 10, costKopecks: 6000, region: "spb" });
  store.set(`${T}/stock/in2`, { productName: "Сок", barcode: "460", qty: 10, costKopecks: 1000, region: "Москва" });
  store.set(`${T}/purchase_lines/pl1`, { orderId: "o1", status: "ordered" });
});

describe("отгрузка", () => {
  it("строки без сохранённой сборки строятся как в карточке: qty вместо quantity, склад региона, средняя цена", async () => {
    const lines = await linesForShipment("b", order, [4]);
    expect(lines).toEqual([expect.objectContaining({ supplierName: "Склад", qtyOrdered: 5, qtyPacked: 4, unitCostKopecks: 6000 })]);
  });

  it("повторная отгрузка не списывает дважды", async () => {
    const lines = await linesForShipment("b", order, [4]);
    expect(await shipOrder("b", order, lines, "u")).toBe(true);
    expect(await shipOrder("b", order, lines, "u")).toBe(false);
    expect(balance("spb")).toBe(6);
    expect(balance("msk")).toBe(10);
    expect(store.get(`${T}/orders/o1`)).toMatchObject({ status: "delivered", stockWrittenOff: true, stockWriteoffIds: ["o1_0"] });
    expect(store.get(`${T}/debts/o1`)).toMatchObject({ items: [expect.objectContaining({ qtyDebt: 1 })] });
    expect(store.get(`${T}/assembly/o1`)).toMatchObject({ lines: [expect.objectContaining({ qtyPacked: 4 })] });
    expect(store.get(`${T}/purchase_lines/pl1`)).toEqual({ orderId: "o1", status: "shipped", statusBeforeShip: "ordered" });
  });

  it("«Не отгружен» возвращает остаток, снимает долг и возвращает закупку", async () => {
    await shipOrder("b", order, await linesForShipment("b", order, [4]), "u");
    expect(await unshipOrder("b", "o1")).toBe(true);
    expect(balance("spb")).toBe(10);
    expect(store.has(`${T}/debts/o1`)).toBe(false);
    expect(store.get(`${T}/orders/o1`)).toMatchObject({ status: "sourcing", stockWrittenOff: false });
    expect(store.get(`${T}/orders/o1`)).not.toHaveProperty("deliveredAt");
    expect(store.get(`${T}/purchase_lines/pl1`)).toEqual({ orderId: "o1", status: "ordered" });
    // и снова можно отгрузить — без дублей
    await shipOrder("b", order, await linesForShipment("b", order, [5]), "u");
    expect(balance("spb")).toBe(5);
  });

  it("досборка долга перезаписывает списание, а не добавляет второе", async () => {
    await shipOrder("b", order, await linesForShipment("b", order, [4]), "u");
    store.set(`${T}/orders/o1`, { ...store.get(`${T}/orders/o1`), status: "sourcing" }); // Долги → «В сборку»
    await shipOrder("b", order, await linesForShipment("b", order, [5]), "u");
    expect(balance("spb")).toBe(5);
    expect(store.has(`${T}/debts/o1`)).toBe(false);
  });
});

describe("ensureDeliveryDate", () => {
  it("не трогает ручную дату", async () => {
    await ensureDeliveryDate("b", "o1", "2026-10-21");
    expect(store.get(`${T}/orders/o1`)?.deliveryDate).toBe("2026-10-21");
    await ensureDeliveryDate("b", "o1", "2026-11-01");
    expect(store.get(`${T}/orders/o1`)?.deliveryDate).toBe("2026-10-21");
  });
});
