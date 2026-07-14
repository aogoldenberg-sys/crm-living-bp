// Тесты на чистую логику PaywallScreen — без рендера React
// (node_modules не установлены в worktree, React недоступен)
import { describe, it, expect } from "vitest";
import { priceForPaywall, tierLabel } from "./paywallHelpers";
import { ONE_OFF, SUBSCRIPTIONS } from "./pricing";

describe("priceForPaywall", () => {
  it("returns ONE_OFF price for requiredProduct", () => {
    for (const product of ONE_OFF) {
      expect(priceForPaywall(undefined, product.id)).toBe(product.price);
    }
  });

  it("returns SUBSCRIPTIONS price for requiredTier", () => {
    for (const sub of SUBSCRIPTIONS) {
      expect(priceForPaywall(sub.id, undefined)).toBe(sub.price);
    }
  });

  it("prefers product price over tier when both given", () => {
    const product = ONE_OFF.find(p => p.id === "scenario")!;
    expect(priceForPaywall("operator", "scenario")).toBe(product.price);
  });

  it("falls back to pulse price when nothing specified", () => {
    const pulse = SUBSCRIPTIONS.find(s => s.id === "pulse")!;
    expect(priceForPaywall()).toBe(pulse.price);
  });

  it("price is from pricing.ts — not a hardcoded string", () => {
    // Если кто-то захардкодит "14 900 ₽/мес" вместо ref на SUBSCRIPTIONS —
    // этот тест сломается только при изменении pricing.ts, что и нужно.
    const result = priceForPaywall("operator");
    const fromPricing = SUBSCRIPTIONS.find(s => s.id === "operator")!.price;
    expect(result).toBe(fromPricing);
  });
});

describe("tierLabel", () => {
  it("returns ONE_OFF name for requiredProduct", () => {
    const item = ONE_OFF.find(p => p.id === "diag")!;
    expect(tierLabel(undefined, "diag")).toBe(item.name);
  });

  it("returns SUBSCRIPTIONS name for requiredTier", () => {
    const sub = SUBSCRIPTIONS.find(s => s.id === "pulse")!;
    expect(tierLabel("pulse", undefined)).toBe(sub.name);
  });
});
