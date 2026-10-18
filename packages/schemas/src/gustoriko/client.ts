import { z } from "zod";
import { IsoDateTime } from "../money.js";

/** Статус клиента в CRM. */
export const ClientStatus = z.enum([
  "active",
  "inactive",
  "rejected",
]);
export type ClientStatus = z.infer<typeof ClientStatus>;

/** Банковские реквизиты клиента (из НаПолке tradepoint.requisites). */
export const BankRequisites = z.object({
  bik: z.string().nullable(),
  giroAccount: z.string().nullable(),
  correspondentAccount: z.string().nullable(),
  bankName: z.string().nullable(),
}).strict();

export type BankRequisites = z.infer<typeof BankRequisites>;

/** Торговая точка (адрес доставки). У одного юрлица может быть несколько. */
export const TradePoint = z.object({
  tradepointId: z.string().min(1),
  address: z.string().nullable(),
  region: z.string().nullable(),
}).strict();

export type TradePoint = z.infer<typeof TradePoint>;

/**
 * Клиент Густорико.
 * Данные собираются из заказов НаПолке (tradepoint-блок)
 * и из заказов интернет-магазина.
 */
export const Client = z.object({
  clientId: z.string().min(1),
  /** ID юрлица на стороне НаПолке. */
  napolkeLegalEntityId: z.string().nullable(),
  name: z.string().min(1),
  inn: z.string().nullable(),
  kpp: z.string().nullable(),
  ogrn: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  /** Банковские реквизиты (для генерации счетов и договоров). */
  bank: BankRequisites.nullable(),
  /** Торговые точки (адреса доставки). */
  tradePoints: z.array(TradePoint),
  /** Маркировки: Честный Знак, ЕГАИС, Меркурий. */
  honestSign: z.string().nullable(),
  egais: z.string().nullable(),
  mercury: z.string().nullable(),
  status: ClientStatus,
  /** Источник: napolke / shop / manual. */
  source: z.string().min(1),
  /** Общее количество заказов. */
  orderCount: z.number().int().nonnegative(),
  /** Дата последнего заказа. */
  lastOrderAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
}).strict();

export type Client = z.infer<typeof Client>;
