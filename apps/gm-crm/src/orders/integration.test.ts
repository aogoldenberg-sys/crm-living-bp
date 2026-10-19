// Сквозные проверки после слияния веток: одна логика кол-ва/цены/региона для склада, финансов и УПД.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../firebase", () => ({ auth: { currentUser: { getIdToken: async () => "tok" } }, db: {} }));

import { itemQty, orderItemToUpd, splitVat } from "./money";
import { itemQty as stockItemQty, buildLine, buildStockIndex } from "./stockOps";
import { matchesRegion } from "./region";
import { directorStats } from "./directorStats";
import type { OrderItem } from "./useOrders";

// Заказ НаПолке: qty вместо quantity, unitPrice в рублях, totalKopecks верный
const napolke = { productId: "", productName: "Сыр", qty: 3, unitPrice: 4066.67, totalKopecks: 1220000, supplierId: null } as unknown as OrderItem;

describe("кол-во и цена — одна функция для склада, финансов и УПД", () => {
  it("itemQty из stockOps — та же функция, что в money", () => {
    expect(stockItemQty).toBe(itemQty);
    expect(itemQty({ qty: "2" as unknown as number })).toBe(2);
    expect(itemQty({ quantity: NaN })).toBe(0);
  });

  it("УПД НаПолке 12 200 ₽: итог из заказа, НДС 2 200", () => {
    const row = orderItemToUpd(napolke);
    expect(row.qty).toBe(3);
    expect(row.totalKopecks).toBe(1220000);
    const s = splitVat([row.totalKopecks]);
    expect(s.vat).toBe(220000);
    expect(s.net).toBe(1000000);
  });

  it("сборка берёт ту же цену продажи (коп.), что УПД", () => {
    const l = buildLine(napolke, 0, [], buildStockIndex([]), "msk");
    expect(l.qtyOrdered).toBe(3);
    expect(l.unitSellKopecks).toBe(Math.round(orderItemToUpd(napolke).price * 100));
  });
});

describe("регион: латиница и кириллица одинаково", () => {
  it("долг/клиент с region 'spb' попадает в фильтр СПб", () => {
    expect(matchesRegion({ region: "spb" }, "spb")).toBe(true);
    expect(matchesRegion({ region: "Санкт-Петербург" }, "spb")).toBe(true);
    expect(matchesRegion({ region: null, address: "г. Санкт-Петербург, Невский 1" }, "spb")).toBe(true);
    expect(matchesRegion({ region: "msk" }, "spb")).toBe(false);
  });

  it("сводная: оплата из выписки по paidAt, регион «Санкт-Петербург»", () => {
    const now = new Date("2026-10-15T12:00:00Z");
    const s = directorStats([{
      id: "o1", status: "delivered", totalKopecks: 1220000, region: "Санкт-Петербург",
      paid: true, paidAt: "2026-10-02T09:00:00Z", createdAt: "2026-08-01T00:00:00Z", deliveredAt: "2026-10-03T00:00:00Z",
    }], () => 900000, now);
    expect(s.spb.revenue).toBe(1220000);
    expect(s.spb.profit).toBe(320000);
    expect(s.spb.shipped).toBe(1220000);
    expect(s.msk.revenue).toBe(0);
  });
});

describe("Bearer-токен только под флагом VITE_SEND_ID_TOKEN", () => {
  beforeEach(() => { vi.resetModules(); vi.unstubAllEnvs(); });

  it("по умолчанию заголовок не отправляется (CORS серверов ещё не обновлён)", async () => {
    const { authHeader, SEND_ID_TOKEN } = await import("./idToken");
    expect(SEND_ID_TOKEN).toBe(false);
    expect(await authHeader()).toEqual({});
  });

  it("VITE_SEND_ID_TOKEN=1 — Authorization: Bearer", async () => {
    vi.stubEnv("VITE_SEND_ID_TOKEN", "1");
    const { authHeader } = await import("./idToken");
    expect(await authHeader()).toEqual({ Authorization: "Bearer tok" });
  });
});
