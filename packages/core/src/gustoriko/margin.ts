import type { OrderLineItem, MarginAnalysis, MarginItem } from "@crm/schemas";

/**
 * Рассчитывает маржинальность заказа. Все суммы в копейках.
 * Позиции без purchasePrice/supplierId пропускаются.
 */
export function calculateMargin(
  orderId: string,
  items: OrderLineItem[],
  now: string,
): MarginAnalysis {
  const perItem: MarginItem[] = [];
  let totalRevenue = 0;
  let totalCost = 0;

  for (const item of items) {
    if (item.purchasePrice == null || item.supplierId == null) continue;

    const revenue = item.sellPrice * item.quantity;
    const cost = item.purchasePrice * item.quantity;
    const itemMargin = revenue - cost;
    const itemMarginPct = revenue > 0
      ? Math.round((itemMargin / revenue) * 10000) / 100
      : 0;

    perItem.push({
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      sellPrice: item.sellPrice,
      purchasePrice: item.purchasePrice,
      itemMargin,
      itemMarginPct,
      supplierId: item.supplierId,
    });

    totalRevenue += revenue;
    totalCost += cost;
  }

  const grossMargin = totalRevenue - totalCost;
  const grossMarginPct = totalRevenue > 0
    ? Math.round((grossMargin / totalRevenue) * 10000) / 100
    : 0;

  return {
    orderId,
    totalRevenue,
    totalCost,
    grossMargin,
    grossMarginPct,
    perItem,
    analyzedAt: now,
  };
}
