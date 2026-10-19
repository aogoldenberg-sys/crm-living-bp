// Один общий живой поток заказов на tenant: все потребители (useOrders, бейджи,
// phoneMap, клиенты, товары) читают отсюда вместо собственных onSnapshot.
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { collection, getDocs, onSnapshot, query, where, type Query } from "firebase/firestore";
import { db } from "../firebase";
import type { Order } from "./useOrders";

const LIVE_STATUSES = ["received", "approved", "sourcing", "invoiced", "ordered"];
const RECENT_DAYS = 30;
const ARCHIVE_TTL_MS = 10 * 60_000;

export interface OrdersState {
  orders: Order[];
  loading: boolean;
  error: string | null;
  /** Растёт, когда старый заказ ушёл из живого окна — архив надо перечитать. */
  archiveRev: number;
}

interface Channel { docs: Map<string, Order>; ready: boolean; error: string | null }

interface Feed {
  state: OrdersState;
  listeners: Set<() => void>;
  stop: () => void;
  reloadArchive: () => void;
}

const EMPTY: OrdersState = { orders: [], loading: true, error: null, archiveRev: 0 };
const feeds = new Map<string, Feed>();

// createdAt бывает ISO-строкой или Firestore Timestamp (старые записи)
function createdMs(v: unknown): number {
  if (typeof v === "string") return Date.parse(v) || 0;
  return (v as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;
}

export function sortByCreatedDesc(list: Order[]): Order[] {
  return list
    .map((o) => [createdMs(o.createdAt), o] as const)
    .sort((a, b) => b[0] - a[0])
    .map(([, o]) => o);
}

const toOrder = (d: { id: string; data: () => unknown }): Order =>
  ({ id: d.id, ...(d.data() as Omit<Order, "id">) });

// Подписка с повтором при ошибке. stop() закрывает именно текущую подписку
// и отменяет запланированный повтор (фикс утечки подписок при переподключении).
function listen(q: Query, ch: Channel, onRemoved: (id: string) => void, emit: () => void) {
  let unsub: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let stopped = false;

  const start = () => {
    let fresh = true;
    const u = onSnapshot(q, (snap) => {
      if (stopped) return;
      attempt = 0;
      if (fresh) { ch.docs = new Map(); fresh = false; }
      for (const c of snap.docChanges()) {
        if (c.type === "removed") { ch.docs.delete(c.doc.id); onRemoved(c.doc.id); }
        else ch.docs.set(c.doc.id, toOrder(c.doc));
      }
      ch.ready = true;
      ch.error = null;
      emit();
    }, (err) => {
      console.error("orders onSnapshot error:", err.code, err.message);
      if (stopped) return;
      attempt += 1;
      const delay = Math.min(5000 * attempt, 30000);
      ch.ready = true;
      ch.error = `Ошибка соединения (${err.code}). Повтор через ${delay / 1000}с…`;
      emit();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (unsub === u) unsub = null;
        u();
        start();
      }, delay);
    });
    unsub = u;
  };

  start();
  return () => {
    stopped = true;
    if (timer) { clearTimeout(timer); timer = null; }
    if (unsub) { unsub(); unsub = null; }
  };
}

function startFeed(businessId: string): Feed {
  const col = collection(db, `tenants/${businessId}/orders`);
  const since = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString();
  const active: Channel = { docs: new Map(), ready: false, error: null };
  const recent: Channel = { docs: new Map(), ready: false, error: null };
  let archiveRev = 0;

  const feed: Feed = { state: EMPTY, listeners: new Set(), stop: () => {}, reloadArchive: () => {} };
  const emit = () => {
    const merged = new Map(recent.docs);
    for (const [id, o] of active.docs) merged.set(id, o);
    feed.state = {
      orders: sortByCreatedDesc([...merged.values()]),
      loading: !active.ready || !recent.ready,
      error: active.error ?? recent.error,
      archiveRev,
    };
    feed.listeners.forEach((l) => l());
  };
  // Старый (>30 дн) заказ вышел из активных статусов: в архиве он устарел.
  const onActiveRemoved = (id: string) => {
    if (recent.docs.has(id)) return;
    archives.delete(businessId);
    archiveRev += 1;
  };

  // Сортировка на клиенте: составные индексы (status in + orderBy) не нужны.
  const stops = [
    listen(query(col, where("status", "in", LIVE_STATUSES)), active, onActiveRemoved, emit),
    listen(query(col, where("createdAt", ">=", since)), recent, () => {}, emit),
  ];
  feed.stop = () => stops.forEach((s) => s());
  feed.reloadArchive = () => { archives.delete(businessId); archiveRev += 1; emit(); };
  return feed;
}

