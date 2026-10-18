import type { Process } from "@crm/schemas";

/** Шаблон пайплайна заказа Густорико. */
export const ORDER_PROCESS: Process = {
  id: "gustoriko_order",
  name: "Густорико: заказ клиента",
  steps: [
    { id: "received", name: "Получен", sla_hours: 4, responsible_role: "manager" },
    { id: "approved", name: "Одобрен", sla_hours: 8, responsible_role: "owner" },
    { id: "sourcing", name: "Закупка", sla_hours: 2, responsible_role: "system" },
    { id: "invoiced", name: "Счёт выставлен", sla_hours: 24, responsible_role: "manager" },
    { id: "ordered", name: "Заказ поставщику", sla_hours: 48, responsible_role: "manager" },
    { id: "delivered", name: "Доставлено", sla_hours: 168, responsible_role: "manager" },
  ],
};
