import { z } from "zod";
import { Kopecks, IsoDateTime } from "../money.js";

/** Формат, в котором поставщик принимает заказы. */
export const OrderFormat = z.enum(["excel", "email", "api", "manual"]);
export type OrderFormat = z.infer<typeof OrderFormat>;

/** Поставщик. supplierId — строка, не enum: поставщиков много. */
export const Supplier = z.object({
  supplierId: z.string().min(1),
  name: z.string().min(1),
  orderFormat: OrderFormat,
  contactEmail: z.string().email().nullable(),
  /** Дополнительные контакты / комментарии. */
  notes: z.string().nullable(),
}).strict();

export type Supplier = z.infer<typeof Supplier>;

/** Цена одного товара у одного поставщика. */
export const SupplierPricing = z.object({
  supplierId: z.string().min(1),
  productId: z.string().min(1),
  /** Закупочная цена в копейках. */
  priceKopecks: Kopecks,
  /** Минимальное количество для заказа. */
  minQuantity: z.number().int().positive(),
  updatedAt: IsoDateTime,
}).strict();

export type SupplierPricing = z.infer<typeof SupplierPricing>;
