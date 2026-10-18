// Общие шаблоны писем — используются в MailingView и ClientEmailSection

export function wrapEmail(content: string): string {
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Густорико · ОпенТрейдГрупп</title></head>
<body style="margin:0;padding:0;background:#f5f0e8;font-family:Georgia,serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
  <tr><td style="background:linear-gradient(135deg,#2d1f0e,#4a2e12);border-radius:14px 14px 0 0;padding:24px 36px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle;width:56px;">
        <img src="https://opentgp.ru/food/images/gustorico-logo.png" width="48" height="48"
             alt="Густорико" style="display:block;border-radius:10px;object-fit:cover;">
      </td>
      <td style="vertical-align:middle;padding-left:14px;">
        <div style="font-size:20px;font-weight:700;color:#e8c96a;letter-spacing:.5px;line-height:1.2;">ГУСТОРИКО</div>
        <div style="font-size:11px;color:rgba(232,201,106,.55);margin-top:3px;letter-spacing:.04em;">ООО ОпенТрейдГрупп · оптовая поставка продуктов питания</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="background:#fffdf7;padding:36px 40px;">${content}</td></tr>
  <tr><td style="background:#2d1f0e;border-radius:0 0 14px 14px;padding:22px 36px;text-align:center;">
    <div style="font-size:12px;color:rgba(232,201,106,.85);line-height:2;font-weight:600;">С уважением, Оптово-розничный отдел ОпенТрейдГрупп</div>
    <div style="font-size:11px;color:rgba(232,201,106,.55);line-height:2;margin-top:4px;">
      📞 +7 (495) 205-35-00 &nbsp;·&nbsp; ✉️ opentg@yandex.ru<br>
      ООО «ОпенТрейдГрупп» · ИНН 9703235411
    </div>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

export function signatureHtml(manager: string) {
  return `<div style="border-top:1px solid #e8dfc8;padding-top:20px;">
    <div style="font-size:13px;color:#8B7355;">С уважением,</div>
    <div style="font-size:15px;font-weight:700;color:#1A1814;margin-top:4px;">${manager || "Менеджер"}</div>
    <div style="font-size:12px;color:#a0896a;">Команда Густорико</div>
  </div>`;
}

export interface TplField {
  key: string;
  label: string;
  type: "text" | "textarea";
  placeholder?: string;
  autoFrom?: "clientName";
  optional?: boolean;
}

export interface Template {
  id: string;
  label: string;
  subject: string;
  fields: TplField[];
  buildHtml: (v: Record<string, string>) => string;
}

export const MANAGER_FIELD: TplField = { key: "manager", label: "Имя менеджера", type: "text", placeholder: "Анна Граненова" };

export const TEMPLATES: Template[] = [
  {
    id: "delivery",
    label: "📦 Перенос доставки",
    subject: "Изменение даты доставки вашего заказа",
    fields: [
      { key: "customer", label: "Имя клиента", type: "text", autoFrom: "clientName", placeholder: "Иванов Иван" },
      { key: "old_date", label: "Прежняя дата доставки", type: "text", placeholder: "20 октября 2026" },
      { key: "new_date", label: "Новая дата доставки", type: "text", placeholder: "22 октября 2026" },
      { key: "reason", label: "Причина переноса", type: "textarea", placeholder: "В связи с задержкой поставки от производителя", optional: true },
      MANAGER_FIELD,
    ],
    buildHtml: (v) => wrapEmail(`
      <p style="margin:0 0 8px;font-size:14px;color:#8B7355;">Уважаемый(ая)</p>
      <p style="margin:0 0 24px;font-size:22px;font-weight:700;color:#1A1814;">${v.customer}</p>
      <div style="background:#fff8ed;border-left:4px solid #C89A34;border-radius:0 8px 8px 0;padding:16px 20px;margin:0 0 24px;">
        <div style="font-size:12px;font-weight:700;color:#C89A34;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">Уведомление об изменении</div>
        <div style="font-size:15px;color:#1A1814;line-height:1.6;">
          Сообщаем вам, что доставка вашего заказа переносится.<br><br>
          <b>Прежняя дата:</b> ${v.old_date}<br>
          <b>Новая дата:</b> ${v.new_date}
        </div>
      </div>
      ${v.reason ? `<p style="font-size:14px;color:#3d2e1a;line-height:1.7;margin:0 0 20px;">${v.reason}</p>` : ""}
      <p style="font-size:14px;color:#3d2e1a;line-height:1.7;margin:0 0 28px;">
        Приносим извинения за неудобства. Если у вас есть вопросы — напишите нам в ответ на это письмо или позвоните менеджеру.
      </p>
      ${signatureHtml(v.manager)}
    `),
  },
  {
    id: "substitution",
    label: "🔄 Замена позиций",
    subject: "Замена позиций в вашем заказе",
    fields: [
      { key: "customer", label: "Имя клиента", type: "text", autoFrom: "clientName", placeholder: "Иванов Иван" },
      { key: "from1", label: "Было (строка 1)", type: "text", placeholder: "Шишкин Лес 0,5л газ, 120 шт" },
      { key: "to1",   label: "Замена (строка 1)", type: "text", placeholder: "Шишкин Лес 0,5л негаз, 120 шт" },
      { key: "from2", label: "Было (строка 2)", type: "text", placeholder: "Добрый сок яблоко 1л, 24 шт", optional: true },
      { key: "to2",   label: "Замена (строка 2)", type: "text", placeholder: "Я сок яблоко 1л, 24 шт", optional: true },
      { key: "from3", label: "Было (строка 3)", type: "text", placeholder: "", optional: true },
      { key: "to3",   label: "Замена (строка 3)", type: "text", placeholder: "", optional: true },
      MANAGER_FIELD,
    ],
    buildHtml: (v) => {
      const rows = [[v.from1, v.to1], [v.from2, v.to2], [v.from3, v.to3]]
        .filter(([a]) => a?.trim())
        .map(([a, b], i) => `<tr style="background:${i % 2 === 0 ? "#fffdf7" : "#faf8f4"};">
          <td style="padding:11px 14px;font-size:13px;color:#3d2e1a;border-bottom:1px solid #f0e8d8;">${a}</td>
          <td style="padding:11px 14px;font-size:13px;color:#1A1814;font-weight:600;border-bottom:1px solid #f0e8d8;">${b || "—"}</td>
        </tr>`).join("");
      return wrapEmail(`
        <p style="margin:0 0 8px;font-size:14px;color:#8B7355;">Уважаемый(ая)</p>
        <p style="margin:0 0 24px;font-size:22px;font-weight:700;color:#1A1814;">${v.customer}</p>
        <p style="font-size:14px;color:#3d2e1a;line-height:1.7;margin:0 0 20px;">
          К сожалению, часть позиций из вашего заказа временно недоступна. Мы предлагаем следующие замены:
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 24px;">
          <thead><tr style="background:#f5ede0;">
            <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:#8B7355;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #e8dfc8;">Было заказано</th>
            <th style="padding:10px 14px;text-align:left;font-size:11px;font-weight:700;color:#C89A34;text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid #e8dfc8;">Предлагаем заменить</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="background:#f0f9f0;border-left:4px solid #22c55e;border-radius:0 8px 8px 0;padding:14px 18px;margin:0 0 24px;">
          <div style="font-size:13px;color:#14532d;line-height:1.6;">
            ✓ Цена замены соответствует цене оригинальной позиции.<br>
            ✓ Если замена вас не устраивает — сообщите нам, и мы исключим позицию из заказа.
          </div>
        </div>
        ${signatureHtml(v.manager)}
      `);
    },
  },
  {
    id: "offer",
    label: "🎯 Спецпредложение",
    subject: "Специальное предложение для вас от Густорико",
    fields: [
      { key: "customer",    label: "Имя клиента", type: "text", autoFrom: "clientName", placeholder: "Иванов Иван" },
      { key: "offer_title", label: "Заголовок предложения", type: "text", placeholder: "Скидка 7% на Шишкин Лес" },
      { key: "offer_date",  label: "Действует до", type: "text", placeholder: "31 октября 2026" },
      { key: "offer_desc",  label: "Описание", type: "textarea", placeholder: "При заказе от 50 000 руб. — скидка 7% на всю линейку Шишкин Лес", optional: true },
      { key: "item1", label: "Товар 1", type: "text", placeholder: "Шишкин Лес 0,5л, 120 шт" },
      { key: "price1", label: "Обычная цена", type: "text", placeholder: "980 ₽" },
      { key: "sale1",  label: "Спец цена", type: "text", placeholder: "911 ₽" },
      { key: "item2",  label: "Товар 2", type: "text", placeholder: "Шишкин Лес 1,5л, 60 шт", optional: true },
      { key: "price2", label: "Обычная цена", type: "text", placeholder: "1 350 ₽", optional: true },
      { key: "sale2",  label: "Спец цена", type: "text", placeholder: "1 256 ₽", optional: true },
      MANAGER_FIELD,
    ],
    buildHtml: (v) => {
      const rows = [[v.item1, v.price1, v.sale1], [v.item2, v.price2, v.sale2]]
        .filter(([a]) => a?.trim())
        .map(([item, price, sale], i) => `<tr style="background:${i % 2 === 0 ? "#fffdf7" : "#faf8f4"};">
          <td style="padding:10px 14px;font-size:13px;color:#3d2e1a;border-bottom:1px solid #f0e8d8;">${item}</td>
          <td style="padding:10px 14px;font-size:13px;color:#aaa;text-align:right;text-decoration:line-through;border-bottom:1px solid #f0e8d8;">${price}</td>
          <td style="padding:10px 14px;font-size:14px;font-weight:700;color:#C89A34;text-align:right;border-bottom:1px solid #f0e8d8;">${sale}</td>
        </tr>`).join("");
      return wrapEmail(`
        <p style="margin:0 0 8px;font-size:14px;color:#8B7355;">Уважаемый(ая)</p>
        <p style="margin:0 0 20px;font-size:22px;font-weight:700;color:#1A1814;">${v.customer}</p>
        <div style="background:linear-gradient(135deg,#fffbf0,#fff8e8);border:1.5px solid #e8c96a;border-radius:12px;padding:24px 28px;margin:0 0 24px;text-align:center;">
          <div style="font-size:13px;font-weight:700;color:#C89A34;text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px;">Только для вас</div>
          <div style="font-size:26px;font-weight:700;color:#1A1814;margin-bottom:8px;">${v.offer_title}</div>
          <div style="font-size:13px;color:#8B7355;">Действует до ${v.offer_date}</div>
        </div>
        ${v.offer_desc ? `<p style="font-size:14px;color:#3d2e1a;line-height:1.7;margin:0 0 16px;">${v.offer_desc}</p>` : ""}
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 24px;">
          <thead><tr style="background:#f5ede0;">
            <th style="padding:9px 14px;text-align:left;font-size:11px;font-weight:700;color:#8B7355;text-transform:uppercase;border-bottom:2px solid #e8dfc8;">Товар</th>
            <th style="padding:9px 14px;text-align:right;font-size:11px;font-weight:700;color:#8B7355;text-transform:uppercase;border-bottom:2px solid #e8dfc8;">Обычная цена</th>
            <th style="padding:9px 14px;text-align:right;font-size:11px;font-weight:700;color:#C89A34;text-transform:uppercase;border-bottom:2px solid #e8dfc8;">Спец цена</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div style="text-align:center;margin:0 0 28px;">
          <div style="display:inline-block;background:linear-gradient(135deg,#C89A34,#E4C260);color:#3A2800;font-weight:700;font-size:14px;padding:12px 32px;border-radius:8px;letter-spacing:.04em;">
            Для заказа — ответьте на это письмо
          </div>
        </div>
        ${signatureHtml(v.manager)}
      `);
    },
  },
];