/** Подписка с подсчётом ссылок: последний ушедший потребитель закрывает поток. */
export function subscribeOrders(businessId: string, listener: () => void): () => void {
  let feed = feeds.get(businessId);
  if (!feed) {
    feed = startFeed(businessId);
    feeds.set(businessId, feed);
  }
  const f = feed;
  f.listeners.add(listener);
  return () => {
    f.listeners.delete(listener);
    if (f.listeners.size === 0 && feeds.get(businessId) === f) {
      f.stop();
      feeds.delete(businessId);
    }
  };
}

export function getOrdersState(businessId: string): OrdersState {
  return feeds.get(businessId)?.state ?? EMPTY;
}

/** Живые заказы: активные статусы + всё созданное за последние 30 дней. */
export function useOrdersFeed(businessId: string): OrdersState {
  const subscribe = useCallback(
    (cb: () => void) => (businessId ? subscribeOrders(businessId, cb) : () => {}),
    [businessId],
  );
  return useSyncExternalStore(subscribe, () => getOrdersState(businessId));
}

// ── Архив: вся коллекция однократно (getDocs), с кэшем ──────────────────────

const archives = new Map<string, { at: number; p: Promise<Order[]> }>();

export function loadOrdersArchive(businessId: string): Promise<Order[]> {
  const hit = archives.get(businessId);
  if (hit && Date.now() - hit.at < ARCHIVE_TTL_MS) return hit.p;
  const p = getDocs(collection(db, `tenants/${businessId}/orders`)).then((s) => s.docs.map(toOrder));
  archives.set(businessId, { at: Date.now(), p });
  p.catch(() => { if (archives.get(businessId)?.p === p) archives.delete(businessId); });
  return p;
}

/**
 * После правки заказа: если он вне живого окна (старше 30 дней и не активный) —
 * архив перечитывается и потребители получают свежую версию. Без orderIds — всегда.
 */
export function invalidateOrdersArchive(businessId: string, orderIds?: string[]): void {
  const feed = feeds.get(businessId);
  const live = new Set(feed?.state.orders.map((o) => o.id));
  if (orderIds && orderIds.every((id) => live.has(id))) return;
  if (feed) feed.reloadArchive();
  else archives.delete(businessId);
}

/** null — архив ещё грузится (или выключен). */
export function useOrdersArchive(businessId: string, enabled: boolean, rev: number): Order[] | null {
  const [list, setList] = useState<Order[] | null>(null);
  useEffect(() => {
    if (!enabled || !businessId) return;
    let alive = true;
    loadOrdersArchive(businessId).then(
      (l) => { if (alive) setList(l); },
      (e) => { console.error("loadOrdersArchive:", e); if (alive) setList([]); },
    );
    return () => { alive = false; };
  }, [businessId, enabled, rev]);
  return enabled ? list : null;
}

/** Архив + живые; живая версия заказа главнее архивной. */
export function withArchive(live: Order[], archive: Order[]): Order[] {
  const byId = new Map(archive.map((o) => [o.id, o]));
  for (const o of live) byId.set(o.id, o);
  return sortByCreatedDesc([...byId.values()]);
}

/** Только для тестов. */
export function _resetOrdersArchive(): void {
  archives.clear();
}
