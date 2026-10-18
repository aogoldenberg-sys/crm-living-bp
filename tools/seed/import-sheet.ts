/**
 * Импорт исторических заказов и клиентов из Google Sheet.
 *
 * CSV встроен — Google Sheet недоступен по сети без авторизации.
 * Записывает в Firestore: tenants/gustoriko/orders/, tenants/gustoriko/clients/
 *
 * Запуск: node_modules/.bin/tsx tools/seed/import-sheet.ts [--write]
 */

import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { createFirestoreClientFromJson } from "../../packages/firestore-adapter/src/client.js";
import {
  saveOrder,
  saveClient,
} from "../../packages/firestore-adapter/src/gustoriko/index.js";
import type { Order, Client, TradePoint } from "../../packages/schemas/src/index.js";

const SA_PATH =
  "/Users/annagranenova/Downloads/It/crm-living-bp-firebase-adminsdk-fbsvc-c53d9c7dbd.json";
const BUSINESS_ID = "gustoriko";

// ── CSV данные из Google Sheet (gid=1222684540) ───────────────────────────────

interface SheetRow {
  orderNumber: string;
  amount: string;
  orderDate: string;
  paid: string;
  payDate: string;
  deliveryDate: string;
  deliveryStatus: string;
  clientName: string;
  phone: string;
  email: string;
  address: string;
  comment: string;
  itemCount: string;
  collectedCount: string;
  assemblyStatus: string;
  note: string;
}

