import { describe, it, expect } from "vitest";
import { directorStats, orderCost, type StatOrder } from "./directorStats";

const now = new Date(2026, 9, 19);
const inMonth = new Date(2026, 9, 5).toISOString();
const prevMonth = new Date(2026, 8, 20).toISOString();

const o = (p: Partial<StatOrder>): StatOrder => ({ id: "x", status: "approved", totalKopecks: 10000, createdAt: inMonth, ...p });

describe("сводная: регион", () => {
  it("«Москва»/«Санкт-Петербург», адрес СПб без тега", () => {
    const s = directorStats([
      o({ id: "1", region: "Москва", paid: true, paidAt: inMonth }),
      o({ id: "2", region: "Санкт-Петербург", paid: true, paidAt: inMonth }),
      o({ id: "3", region: null, address: "г. Санкт-Петербург, Невский 1", paid: true, paidAt: inMonth }),
      o({ id: "4", region: "spb", paid: true, paidAt: inMonth }),
      o({ id: "5", paid: true, paidAt: inMonth }),
    ], () => null, now);
    expect(s.msk.paidCount).toBe(2);
    expect(s.spb.paidCount).toBe(3);
  });
});

describe("сводная: выручка и отгрузка", () => {
  it("выручка — оплаченные по paidAt в месяце; отменённые не считаются", () => {
    const s = directorStats([
      o({ id: "1", paid: true, paidAt: inMonth, createdAt: prevMonth }),
      o({ id: "2", paid: true, paidAt: prevMonth }),
      o({ id: "3", paid: false }),
      o({ id: "4", paid: true, paidAt: inMonth, status: "cancelled" }),
      o({ id: "5", paid: true, createdAt: inMonth }),               // старый без paidAt
    ], () => null, now);
    expect(s.msk.revenue).toBe(20000);
    expect(s.msk.paidCount).toBe(2);
  });

  it("отгрузка — delivered по deliveredAt, затем updatedAt/createdAt", () => {
    const s = directorStats([
      o({ id: "1", status: "delivered", deliveredAt: inMonth, createdAt: prevMonth }),
      o({ id: "2", status: "delivered", deliveredAt: prevMonth }),
      o({ id: "3", status: "delivered", updatedAt: inMonth, createdAt: prevMonth }),
      o({ id: "4", status: "approved", deliveredAt: inMonth }),
    ], () => null, now);
    expect(s.msk.shippedCount).toBe(2);
    expect(s.msk.shipped).toBe(20000);
    expect(s.msk.revenue).toBe(0);
  });
});

describe("сводная: прибыль", () => {
  it("без себестоимости — не 100% прибыли, а счётчик", () => {
    const costs: Record<string, number | null> = { "1": 6000, "2": null };
    const s = directorStats([
      o({ id: "1", paid: true, paidAt: inMonth }),
      o({ id: "2", paid: true, paidAt: inMonth }),
    ], (id) => costs[id], now);
    expect(s.msk.revenue).toBe(20000);
    expect(s.msk.profit).toBe(4000);
    expect(s.msk.costedRevenue).toBe(10000);
    expect(s.msk.noCostCount).toBe(1);
  });
  it("ни у одного заказа нет себестоимости → profit null", () => {
    const s = directorStats([o({ paid: true, paidAt: inMonth })], () => null, now);
    expect(s.msk.profit).toBeNull();
  });

  it("orderCost: сборка, затем purchase_lines, иначе null", () => {
    expect(orderCost([{ qtyPacked: 2, unitCostKopecks: 500 }, { qtyPacked: 0, unitCostKopecks: 0 }], 999)).toBe(1000);
    expect(orderCost([{ qtyPacked: 2, unitCostKopecks: 500 }, { qtyPacked: 1, unitCostKopecks: 0 }], 999)).toBe(999);
    expect(orderCost([{ qtyPacked: 1.5, unitCostKopecks: 333 }], undefined)).toBe(500);
    expect(orderCost(undefined, undefined)).toBeNull();
    expect(orderCost([{ qtyPacked: 1, unitCostKopecks: 0 }], 0)).toBeNull();
  });
});
