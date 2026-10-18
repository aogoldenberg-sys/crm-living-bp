import type { Db } from "../db.js";
import type { Order, PurchaseOrder, OrderStageChanged, PurchaseOrderEdited } from "@crm/schemas";
import { Order as OrderSchema, PurchaseOrder as POSchema } from "@crm/schemas";
import { type Result, ok, err } from "@crm/core";

const col = (db: Db, biz: string, name: string) =>
  db.collection(`tenants/${biz}/${name}`);

export async function saveOrder(
  db: Db,
  businessId: string,
  order: Order,
): Promise<Result<void>> {
  try {
    await col(db, businessId, "orders")
      .doc(order.orderId)
      .set(order as unknown as Record<string, unknown>);
    return ok(undefined);
  } catch (e) {
    return err({ code: "STORAGE_ERROR", message: String(e) });
  }
}

export async function loadOrder(
  db: Db,
  businessId: string,
  orderId: string,
): Promise<Result<Order | null>> {
  try {
    const snap = await col(db, businessId, "orders").doc(orderId).get();
    if (!snap.exists) return ok(null);
    const p = OrderSchema.safeParse(snap.data());
    if (!p.success) {
      console.warn(`[gustoriko] invalid order id=${orderId}`, p.error.issues);
      return ok(null);
    }
    return ok(p.data);
  } catch (e) {
    return err({ code: "STORAGE_ERROR", message: String(e) });
  }
}

export async function loadOrders(
  db: Db,
  businessId: string,
  stage?: string,
): Promise<Result<Order[]>> {
  try {
    let query = col(db, businessId, "orders").orderBy("createdAt", "desc");
    if (stage) {
      query = query.where("stage", "==", stage);
    }
    const snap = await query.get();
    const orders: Order[] = [];
    for (const doc of snap.docs) {
      const p = OrderSchema.safeParse(doc.data());
      if (!p.success) {
        console.warn(`[gustoriko] invalid order id=${doc.id}`, p.error.issues);
        continue;
      }
      orders.push(p.data);
    }
    return ok(orders);
  } catch (e) {
    return err({ code: "STORAGE_ERROR", message: String(e) });
  }
}

export async function savePurchaseOrder(
  db: Db,
  businessId: string,
  po: PurchaseOrder,
): Promise<Result<void>> {
  try {
    await col(db, businessId, "purchase_orders")
      .doc(po.poId)
      .set(po as unknown as Record<string, unknown>);
    return ok(undefined);
  } catch (e) {
    return err({ code: "STORAGE_ERROR", message: String(e) });
  }
}

export async function loadPurchaseOrders(
  db: Db,
  businessId: string,
  orderId: string,
): Promise<Result<PurchaseOrder[]>> {
  try {
    const snap = await col(db, businessId, "purchase_orders")
      .where("orderId", "==", orderId)
      .get();
    const pos: PurchaseOrder[] = [];
    for (const doc of snap.docs) {
      const p = POSchema.safeParse(doc.data());
      if (!p.success) {
        console.warn(`[gustoriko] invalid PO id=${doc.id}`, p.error.issues);
        continue;
      }
      pos.push(p.data);
    }
    return ok(pos);
  } catch (e) {
    return err({ code: "STORAGE_ERROR", message: String(e) });
  }
}

export async function saveOrderEvent(
  db: Db,
  businessId: string,
  event: OrderStageChanged | PurchaseOrderEdited,
): Promise<Result<void>> {
  try {
    await col(db, businessId, "events")
      .doc(event.eventId)
      .set(event as unknown as Record<string, unknown>);
    return ok(undefined);
  } catch (e) {
    return err({ code: "STORAGE_ERROR", message: String(e) });
  }
}