const RAW_ROWS: SheetRow[] = [
  {orderNumber:"105917020",amount:"56 652,60₽",orderDate:"12.09.2026",paid:"Да",payDate:"18.09.2026",deliveryDate:"25.09.2026",deliveryStatus:"ОТГРУЖЕН",clientName:"ИП Капустин Максим Александрович",phone:"+7 (916) 120-13-13",email:"kolya09830@gmail.com",address:"Московская обл, г Видное, ул Гаевского, д 1А",comment:"",itemCount:"0",collectedCount:"0",assemblyStatus:"—",note:""},
  {orderNumber:"106062110",amount:"88 777,20₽",orderDate:"16.09.2026",paid:"Да",payDate:"25.09.2026",deliveryDate:"28.09.2026",deliveryStatus:"ОТГРУЖЕН",clientName:"ФВВСР",phone:"+7 (916) 546-83-03",email:"studaqualeague@yandex.ru",address:"Московская обл, г Руза, мкр Северный, д 10",comment:"",itemCount:"1",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"106278810",amount:"42 808,78₽",orderDate:"22.09.2026",paid:"Да",payDate:"25.09.2026",deliveryDate:"28.09.2026",deliveryStatus:"ОТГРУЖЕН",clientName:'ООО "МАШУК 21"',phone:"+7 (916) 355-47-10",email:"mashuk21.kadr@mail.ru",address:"Московская обл, г Одинцово, ул Свободы, д 1",comment:"Приемка товара до 15-00",itemCount:"18",collectedCount:"0",assemblyStatus:"Не собрано",note:"возмещение от полка 1300"},
  {orderNumber:"106317030",amount:"51 187,16₽",orderDate:"22.09.2026",paid:"Частично",payDate:"25.09.2026",deliveryDate:"28.09.2026",deliveryStatus:"ОТГРУЖЕН",clientName:"ИП Агазаде Ага Ровшан Оглы",phone:"+7 (966) 045-45-78",email:"hurinisousmonova101@gmail",address:"г Москва, ул Кременчугская, д 4 к 1",comment:"",itemCount:"30",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"106389110",amount:"40 118,00₽",orderDate:"24.09.2026",paid:"Да",payDate:"28.09.2026",deliveryDate:"30.09.2026",deliveryStatus:"ОТГРУЖЕН",clientName:"ИП Скворцов Дмитрий Николаевич",phone:"+7 (916) 809-57-73",email:"skv33dn@gmail.com",address:"Московская обл, г Сергиев Посад, Вокзальная пл, д 2б",comment:"",itemCount:"26",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"105750010",amount:"161 013,80₽",orderDate:"08.09.2026",paid:"Да",payDate:"10.09.2026",deliveryDate:"30.09.2026",deliveryStatus:"Нет",clientName:'ООО "КИБЕРПРОТЕКТ"',phone:"+7 (960) 733-19-04",email:"evgeniya.shubina@cyberprotect.ru",address:"г Одинцово, Транспортный проезд д.1",comment:"79266175271",itemCount:"2",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"",amount:"",orderDate:"02.10.2026",paid:"Да",payDate:"28.09.2026",deliveryDate:"02.10.2026",deliveryStatus:"Нет",clientName:"ИП Ананьев Кристиан Алексеевич",phone:"+7 (929) 676-70-06",email:"restart.club13@gmail.com",address:"г Москва, р-н Коммунарка, Скандинавский б-р, д 7",comment:"8 (925) 059-63-69 в телеграмм",itemCount:"44",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"106356610",amount:"43 917,44₽",orderDate:"23.09.2026",paid:"Да",payDate:"28.09.2026",deliveryDate:"01.10.2026",deliveryStatus:"ОТГРУЖЕН",clientName:"КОМПАНИЯ БЕЛОЧКА",phone:"+7 (916) 713-53-93",email:"belochkatd@yandex.ru",address:"г Москва, пр-д 3-й Перова Поля, д 4А",comment:"8(906)092-07-96 Гуля звонить ей",itemCount:"7",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"106431810",amount:"53 398,09₽",orderDate:"25.09.2026",paid:"Нет",payDate:"",deliveryDate:"01.10.2026",deliveryStatus:"Нет",clientName:"ИП Григорян Артавазд Рафикович",phone:"+7 (925) 500-93-36",email:"aardo@yandex.ru",address:"Московская обл, г Котельники, мкр Белая Дача, д 19",comment:"",itemCount:"36",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"106431820",amount:"5 517,12₽",orderDate:"25.09.2026",paid:"Нет",payDate:"",deliveryDate:"01.10.2026",deliveryStatus:"Нет",clientName:"ИП Григорян Артавазд Рафикович",phone:"7 (925) 500-93-36",email:"aardo@yandex.ru",address:"Московская обл, г Котельники, мкр Белая Дача, д 19",comment:"",itemCount:"3",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"106171510",amount:"43 690,96₽",orderDate:"18.09.2026",paid:"Нет",payDate:"",deliveryDate:"02.10.2026",deliveryStatus:"Нет",clientName:"ИП Коршев Алексей Анатольевич",phone:"+7 (926) 359-96-65",email:"a-korshev@yandex.ru",address:"Московская обл, г Пушкино, г Красноармейск, пр-кт Испытателей, д 9 стр 3",comment:"",itemCount:"5",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"105493310",amount:"64 141,20₽",orderDate:"31.08.2026",paid:"Да",payDate:"04.09.2026",deliveryDate:"02.10.2026",deliveryStatus:"Нет",clientName:"ИП Лютвинский Леонид Александрович",phone:"+7 (926) 716-67-62",email:"3650069@mail.ru",address:"г Москва, Нахимовский пр-кт, д 46",comment:"Просим клиента созвониться с поставщиком",itemCount:"1",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"106421510",amount:"114 950,00₽",orderDate:"25.09.2026",paid:"Да",payDate:"30.09.2026",deliveryDate:"02.10.2026",deliveryStatus:"Нет",clientName:'ООО "ДАБЛ БЛЭК"',phone:"+7 (985) 040-01-46",email:"zakupki@dblack.ru",address:"г Москва, ул Талдомская, д 2Г",comment:"также нужны вафли весовые Ротфронт",itemCount:"1",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"",amount:"40 732,40₽",orderDate:"25.09.2026",paid:"Да",payDate:"29.09.2026",deliveryDate:"02.10.2026",deliveryStatus:"Нет",clientName:"ИП Дружинина Дарья Николаевна",phone:"8(960)037-09-92",email:"zam.msk@smile-park.ru",address:"г Москва, пр-кт Мира, д 119 стр 55",comment:"",itemCount:"16",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"106170210",amount:"62 721,60₽",orderDate:"18.09.2026",paid:"Да",payDate:"20.09.2026",deliveryDate:"02.10.2026",deliveryStatus:"Нет",clientName:"ИП Аветисян Вилен Артёмович",phone:"+7 (911) 163-34-63",email:"body.store@bk.ru",address:"г Санкт-Петербург, ул Байконурская, д 14",comment:"в день доставки позвонить",itemCount:"14",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"106217910",amount:"65 960,20₽",orderDate:"21.09.2026",paid:"Да",payDate:"28.09.2026",deliveryDate:"02.10.2026",deliveryStatus:"Нет",clientName:"ИП Сафин Руслан Раисович",phone:"+7 (981) 861-46-10",email:"lulechka95@mail.ru",address:"г Санкт-Петербург, ул Варфоломеевская, д 6 стр 1",comment:"",itemCount:"57",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"106275410",amount:"83 172,56₽",orderDate:"22.09.2026",paid:"Да",payDate:"22.09.2026",deliveryDate:"02.10.2026",deliveryStatus:"Нет",clientName:"ИП Саблин Георгий Игоревич",phone:"+7 (980) 269-53-48",email:"george.sablin.21@gmail.com",address:"г Санкт-Петербург, ул 8-я Советская, д 4",comment:"",itemCount:"21",collectedCount:"0",assemblyStatus:"Не собрано",note:"Возмещение от полка - 300р"},
  {orderNumber:"106367310",amount:"50 181,12₽",orderDate:"24.09.2026",paid:"Да",payDate:"25.09.2026",deliveryDate:"02.10.2026",deliveryStatus:"Нет",clientName:'ООО "СНЕК-ХАУС"',phone:"+7 (903) 092-71-95",email:"snackhouse@bk.ru",address:"г Санкт-Петербург, ул Новосёлов, д 49",comment:"",itemCount:"1",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"106382410",amount:"50 311,04₽",orderDate:"24.09.2026",paid:"Аванс 30%",payDate:"25.09.2026",deliveryDate:"02.10.2026",deliveryStatus:"Нет",clientName:"ИП Аванесян Давид Ашотович",phone:"+7 (931) 542-08-73",email:"tatikpapik@yandex.ru",address:"г Санкт-Петербург, ул Софийская, д 6 к 4 стр 2",comment:"внес 30% предоплаты",itemCount:"5",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"",amount:"",orderDate:"26.09.2026",paid:"Да",payDate:"01.10.2026",deliveryDate:"05.10.2026",deliveryStatus:"Нет",clientName:"ИП Шестаков Станислав Олегович",phone:"+7 (925) 399-99-35",email:"colizeumkiberarena@gmail.com",address:"Московская обл, г Раменское, ул Советская, д 2а",comment:"",itemCount:"18",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"",amount:"",orderDate:"28.09.2026",paid:"Да",payDate:"30.09.2026",deliveryDate:"02.10.2026",deliveryStatus:"Нет",clientName:"ИП Воронова Ольга Игоревна",phone:"7 (916) 024-33-33",email:"lushicolga@mail.ru",address:"Московская обл, г Истра, деревня Обушково, тер ДЗ Миллениум Парк, д 5, кв 076",comment:"",itemCount:"2",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"",amount:"",orderDate:"28.09.2026",paid:"Нет",payDate:"",deliveryDate:"02.10.2026",deliveryStatus:"Нет",clientName:'ООО "ПОСЕЙДОН"',phone:"7 (909) 985-85-32",email:"marina-osa2@mail.ru",address:"Московская обл, г Раменское, пгт Родники, ул Трудовая, д 10",comment:"",itemCount:"13",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"",amount:"",orderDate:"28.09.2026",paid:"Да",payDate:"30.09.2026",deliveryDate:"02.10.2026",deliveryStatus:"Нет",clientName:"ИП Захарова Полина Сергеевна",phone:"7 (926) 112-14-24",email:"1121424@mail.ru",address:"Московская обл, г Домодедово, мкр Центральный, ул Кирова, д 13 к 1",comment:"",itemCount:"2",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"106507510",amount:"",orderDate:"28.09.2026",paid:"Нет",payDate:"",deliveryDate:"02.10.2026",deliveryStatus:"Нет",clientName:'ООО "МГИ"',phone:"7 (916) 954-31-73",email:"trokhova.nikol@mail.ru",address:"г Москва, Бобров пер, д 4 стр 2",comment:"Позвоните администратору 8 (499) 322 23 25",itemCount:"2",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"106432410",amount:"2 110 800,00₽",orderDate:"25.09.2026",paid:"Нет",payDate:"",deliveryDate:"05.10.2026",deliveryStatus:"Нет",clientName:'ООО "ПРОМТОРГАЛЬЯНС"',phone:"+7 (930) 873-71-37",email:"pta080@mail.ru",address:"г Москва, ул Авиаторов, д 6",comment:"",itemCount:"1",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"",amount:"",orderDate:"29.09.2026",paid:"Нет",payDate:"",deliveryDate:"05.10.2026",deliveryStatus:"Нет",clientName:"ИП Дорожкин Степан Сергеевич",phone:"7 (909) 690-14-07",email:"transstep@yandex.ru",address:"Московская обл, г Лосино-Петровский, ул Чкалова, стр 52 к 2",comment:"Доставку лучше раньше",itemCount:"2",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"",amount:"",orderDate:"29.09.2026",paid:"Да",payDate:"01.10.2026",deliveryDate:"05.10.2026",deliveryStatus:"Нет",clientName:'ООО "АРЕАЛ"',phone:"7 (915) 162-58-78",email:"areal3@mail.ru",address:"г Москва, ул Шверника, д 19 к 1",comment:"",itemCount:"53",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"",amount:"",orderDate:"29.09.2026",paid:"Нет",payDate:"",deliveryDate:"05.10.2026",deliveryStatus:"Нет",clientName:"ИП Семенкин Сергей Константинович",phone:"7 (977) 648-09-10",email:"kot_ksenia@mail.ru",address:"Московская обл, г Люберцы, Хлебозаводской тупик, д 4 стр 4",comment:"",itemCount:"1",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"",amount:"",orderDate:"",paid:"Нет",payDate:"",deliveryDate:"08.10.2026",deliveryStatus:"Нет",clientName:"ИП Семенкин Сергей Константинович",phone:"",email:"",address:"",comment:"",itemCount:"5",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"",amount:"",orderDate:"",paid:"Нет",payDate:"",deliveryDate:"05.10.2026",deliveryStatus:"Нет",clientName:"ИП Константинова Юлия Вячеславовна",phone:"7 (985) 635-88-84",email:"andrei.konstantinov2@mail.ru",address:"Московская обл, г Сергиев Посад, ул 1-я Рыбная, д 18А",comment:"",itemCount:"77",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"",amount:"",orderDate:"30.09.2026",paid:"Нет",payDate:"",deliveryDate:"05.10.2026",deliveryStatus:"Нет",clientName:'ООО "ФОРТ"',phone:"7 (499) 369-43-62",email:"d89160729911@yandex.ru",address:"г Москва, ул Фортунатовская, д 31/35",comment:"",itemCount:"33",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"",amount:"",orderDate:"30.09.2026",paid:"Нет",payDate:"",deliveryDate:"05.10.2026",deliveryStatus:"Нет",clientName:'АО ЛЗОС АО "ЛЫТКАРИНСКИЙ ЗАВОД ОПТИЧЕСКОГО СТЕКЛА"',phone:"7 (903) 286-40-64",email:"lagutova@lzos.ru",address:"Московская обл, г Лыткарино, ул Парковая, стр 1Б",comment:"",itemCount:"2",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"",amount:"",orderDate:"01.10.2026",paid:"Да",payDate:"01.10.2026",deliveryDate:"05.10.2026",deliveryStatus:"Нет",clientName:'АО ЛЗОС АО "ЛЫТКАРИНСКИЙ ЗАВОД ОПТИЧЕСКОГО СТЕКЛА"',phone:"",email:"",address:"",comment:"",itemCount:"7",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"",amount:"",orderDate:"01.10.2026",paid:"Нет",payDate:"",deliveryDate:"05.10.2026",deliveryStatus:"Нет",clientName:'ООО "ПОЛИМЕР МК"',phone:"7 (910) 424-94-86",email:"evgen_1968@mail.ru",address:"Московская обл, г Одинцово, Можайское шоссе, д 10Б",comment:"",itemCount:"2",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"",amount:"",orderDate:"29.09.2026",paid:"Нет",payDate:"",deliveryDate:"07.10.2026",deliveryStatus:"Нет",clientName:'ООО "СИНТЕКА"',phone:"7 (966) 751-42-56",email:"o.kazanzhidi@cynteka.ru",address:"г Санкт-Петербург, Большой Сампсониевский пр-кт, д 28 к 2",comment:"О поставке нужно предупредить заранее",itemCount:"1",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"",amount:"",orderDate:"01.10.2026",paid:"Нет",payDate:"",deliveryDate:"08.10.2026",deliveryStatus:"Нет",clientName:"ИП Федорова Светлана Витальевна",phone:"7 (964) 369-00-10",email:"svetlana.fedorova71@mail.ru",address:"Ленинградская обл, г Сертолово, мкр Сертолово-2, ул Мира, д 1",comment:"",itemCount:"9",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
  {orderNumber:"",amount:"",orderDate:"01.10.2026",paid:"Нет",payDate:"",deliveryDate:"05.10.2026",deliveryStatus:"Нет",clientName:'ООО "РЕТРО ПЛЮС"',phone:"7 (903) 547-74-77",email:"kampina1@ya.ru",address:"Московская обл, г Одинцово, ул Верхне-Пролетарская, д 3",comment:"",itemCount:"47",collectedCount:"0",assemblyStatus:"Не собрано",note:""},
];

// ── Утилиты ────────────────────────────────────────────────────────────────────

/** "56 652,60₽" → 5665260 (копейки) */
function parseAmountKopecks(raw: string): number {
  if (!raw) return 0;
  const clean = raw.replace(/[₽\s\u00a0]/g, "").replace(",", ".");
  const num = parseFloat(clean);
  return Math.round(num * 100);
}

/** "12.09.2026" → "2026-09-12T00:00:00.000Z" */
function parseDateIso(raw: string): string | null {
  if (!raw) return null;
  const [d, m, y] = raw.split(".");
  if (!d || !m || !y) return null;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T00:00:00.000Z`;
}

function determineStage(row: SheetRow): string {
  if (row.deliveryStatus === "ОТГРУЖЕН") return "delivered";
  if (row.paid === "Да" || row.paid === "Частично" || row.paid.startsWith("Аванс")) return "approved";
  return "received";
}

function determineSource(row: SheetRow): "napolke" | "shop" {
  return row.orderNumber ? "napolke" : "shop";
}

/** Ключ дедупликации клиента — по имени (ИНН нет в таблице). */
function clientKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function extractRegion(address: string): string | null {
  if (address.includes("Санкт-Петербург")) return "Санкт-Петербург";
  if (address.includes("Ленинградская обл")) return "Ленинградская область";
  if (address.includes("Московская обл")) return "Московская область";
  if (address.includes("г Москва") || address.includes("Москва,")) return "Москва";
  return null;
}

// ── Сборка данных ──────────────────────────────────────────────────────────────

function buildClientsAndOrders() {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
  const clientMap = new Map<string, Client>();
  const orders: Order[] = [];

  // Пропускаем пустые строки (строка 106171530 — без клиента)
  const validRows = RAW_ROWS.filter((r) => r.clientName.trim() !== "");

  for (const row of validRows) {
    const key = clientKey(row.clientName);

    // Клиент
    if (!clientMap.has(key)) {
      const tp: TradePoint = {
        tradepointId: randomUUID(),
        address: row.address || null,
        region: extractRegion(row.address),
      };
      clientMap.set(key, {
        clientId: randomUUID(),
        napolkeLegalEntityId: null,
        name: row.clientName.trim(),
        inn: null,
        kpp: null,
        ogrn: null,
        phone: row.phone || null,
        email: row.email || null,
        bank: null,
        tradePoints: [tp],
        honestSign: null,
        egais: null,
        mercury: null,
        status: "active",
        source: determineSource(row),
        orderCount: 0,
        lastOrderAt: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    const client = clientMap.get(key)!;
    client.orderCount++;

    // Обновляем контакты из свежих данных
    if (row.phone && !client.phone) client.phone = row.phone;
    if (row.email && !client.email) client.email = row.email;

    // Добавляем адрес как новый tradePoint если другой
    if (row.address && !client.tradePoints.some((t) => t.address === row.address)) {
      client.tradePoints.push({
        tradepointId: randomUUID(),
        address: row.address,
        region: extractRegion(row.address),
      });
    }

    const orderDate = parseDateIso(row.orderDate);
    const createdAt = orderDate || now;
    if (orderDate && (!client.lastOrderAt || orderDate > client.lastOrderAt)) {
      client.lastOrderAt = orderDate;
    }

    const totalKopecks = parseAmountKopecks(row.amount);

    const order: Order = {
      orderId: randomUUID(),
      source: determineSource(row),
      externalId: row.orderNumber || null,
      customerName: row.clientName.trim(),
      customerInn: null,
      requisites: null,
      items: [{
        productId: "sheet-import",
        productName: `Сборный заказ (${row.itemCount || "?"} поз.)`,
        barcode: null,
        quantity: 1,
        sellPrice: totalKopecks,
        purchasePrice: null,
        supplierId: null,
      }],
      stage: determineStage(row),
      totalSell: totalKopecks,
      totalPurchase: null,
      margin: null,
      marginPct: null,
      managerId: "anna",
      businessId: BUSINESS_ID,
      createdAt,
      updatedAt: now,
    };

    orders.push(order);
  }

  return { clients: [...clientMap.values()], orders };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const doWrite = process.argv.includes("--write");
  const { clients, orders } = buildClientsAndOrders();

  console.log(`=== Импорт из Google Sheet ===`);
  console.log(`Заказов: ${orders.length}`);
  console.log(`Клиентов: ${clients.length}`);

  // Статистика
  const byStage = new Map<string, number>();
  for (const o of orders) byStage.set(o.stage, (byStage.get(o.stage) ?? 0) + 1);
  for (const [s, c] of byStage) console.log(`  ${s}: ${c}`);

  const bySource = new Map<string, number>();
  for (const o of orders) bySource.set(o.source, (bySource.get(o.source) ?? 0) + 1);
  for (const [s, c] of bySource) console.log(`  ${s}: ${c}`);

  console.log("\n--- Клиенты ---");
  for (const c of clients) {
    console.log(`  ${c.name} — ${c.orderCount} заказов, ${c.tradePoints.length} адресов`);
  }

  console.log("\n--- Первые 5 заказов ---");
  for (const o of orders.slice(0, 5)) {
    console.log(`  [${o.source}] ${o.customerName} — ${o.totalSell} коп. (${o.stage})`);
  }

  if (!doWrite) {
    console.log("\n=== Сухой прогон. Для записи: --write ===");
    return;
  }

  // Запись в Firestore
  const saJson = JSON.parse(readFileSync(SA_PATH, "utf-8"));
  const db = createFirestoreClientFromJson(saJson);

  console.log("\nЗапись клиентов...");
  for (const c of clients) {
    const r = await saveClient(db, BUSINESS_ID, c);
    if (!r.ok) console.error(`  ОШИБКА ${c.name}: ${r.error.message}`);
  }
  console.log(`  ✓ ${clients.length} клиентов`);

  console.log("Запись заказов...");
  for (const o of orders) {
    const r = await saveOrder(db, BUSINESS_ID, o);
    if (!r.ok) console.error(`  ОШИБКА ${o.orderId}: ${r.error.message}`);
  }
  console.log(`  ✓ ${orders.length} заказов`);

  console.log("\n=== Импорт завершён ===");
}

main().catch(console.error);
