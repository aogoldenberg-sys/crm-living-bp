/** Единственный источник цен на фронте. Суммы — строки для отображения, kopecks — integer для Т-Банк. */

export interface OneOffItem {
  id: string;
  name: string;
  price: string;
  /** Сумма в копейках для платёжного API. */
  amountKop: number;
  includes: string;
  freeFirst?: string;
}

export interface SubItem {
  id: string;
  name: string;
  price: string;
  amountKop: number;
  value: string;
}

/** Линия 1 — разовые задачи */
export const ONE_OFF: OneOffItem[] = [
  { id: "start",      name: "Старт",       price: "490 ₽",     amountKop: 49000,    includes: "Оценка бизнес-плана по 26 разделам" },
  { id: "life",       name: "Лайф",        price: "1 490 ₽",   amountKop: 149000,   includes: "Составление бизнес-плана с нуля онлайн" },
  { id: "grant",      name: "Грант",       price: "1 800 ₽",   amountKop: 180000,   includes: "Бизнес-план для соцконтракта, Минэкономразвития, Агростартап, Сколково" },
  { id: "compliance", name: "Комплаенс",   price: "990 ₽",     amountKop: 99000,    includes: "Ответ на запрос ФНС, СФР, банка, прокуратуры — мотивированная позиция за 15 минут", freeFirst: "Первый кейс бесплатно" },
  { id: "kudir",      name: "КУДиР / УСН", price: "290 ₽/кв",  amountKop: 29000,    includes: "Отчётность для ИП и ООО на УСН из выписки банка. 890 ₽/год", freeFirst: "Первый отчёт бесплатно" },
];

/** Линия 2 — подписка */
export const SUBSCRIPTIONS: SubItem[] = [
  { id: "pulse",      name: "Пульс",        price: "4 900 ₽/мес",   amountKop: 490000,   value: "Видимость: касса, план/факт, алерты. Telegram-дайджест каждое утро" },
  { id: "operator",   name: "Операционист",  price: "14 900 ₽/мес",  amountKop: 1490000,  value: "Прогноз кассового разрыва за 90 дней, контроль задач, еженедельный доклад собственнику" },
  { id: "director",   name: "Директор",      price: "29 900 ₽/мес",  amountKop: 2990000,  value: "Автономная стратегия, сценарии, причинный граф, 26 аналитических линз" },
  { id: "enterprise", name: "Enterprise",    price: "79 900 ₽/мес",  amountKop: 7990000,  value: "Несколько юрлиц, консолидация, кастомные интеграции, выделенная поддержка" },
];

export const TG_MANAGER = "https://t.me/opentgp";

/** Лендинг Kairos — блок тарифов. */
export const PRICING_URL = "https://opentgp.ru/kairos/#pricing";

/** Fallback: оплата через менеджера в Telegram. */
export const CONTACT_URL = "https://t.me/opentgp";
