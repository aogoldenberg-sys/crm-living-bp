import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

// ── Firestore mock ────────────────────────────────────────────────────────────
type MockDoc = { id: string; data: () => unknown };
type SnapCb = (snap: { docs: MockDoc[]; docChanges: () => { type: string; doc: MockDoc }[] }) => void;
type ErrCb = (err: { code: string; message: string }) => void;
const subs: { q: { kind: string }; next: SnapCb; error: ErrCb; unsub: ReturnType<typeof vi.fn> }[] = [];
let archiveDocs: MockDoc[] = [];

vi.mock("../firebase", () => ({ db: {} }));
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(() => ({})),
  query: vi.fn((_c: unknown, w?: { kind: string }) => ({ kind: w?.kind ?? "all" })),
  orderBy: vi.fn(() => ({})),
  where: vi.fn((field: string) => ({ kind: field })),
  getDocs: vi.fn(async () => ({ docs: archiveDocs })),
  onSnapshot: vi.fn((q: { kind: string }, next: SnapCb, error: ErrCb) => {
    const unsub = vi.fn();
    subs.push({ q, next, error, unsub });
    return unsub;
  }),
}));

import {
  normalizeBarcode, buildPricelistLookup, loadPricelist, _resetPricelistCache,
  useOrders, usePricelistLookup, type Order, type OrderItem,
} from "./useOrders";
import { _resetOrdersArchive, invalidateOrdersArchive } from "./ordersStore";

type Pl = Awaited<ReturnType<typeof loadPricelist>>[number];
const pl = (p: Partial<Pl>): Pl => ({
  sid: "s1", sname: "Поставщик", name: "Товар", barcode: null, sku: null,
  price: 10000, quant: null, note: null, ...p,
});
const item = (p: Partial<OrderItem>): OrderItem => ({
  productId: "", productName: "", quantity: 1, unitPrice: 0, totalKopecks: 0, supplierId: null, ...p,
});

// ── normalizeBarcode ──────────────────────────────────────────────────────────
describe("normalizeBarcode", () => {
  it("строка и число дают один ключ", () => {
    expect(normalizeBarcode("4607007729208")).toBe("4607007729208");
    expect(normalizeBarcode(4607007729208)).toBe("4607007729208");
  });
  it("убирает пробелы, NBSP, апостроф, хвост .0", () => {
    expect(normalizeBarcode(" 4607 0077 29208 ")).toBe("4607007729208");
    expect(normalizeBarcode("'4607007729208")).toBe("4607007729208");
    expect(normalizeBarcode("4607007729208.0")).toBe("4607007729208");
  });
  it("ведущие нули: UPC-12 / EAN-13 / GTIN-14 / EAN-8 совпадают", () => {
    const k = normalizeBarcode("012345678905");
    expect(normalizeBarcode("0012345678905")).toBe(k);
    expect(normalizeBarcode("00012345678905")).toBe(k);
    expect(normalizeBarcode("12345678905")).toBe(k);
    expect(normalizeBarcode("00000040170725")).toBe(normalizeBarcode("40170725"));
  });
  it("разворачивает научную нотацию", () => {
    expect(normalizeBarcode("4.6e12")).toBe("4600000000000");
    expect(normalizeBarcode("4,607007729208E+12")).toBe("4607007729208");
    expect(normalizeBarcode(4.6e12)).toBe("4600000000000");
  });
  it("пустые значения → null; артикул в upper-case", () => {
    expect(normalizeBarcode(null)).toBeNull();
    expect(normalizeBarcode(undefined)).toBeNull();
    expect(normalizeBarcode("  ")).toBeNull();
    expect(normalizeBarcode("000")).toBeNull();
    expect(normalizeBarcode(0)).toBeNull();
    expect(normalizeBarcode(" ab 12 ")).toBe("AB12");
  });
});

