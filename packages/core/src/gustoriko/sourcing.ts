import type { OrderLineItem, SupplierPricing } from "@crm/schemas";
import type { Result } from "../types.js";
import { ok, err } from "../types.js";

export interface SourcingResult {
  /** Позиции с заполненными purchasePrice и supplierId. */
  items: OrderLineItem[];
  /** Позиции, для которых не нашёлся поставщик. */
  unmatched: Array<{ productId: string; reason: string }>;
}

/**
 * Для каждой позиции заказа выбирает самого дешёвого поставщика.
 * Чистая функция, без I/O.
 */
export function selectSuppliers(
  items: OrderLineItem[],
  pricing: SupplierPricing[],
): Result<SourcingResult> {
  if (items.length === 0) {
    return err({ code: "INSUFFICIENT_DATA", message: "Нет позиций в заказе" });
  }

  const byProduct = new Map<string, SupplierPricing[]>();
  for (const p of pricing) {
    const list = byProduct.get(p.productId) ?? [];
    list.push(p);
    byProduct.set(p.productId, list);
  }

  const enriched: OrderLineItem[] = [];
  const unmatched: SourcingResult["unmatched"] = [];

  for (const item of items) {
    const offers = byProduct.get(item.productId) ?? [];
    // Фильтр: минимальное количество ≤ заказанное
    const eligible = offers.filter((o) => o.minQuantity <= item.quantity);

    if (eligible.length === 0) {
      unmatched.push({
        productId: item.productId,
        reason: offers.length === 0
          ? "Нет предложений от поставщиков"
          : `Мин. количество выше заказанного (${item.quantity})`,
      });
      enriched.push({ ...item });
      continue;
    }

    // Самый дешёвый
    eligible.sort((a, b) => a.priceKopecks - b.priceKopecks);
    const best = eligible[0]!;

    enriched.push({
      ...item,
      purchasePrice: best.priceKopecks,
      supplierId: best.supplierId,
    });
  }

  return ok({ items: enriched, unmatched });
}
