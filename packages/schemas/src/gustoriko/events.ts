import { z } from "zod";
import { IsoDateTime } from "../money.js";
import { OrderStage } from "./order.js";

/** Append-only событие смены стадии заказа. */
export const OrderStageChanged = z.object({
  type: z.literal("order_stage_changed"),
  eventId: z.string().uuid(),
  ts: IsoDateTime,
  orderId: z.string().uuid(),
  fromStage: z.string(),
  toStage: OrderStage,
  managerId: z.string().min(1),
  businessId: z.string().min(1),
}).strict();

export type OrderStageChanged = z.infer<typeof OrderStageChanged>;

/** Append-only событие ручного редактирования наряда поставщику. */
export const PurchaseOrderEdited = z.object({
  type: z.literal("purchase_order_edited"),
  eventId: z.string().uuid(),
  ts: IsoDateTime,
  poId: z.string().uuid(),
  orderId: z.string().uuid(),
  editedBy: z.string().min(1),
  /** Описание изменения (для аудита). */
  description: z.string().min(1),
  businessId: z.string().min(1),
}).strict();

export type PurchaseOrderEdited = z.infer<typeof PurchaseOrderEdited>;
