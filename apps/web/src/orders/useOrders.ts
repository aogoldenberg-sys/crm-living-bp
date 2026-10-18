import { useEffect, useState } from "react";
import {
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
} from "firebase/firestore";
import { db } from "../firebase";

export type OrderStatus =
  | "received"
  | "approved"
  | "assembly"
  | "delivered"
  | "cancelled";

export type OrderSource = "napolke" | "shop" | "manual";

export interface OrderItem {
  name: string;
  qty: number;
  priceKopecks: number;
}

export interface Order {
  id: string;
  clientName: string;
  status: OrderStatus;
  source: OrderSource;
  totalKopecks: number;
  createdAt: string;
  managerId: string;
  items: OrderItem[];
  paid?: boolean;
  address?: string;
  phone?: string;
  comment?: string;
}

export interface Client {
  id: string;
  name: string;
  legalType: "ip" | "ooo" | "ao" | "other";
  phone: string;
  email: string;
  tradePoints: string[];
}

export interface PurchaseOrder {
  id: string;
  orderId: string;
  supplierId: string;
  supplierName?: string;
  status: "draft" | "sent" | "confirmed" | "delivered";
  items: OrderItem[];
  expectedDate?: string;
  createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function statusLabel(status: OrderStatus): string {
  const labels: Record<OrderStatus, string> = {
    received: "Получен",
    approved: "Одобрен",
    assembly: "Сборка",
    delivered: "Отгружен",
    cancelled: "Отменён",
  };
  return labels[status];
}

export function statusColor(status: OrderStatus): string {
  const colors: Record<OrderStatus, string> = {
    received: "#1565C0",
    approved: "#E65100",
    assembly: "#6A1B9A",
    delivered: "#2E7D32",
    cancelled: "#757575",
  };
  return colors[status];
}

export function fmtRub(kopecks: number): string {
  return (kopecks / 100).toLocaleString("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  });
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

type RoleId = "sales" | "assembly" | "purchasing" | "finance" | "director";

export function useOrders(
  businessId: string,
  roleId: RoleId,
  userId: string
): { orders: Order[]; loading: boolean } {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) return;
    const col = collection(db, `tenants/${businessId}/orders`);

    let q;
    if (roleId === "sales") {
      q = query(col, where("managerId", "==", userId), orderBy("createdAt", "desc"));
    } else if (roleId === "assembly") {
      q = query(
        col,
        where("status", "in", ["approved", "assembly"]),
        orderBy("createdAt", "desc")
      );
    } else {
      // purchasing, finance, director — see all
      q = query(col, orderBy("createdAt", "desc"));
    }

    const unsub = onSnapshot(q, (snap) => {
      setOrders(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Order, "id">) }))
      );
      setLoading(false);
    });
    return () => unsub();
  }, [businessId, roleId, userId]);

  return { orders, loading };
}

export function useClients(businessId: string): { clients: Client[]; loading: boolean } {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) return;
    const unsub = onSnapshot(
      collection(db, `tenants/${businessId}/clients`),
      (snap) => {
        setClients(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Client, "id">) }))
        );
        setLoading(false);
      }
    );
    return () => unsub();
  }, [businessId]);

  return { clients, loading };
}

export function usePurchaseOrders(
  businessId: string
): { purchaseOrders: PurchaseOrder[]; loading: boolean } {
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) return;
    const q = query(
      collection(db, `tenants/${businessId}/purchase_orders`),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setPurchaseOrders(
        snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<PurchaseOrder, "id">),
        }))
      );
      setLoading(false);
    });
    return () => unsub();
  }, [businessId]);

  return { purchaseOrders, loading };
}
