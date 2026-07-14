// Чистые функции без React-зависимостей — выделены для тестируемости.
import { ONE_OFF, SUBSCRIPTIONS } from "./pricing";

export function priceForPaywall(requiredTier?: string, requiredProduct?: string): string {
  if (requiredProduct) {
    const item = ONE_OFF.find(p => p.id === requiredProduct);
    if (item) return item.price;
  }
  if (requiredTier) {
    const sub = SUBSCRIPTIONS.find(s => s.id === requiredTier);
    if (sub) return sub.price;
  }
  return SUBSCRIPTIONS.find(s => s.id === "pulse")?.price ?? "";
}

export function tierLabel(requiredTier?: string, requiredProduct?: string): string {
  if (requiredProduct) {
    return ONE_OFF.find(p => p.id === requiredProduct)?.name ?? requiredProduct;
  }
  if (requiredTier) {
    return SUBSCRIPTIONS.find(s => s.id === requiredTier)?.name ?? requiredTier;
  }
  return SUBSCRIPTIONS.find(s => s.id === "pulse")?.name ?? "Пульс";
}
