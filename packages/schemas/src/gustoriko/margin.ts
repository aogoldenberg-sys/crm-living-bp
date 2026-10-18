import { z } from "zod";
import { Kopecks, IsoDateTime } from "../money.js";

/** Маржинальность одной позиции. */
export const MarginItem = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  quantity: z.number().int().positive(),
  sellPrice: Kopecks,
  purchasePrice: Kopecks,
  /** (sellPrice - purchasePrice) * quantity. */
  itemMargin: Kopecks,
  /** itemMargin / (sellPrice * quantity) * 100. */
  itemMarginPct: z.number(),
  supplierId: z.string().min(1),
}).strict();

export type MarginItem = z.infer<typeof MarginItem>;

/** Анализ маржинальности заказа. */
export const MarginAnalysis = z.object({
  orderId: z.string().uuid(),
  totalRevenue: Kopecks,
  totalCost: Kopecks,
  grossMargin: Kopecks,
  /** grossMargin / totalRevenue * 100. */
  grossMarginPct: z.number(),
  perItem: z.array(MarginItem),
  analyzedAt: IsoDateTime,
}).strict();

export type MarginAnalysis = z.infer<typeof MarginAnalysis>;
