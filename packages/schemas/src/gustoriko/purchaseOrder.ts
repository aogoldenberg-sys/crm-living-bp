import { z } from "zod";
import { Kopecks, IsoDateTime } from "../money.js";

/** Статус наряда поставщику. draft→edited→sent→confirmed→delivered. */
export const PurchaseOrderStatus = z.enum([
  "draft",
  "edited",
  "sent",
  "confirmed",
  "delivered",
]);
export type PurchaseOrderStatus = z.infer<typeof PurchaseOrderStatus>;

/** Одна позиция наряда поставщику. */
export const PurchaseOrderItem = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  quantity: z.number().int().positive(),
  /** Закупочная цена за единицу в копейках. */
  priceKopecks: Kopecks,
}).strict();

export type PurchaseOrderItem = z.infer<typeof PurchaseOrderItem>;

/**
 * Наряд (заказ) поставщику.
 * Генерируется автоматически при sourcing, но менеджер может
 * редактировать: менять позиции, количество, поставщика.
 */
export const PurchaseOrder = z.object({
  poId: z.string().uuid(),
  /** Родительский заказ клиента. */
  orderId: z.string().uuid(),
  supplierId: z.string().min(1),
  supplierName: z.string().min(1),
  items: z.array(PurchaseOrderItem).min(1),
  /** Итого в копейках. */
  totalKopecks: Kopecks,
  status: PurchaseOrderStatus,
  /** Кто последний редактировал (null = авто). */
  editedBy: z.string().nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
}).strict();

export type PurchaseOrder = z.infer<typeof PurchaseOrder>;