// ── buildPricelistLookup ──────────────────────────────────────────────────────
describe("buildPricelistLookup", () => {
  const list = [
    pl({ sid: "a", sname: "A", name: "Сок яблочный", barcode: 4607007729208 as unknown as string }),
    pl({ sid: "b", sname: "B", name: "Сок яблочный", barcode: "04607007729208" }),
    pl({ sid: "c", sname: "C", name: "Кетчуп томатный", barcode: null, sku: "KT-100" }),
    pl({ sid: "d", sname: "D", name: "Шоколад молочный", barcode: "4600000000001" }),
  ];

  it("находит по штрихкоду несмотря на число/ведущий ноль/пробелы; читается по item.barcode", () => {
    const it1 = item({ barcode: " 4607007729208", productName: "Сок яблоч. 1л" });
    const m = buildPricelistLookup(list, [it1]);
    const got = m.get(it1.barcode!);
    expect(got?.map((x) => x.supplierId).sort()).toEqual(["a", "b"]);
    expect(m.get(it1.productName)).toBe(got);
    expect(got?.[0].barcode).toBe("4607007729208"); // barcode в результате — строка
  });

  it("запасной вариант: productId = штрихкод/артикул прайса, читается по productName", () => {
    const it1 = item({ productId: "kt-100", productName: "Кетчуп" });
    const m = buildPricelistLookup(list, [it1]);
    expect(m.get("Кетчуп")?.[0].supplierId).toBe("c");
    const it2 = item({ productId: "4600000000001", productName: "Шоколадка" });
    expect(buildPricelistLookup(list, [it2]).get("Шоколадка")?.[0].supplierId).toBe("d");
  });

  it("поиск по названию, если кода нет", () => {
    const it1 = item({ productName: "Шоколад молочный 90г" });
    expect(buildPricelistLookup(list, [it1]).get(it1.productName)?.[0].supplierId).toBe("d");
  });
});

// ── loadPricelist ─────────────────────────────────────────────────────────────
describe("loadPricelist", () => {
  beforeEach(() => { _resetPricelistCache(); vi.restoreAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("при ошибке не кэширует пустой результат и повторяет загрузку", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [pl({ name: "X" })] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await loadPricelist()).toEqual([]);
    expect(warn).toHaveBeenCalled();
    const second = await loadPricelist();
    expect(second).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(`${import.meta.env.BASE_URL}pricelist.json`);
    await loadPricelist();
    expect(fetchMock).toHaveBeenCalledTimes(2); // успешный результат кэшируется
  });
});

// ── usePricelistLookup ────────────────────────────────────────────────────────
describe("usePricelistLookup", () => {
  beforeEach(() => {
    _resetPricelistCache();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [
        pl({ sid: "a", sname: "A", barcode: "111" }),
        pl({ sid: "b", sname: "B", barcode: "222" }),
      ],
    }), { status: 200 })));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("пересчитывает при замене позиции при том же количестве", async () => {
    const { result, rerender } = renderHook(({ items }) => usePricelistLookup("t", items), {
      initialProps: { items: [item({ barcode: "111", productName: "P1" })] },
    });
    await waitFor(() => expect(result.current.get("111")?.[0].supplierId).toBe("a"));
    rerender({ items: [item({ barcode: "222", productName: "P2" })] });
    await waitFor(() => expect(result.current.get("222")?.[0].supplierId).toBe("b"));
    expect(result.current.get("111")).toBeUndefined();
  });
});

// ── useOrders / общий поток ───────────────────────────────────────────────────
const mk = (id: string, p: Partial<Order>): MockDoc => ({ id, data: () => ({ customerName: id, createdAt: "", ...p }) });
const added = (docs: MockDoc[]) => ({ docs, docChanges: () => docs.map((doc) => ({ type: "added", doc })) });
const feed = (kind: string) => subs.filter((x) => x.q.kind === kind).at(-1)!;

