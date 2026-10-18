import { z } from "zod";
import { Kopecks, IsoDateTime, Inn } from "../money.js";

/** Откуда пришёл заказ. */
export const OrderSource = z.enum(["shop", "napolke", "manual"]);
export type OrderSource = z.infer<typeof OrderSource>;

/** Стадия заказа в пайплайне. */
export const OrderStage = z.enum([
  "received",
  "approved",
  "sourcing",
  "invoiced",
  "ordered",
  "delivered",
  "cancelled",
]);
export type OrderStage = z.infer<typeof OrderStage>;

/** Реквизиты заказчика для счёта и договора. */
export const CustomerRequisites = z.object({
  companyName: z.string().min(1),
  inn: Inn,
  kpp: z.string().nullable(),
  ogrn: z.string().nullable(),
  legalAddress: z.string().nullable(),
  actualAddress: z.string().nullable(),
  bankName: z.string().nullable(),
  bik: z.string().nullable(),
  corrAccount: z.string().nullable(),
  account: z.string().nullable(),
  contactPerson: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
}).strict();

export type CustomerRequisites = z.infer<typeof CustomerRequisites>;

/** Одна позиция заказа. */
export const OrderLineItem = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  barcode: z.string().nullable(),
  quantity: z.number().int().positive(),
  /** Цена продажи за единицу в копейках. */
  sellPrice: Kopecks,
  /** Закупочная цена — заполняется после sourcing. */
  purchasePrice: Kopecks.nullable(),
  /** Выбранный поставщик — заполняется после sourcing. */
  supplierId: z.string().nullable(),
}).strict();

export type OrderLineItem = z.infer<typeof OrderLineItem>;

/** Заказ клиента. */
export const Order = z.object({
  orderId: z.string().uuid(),
  source: OrderSource,
  /** Внешний ID заказа (из магазина или НаПолке). */
  externalId: z.string().nullable(),
  customerName: z.string().min(1),
  customerInn: Inn.nullable(),
  /** Полные реквизиты — для генерации счёта и договора. */
  requisites: CustomerRequisites.nullable(),
  items: z.array(OrderLineItem).min(1),
  stage: OrderStage,
  /** Сумма продажи в копейках. */
  totalSell: Kopecks,
  /** Сумма закупки — после sourcing. */
  totalPurchase: Kopecks.nullable(),
  /** Маржа = totalSell - totalPurchase. */
  margin: Kopecks.nullable(),
  /** Маржа в %: margin / totalSell * 100. */
  marginPct: z.number().nullable(),
  managerId: z.string().min(1),
  businessId: z.string().min(1),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
}).strict();

export type Order = z.infer<typeof Order>;
