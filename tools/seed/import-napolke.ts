/**
 * Импорт заказов и клиентов из НаПолке API.
 *
 * Эндпоинт: POST https://siteapi.napolke.ru/external-api/v1/orders/search
 * Авторизация: Bearer JWT
 *
 * Собирает:
 * 1. Все заказы (все статусы, включая отменённые)
 * 2. Клиентскую базу из tradepoint-блоков заказов
 *
 * Записывает в Firestore: tenants/gustoriko/orders/, tenants/gustoriko/clients/
 *
 * Запуск: npx tsx tools/seed/import-napolke.ts
 */

const NAPOLKE_TOKEN = "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMS0wMDAwMDAwMDAwMDAwMDAwNTI3NiIsIl9pYXQiOiIyMDI2LTA4LTE5IDE3OjEyOjE2IiwiYXVkIjoiUFJJQ0VMSVNUX0FQSSIsInByaWNlbGlzdF9pZCI6IjE0NDQxIiwiZXhwIjoxODE4Njg0NzM2LCJqdGkiOiJkMzAzZjM4OC0wNjRkLTQwZjMtODhkMS0yODVlZjdkN2VhZjMifQ.W4x6sjrTu0cGMIukmeYaK6Q4DdynHxTm0-2rargtiRcYGxmdKMsSLTFENA1mrrHO-6c57ya88_oq3sbrTbuuU_YHYuxYiCUlDfOk9bhY9sATSvPPHIIJDSOMttBsiNWdR2ZeDqamgkTA-FeunTCKJ7uvyb70oSq7qwYbtn-l7Mc";
const API_URL = "https://siteapi.napolke.ru/external-api/v1/orders/search";
const BUSINESS_ID = "gustoriko";

// НаПолке статусы заказов
const ALL_STATUSES = [
  "ORDER_WAIT_SUPPLIER",
  "ORDER_WAIT_EDIT_TRADEPOINT",
  "ORDER_ACCEPTED",
  "ORDER_DELIVERED",
  "ORDER_SUPPLIER_REJECTED",
  "ORDER_TRADEPOINT_REJECTED",
  "ORDER_REJECTED",
];

interface NapolkeItem {
  article: string;
  name: string;
  qnt: number;
  price: number;
  bonusPrice?: number;
  amount: number;
  bonusAmount?: number;
  compensation?: number;
  commission?: number;
  supplierBonusSize?: number;
}

interface NapolkeTradepoint {
  inn?: string;
  kpp?: string;
  name?: string;
  ogrn?: string;
  phone?: number;
  tradepointId?: string;
  legalEntityId?: string;
}

interface NapolkeLegalMarks {
  honestSign?: string;
  egais?: string;
  mercury?: string;
}

interface NapolkeOrder {
  id: number;
  status: string;
  payType?: string;
  editUrl?: string;
  cancelUrl?: string;
  confirmUrl?: string;
  note?: string;
  wishDeliveryTime?: { wishDate?: string };
  items: NapolkeItem[];
  address?: { region?: string; address?: string; region_fias?: string[] };
  tradepoint?: NapolkeTradepoint;
  deliveryPrice?: number;
  cost: number;
  bonus?: number;
  commission?: number;
  compensation?: number;
  orderType?: string;
  primarySupplierOrderId?: number;
  supplierStatus?: string;
  partnerCode?: string;
  legalMarks?: NapolkeLegalMarks;
}

async function fetchOrders(status?: string, limit = 100, offset = 0): Promise<NapolkeOrder[]> {
  const body: Record<string, unknown> = { page: { limit, offset } };
  if (status) body.status = status;

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${NAPOLKE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`НаПолке API ${res.status}: ${text}`);
  }

  const data = await res.json() as NapolkeOrder[] | { result: number; error_message?: string };

  // API возвращает массив при 200 OK
  if (Array.isArray(data)) return data;

  // Или объект с ошибкой
  const err = data as { result: number; error_message?: string };
  if (err.result !== 0) {
    throw new Error(`НаПолке API error ${err.result}: ${err.error_message}`);
  }
  return [];
}

async function fetchAllOrders(): Promise<NapolkeOrder[]> {
  const all: NapolkeOrder[] = [];
  const seen = new Set<number>();

  for (const status of ALL_STATUSES) {
    let offset = 0;
    while (true) {
      const batch = await fetchOrders(status, 100, offset);
      if (batch.length === 0) break;

      for (const order of batch) {
        if (!seen.has(order.id)) {
          seen.add(order.id);
          all.push(order);
        }
      }

      console.log(`  ${status}: offset=${offset}, batch=${batch.length}, total=${all.length}`);
      if (batch.length < 100) break;
      offset += 100;
    }
  }

  return all;
}

