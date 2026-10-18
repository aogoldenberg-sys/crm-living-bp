import type { Order, PurchaseOrder, PurchaseOrderItem } from "@crm/schemas";

/**
 * Разбивает заказ клиента на наряды поставщикам.
 * Группирует позиции по supplierId. Позиции без поставщика пропускаются.
 *
 * @param order — заказ с enriched items (после sourcing)
 * @param supplierNames — маппинг supplierId → displayName
 * @param genId — генератор UUID
 * @param now — ISO timestamp
 */
export function splitOrder(
  order: Order,
  supplierNames: Map<string, string>,
  genId: () => string,
  now: string,
): PurchaseOrder[] {
  const groups = new Map<string, PurchaseOrderItem[]>();

  for (const item of order.items) {
    if (!item.supplierId || item.purchasePrice == null) continue;
    const list = groups.get(item.supplierId) ?? [];
    list.push({
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      priceKopecks: item.purchasePrice,
    });
    groups.set(item.supplierId, list);
  }

  const result: PurchaseOrder[] = [];

  for (const [supplierId, items] of groups) {
    const totalKopecks = items.reduce(
      (sum, i) => sum + i.priceKopecks * i.quantity,
      0,
    );

    result.push({
      poId: genId(),
      orderId: order.orderId,
      supplierId,
      supplierName: supplierNames.get(supplierId) ?? supplierId,
      items,
      totalKopecks,
      status: "draft",
      editedBy: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  return result;
}
