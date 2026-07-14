/** Единственный источник цен на фронте. Суммы — строки для отображения. */

export interface OneOffItem {
  id: string;
  name: string;
  price: string;
  includes: string;
}

export interface SubItem {
  id: string;
  name: string;
  price: string;
  value: string;
}

export const ONE_OFF: OneOffItem[] = [
  { id: "diag",       name: "Диагностика",    price: "490 ₽",   includes: "Оценка плана (Kairos)" },
  { id: "live_plan",  name: "Живой план",      price: "1 490 ₽", includes: "Оценка + исправление разделов" },
  { id: "scenario",   name: "Сценарий",        price: "2 490 ₽", includes: "Живой план + дорожная карта" },
  { id: "subsidy",    name: "Под субсидию",    price: "4 990 ₽", includes: "Сценарий + адаптация под 1 грант" },
  { id: "grant_pro",  name: "Грант Pro",       price: "9 990 ₽", includes: "Всё выше + 5 грантовых программ" },
];

export const SUBSCRIPTIONS: SubItem[] = [
  { id: "pulse",      name: "Пульс",       price: "4 900 ₽/мес",  value: "Видимость: касса, план/факт, алерты" },
  { id: "operator",   name: "Операционист", price: "14 900 ₽/мес", value: "Прогноз разрыва, контроль задач, еженедельный доклад (от 80 000 ₽/мес финдиректора на аутстаффе)" },
  { id: "director",   name: "Директор",    price: "29 900 ₽/мес", value: "Автономная стратегия в лимитах, сценарии, доклад собственнику" },
  { id: "enterprise", name: "Enterprise",  price: "от 79 900 ₽, договорная", value: "Несколько юрлиц, консолидация" },
];

export const MAGNETS = [
  { name: "КУДиР/УСН", price: "290 ₽/квартал или 890 ₽/год", note: "Первый отчёт — бесплатно" },
  { name: "Комплаенс (ответ на требование)", price: "2 490 ₽/кейс", note: "Первый кейс — бесплатно" },
];

export const TG_MANAGER = "https://t.me/opentgp";

/** Ссылка для оплаты тарифа через менеджера (не прямая платёжная интеграция). */
export const CONTACT_URL = "https://t.me/opentgp";