/** Маппинг статуса НаПолке → наш OrderStage. */
function mapOrderStage(status: string): string {
  switch (status) {
    case "ORDER_WAIT_SUPPLIER": return "received";
    case "ORDER_WAIT_EDIT_TRADEPOINT": return "received";
    case "ORDER_ACCEPTED": return "approved";
    case "ORDER_DELIVERED": return "delivered";
    case "ORDER_SUPPLIER_REJECTED":
    case "ORDER_TRADEPOINT_REJECTED":
    case "ORDER_REJECTED": return "cancelled";
    default: return "received";
  }
}

/** Извлекает уникальных клиентов из массива заказов. */
function extractClients(orders: NapolkeOrder[]): Map<string, {
  name: string;
  inn: string | null;
  kpp: string | null;
  ogrn: string | null;
  phone: string | null;
  legalEntityId: string | null;
  tradepointId: string | null;
  address: string | null;
  region: string | null;
  honestSign: string | null;
  egais: string | null;
  mercury: string | null;
  orderCount: number;
  lastOrderId: number;
  statuses: Set<string>;
}> {
  const clients = new Map<string, ReturnType<typeof extractClients> extends Map<string, infer V> ? V : never>();

  for (const order of orders) {
    const tp = order.tradepoint;
    if (!tp) continue;

    // Ключ клиента: ИНН или legalEntityId или tradepointId
    const key = tp.inn || tp.legalEntityId || tp.tradepointId || `order_${order.id}`;

    const existing = clients.get(key);
    if (existing) {
      existing.orderCount++;
      existing.statuses.add(order.status);
      if (order.id > existing.lastOrderId) {
        existing.lastOrderId = order.id;
        // Обновляем данные из более свежего заказа
        if (tp.name) existing.name = tp.name;
        if (tp.kpp) existing.kpp = tp.kpp;
        if (tp.phone) existing.phone = String(tp.phone);
      }
    } else {
      clients.set(key, {
        name: tp.name || `Клиент ${key}`,
        inn: tp.inn || null,
        kpp: tp.kpp || null,
        ogrn: tp.ogrn || null,
        phone: tp.phone ? String(tp.phone) : null,
        legalEntityId: tp.legalEntityId || null,
        tradepointId: tp.tradepointId || null,
        address: order.address?.address || null,
        region: order.address?.region || null,
        honestSign: order.legalMarks?.honestSign || null,
        egais: order.legalMarks?.egais || null,
        mercury: order.legalMarks?.mercury || null,
        orderCount: 1,
        lastOrderId: order.id,
        statuses: new Set([order.status]),
      });
    }
  }

  return clients;
}

async function main() {
  console.log("=== Импорт из НаПолке API ===");
  console.log("Загрузка заказов...");

  const orders = await fetchAllOrders();
  console.log(`\nВсего заказов: ${orders.length}`);

  // Статистика по статусам
  const byStatus = new Map<string, number>();
  for (const o of orders) {
    byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
  }
  for (const [s, c] of byStatus) console.log(`  ${s}: ${c}`);

  // Клиенты
  const clients = extractClients(orders);
  console.log(`\nУникальных клиентов: ${clients.size}`);

  // Вывод клиентов
  let active = 0;
  let rejected = 0;
  for (const [key, c] of clients) {
    const hasRejected = c.statuses.has("ORDER_SUPPLIER_REJECTED") ||
      c.statuses.has("ORDER_TRADEPOINT_REJECTED") ||
      c.statuses.has("ORDER_REJECTED");
    const hasActive = c.statuses.has("ORDER_ACCEPTED") ||
      c.statuses.has("ORDER_DELIVERED") ||
      c.statuses.has("ORDER_WAIT_SUPPLIER");

    if (hasActive) active++;
    if (hasRejected && !hasActive) rejected++;

    console.log(`  ${c.name} (${c.inn || "без ИНН"}) — ${c.orderCount} заказов, статусы: ${[...c.statuses].join(",")}`);
  }
  console.log(`\nАктивные: ${active}, Только отменённые: ${rejected}`);

  // Заказы — вывод первых 5 для проверки
  console.log("\n--- Первые 5 заказов ---");
  for (const o of orders.slice(0, 5)) {
    console.log(`  #${o.id} [${o.status}] ${o.items.length} позиций, ${o.cost} руб.`);
    if (o.tradepoint) {
      console.log(`    Клиент: ${o.tradepoint.name} ИНН:${o.tradepoint.inn}`);
    }
    for (const item of o.items.slice(0, 3)) {
      console.log(`    - ${item.name} x${item.qnt} @ ${item.price} руб.`);
    }
  }

  console.log("\n=== Сухой прогон завершён ===");
  console.log("Для записи в Firestore добавьте --write");

  // TODO: при --write — записать в Firestore через createFirestoreClientFromJson
}

main().catch(console.error);