describe("useOrders: общий поток", () => {
  beforeEach(() => { subs.length = 0; archiveDocs = []; _resetOrdersArchive(); });

  it("несколько потребителей — одна пара подписок; отписка с последним", () => {
    const a = renderHook(() => useOrders("t", "sales", "u"));
    const b = renderHook(() => useOrders("t", "purchasing", "u"));
    expect(subs).toHaveLength(2);
    a.unmount();
    expect(subs.every((x) => x.unsub.mock.calls.length === 0)).toBe(true);
    b.unmount();
    expect(subs.every((x) => x.unsub.mock.calls.length === 1)).toBe(true);
  });

  it("объединяет активные и недавние по id, сортирует createdAt desc, assembly — только sourcing", () => {
    const sales = renderHook(() => useOrders("t", "sales", "u"));
    const asm = renderHook(() => useOrders("t", "assembly", "u"));
    expect(sales.result.current.loading).toBe(true);
    act(() => {
      feed("status").next(added([mk("a", { status: "sourcing", createdAt: "2026-01-01T00:00:00Z" })]));
      feed("createdAt").next(added([
        mk("a", { status: "sourcing", createdAt: "2026-01-01T00:00:00Z" }),
        mk("b", { status: "delivered", createdAt: "2026-02-01T00:00:00Z" }),
      ]));
    });
    expect(sales.result.current.loading).toBe(false);
    expect(sales.result.current.orders.map((o) => o.id)).toEqual(["b", "a"]);
    expect(asm.result.current.orders.map((o) => o.id)).toEqual(["a"]);
    sales.unmount(); asm.unmount();
  });

  it("archive: true подмешивает архив, живая версия главнее", async () => {
    archiveDocs = [mk("old", { status: "delivered", createdAt: "2025-01-01T00:00:00Z" }), mk("a", { status: "received" })];
    const { result, unmount } = renderHook(() => useOrders("t", "sales", "u", { archive: true }));
    act(() => {
      feed("status").next(added([mk("a", { status: "approved", createdAt: "2026-01-01T00:00:00Z" })]));
      feed("createdAt").next(added([]));
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.orders.map((o) => [o.id, o.status])).toEqual([["a", "approved"], ["old", "delivered"]]);
    unmount();
  });

  it("invalidateOrdersArchive: правка старого заказа перечитывает архив, живого — нет", async () => {
    archiveDocs = [mk("old", { status: "delivered", paid: false, createdAt: "2025-01-01T00:00:00Z" })];
    const { result, unmount } = renderHook(() => useOrders("t", "finance", "u"));
    act(() => {
      feed("status").next(added([mk("a", { status: "approved", createdAt: "2026-01-01T00:00:00Z" })]));
      feed("createdAt").next(added([]));
    });
    await waitFor(() => expect(result.current.orders.find((o) => o.id === "old")).toBeTruthy());
    archiveDocs = [mk("old", { status: "delivered", paid: true, createdAt: "2025-01-01T00:00:00Z" })];
    act(() => invalidateOrdersArchive("t", ["a"]));
    expect(result.current.orders.find((o) => o.id === "old")?.paid).toBe(false);
    act(() => invalidateOrdersArchive("t", ["old"]));
    await waitFor(() => expect(result.current.orders.find((o) => o.id === "old")?.paid).toBe(true));
    unmount();
  });
});

describe("useOrders reconnect", () => {
  beforeEach(() => { subs.length = 0; vi.useFakeTimers(); vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("cleanup закрывает актуальную подписку после переподключения", () => {
    const { result, unmount } = renderHook(() => useOrders("t", "sales", "u"));
    expect(subs).toHaveLength(2);
    const first = feed("status");
    act(() => { first.error({ code: "unavailable", message: "x" }); });
    expect(result.current.error).toMatch(/unavailable/);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(subs).toHaveLength(3);
    expect(first.unsub).toHaveBeenCalledTimes(1);
    unmount();
    expect(subs.every((x) => x.unsub.mock.calls.length === 1)).toBe(true);
  });

  it("после размонтирования повторная подписка не создаётся", () => {
    const { unmount } = renderHook(() => useOrders("t", "sales", "u"));
    act(() => { subs[0].error({ code: "unavailable", message: "x" }); });
    unmount();
    act(() => { vi.advanceTimersByTime(60000); });
    expect(subs).toHaveLength(2);
    expect(subs.every((x) => x.unsub.mock.calls.length === 1)).toBe(true);
  });
});
