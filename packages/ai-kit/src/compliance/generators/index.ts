import type { PrimaryDocKind } from "@crm/schemas";
import type { DocGenerator } from "./types.js";
import { ok } from "@crm/core";

// --- Простые генераторы (без LLM) ---

const orderHire: DocGenerator = {
  docKind: "order_hire",
  title: "Приказ о приёме на работу",
  requiredFields: [
    { key: "employeeName", label: "ФИО работника", type: "text", required: true },
    { key: "position", label: "Должность", type: "text", required: true },
    { key: "hireDate", label: "Дата приёма", type: "date", required: true },
    { key: "salary", label: "Оклад (коп.)", type: "money", required: true },
  ],
  render: (f) => ok(
    `ПРИКАЗ о приёме на работу\n\nПринять ${f.employeeName} на должность ${f.position} с ${f.hireDate}.\nОклад: ${f.salary} коп.\n\nДиректор [ЗАПОЛНИТЬ]`,
  ),
  needsLLM: false,
};

const personalCard: DocGenerator = {
  docKind: "personal_card",
  title: "Личная карточка (Т-2)",
  requiredFields: [
    { key: "employeeName", label: "ФИО", type: "text", required: true },
    { key: "birthDate", label: "Дата рождения", type: "date", required: true },
    { key: "position", label: "Должность", type: "text", required: true },
  ],
  render: (f) => ok(
    `ЛИЧНАЯ КАРТОЧКА РАБОТНИКА (Т-2)\n\nФИО: ${f.employeeName}\nДата рождения: ${f.birthDate}\nДолжность: ${f.position}\n\n[ЗАПОЛНИТЬ: остальные разделы]`,
  ),
  needsLLM: false,
};

const staffingTable: DocGenerator = {
  docKind: "staffing_table",
  title: "Штатное расписание",
  requiredFields: [
    { key: "effectiveDate", label: "Дата ввода", type: "date", required: true },
    { key: "positions", label: "Список должностей (текст)", type: "text", required: true },
  ],
  render: (f) => ok(
    `ШТАТНОЕ РАСПИСАНИЕ\nВведено в действие: ${f.effectiveDate}\n\n${f.positions}\n\nДиректор [ЗАПОЛНИТЬ]`,
  ),
  needsLLM: false,
};

const timesheet: DocGenerator = {
  docKind: "timesheet",
  title: "Табель учёта рабочего времени",
  requiredFields: [
    { key: "period", label: "Период", type: "text", required: true },
    { key: "department", label: "Подразделение", type: "text", required: true },
  ],
  render: (f) => ok(
    `ТАБЕЛЬ УЧЁТА РАБОЧЕГО ВРЕМЕНИ\nПериод: ${f.period}\nПодразделение: ${f.department}\n\n[ЗАПОЛНИТЬ: данные по сотрудникам]`,
  ),
  needsLLM: false,
};

const workbookExtract: DocGenerator = {
  docKind: "workbook_extract",
  title: "Выписка из трудовой книжки",
  requiredFields: [
    { key: "employeeName", label: "ФИО", type: "text", required: true },
    { key: "records", label: "Записи (текст)", type: "text", required: true },
  ],
  render: (f) => ok(
    `ВЫПИСКА ИЗ ТРУДОВОЙ КНИЖКИ\nФИО: ${f.employeeName}\n\n${f.records}\n\nВерно. [ЗАПОЛНИТЬ: подпись, печать]`,
  ),
  needsLLM: false,
};

const debtCalculation: DocGenerator = {
  docKind: "debt_calculation",
  title: "Расчёт задолженности",
  requiredFields: [
    { key: "debtor", label: "Должник", type: "text", required: true },
    { key: "totalKopecks", label: "Сумма (коп.)", type: "money", required: true },
    { key: "period", label: "Период", type: "text", required: true },
  ],
  render: (f) => ok(
    `РАСЧЁТ ЗАДОЛЖЕННОСТИ\nДолжник: ${f.debtor}\nПериод: ${f.period}\nСумма: ${f.totalKopecks} коп.\n\n[ЗАПОЛНИТЬ: детализация]`,
  ),
  needsLLM: false,
};

const art236Calculation: DocGenerator = {
  docKind: "art236_calculation",
  title: "Расчёт компенсации ст. 236 ТК РФ",
  requiredFields: [
    { key: "employeeName", label: "ФИО", type: "text", required: true },
    { key: "lines", label: "Результат computeArt236 (JSON)", type: "text", required: true },
    { key: "totalKopecks", label: "Итого (коп.)", type: "money", required: true },
  ],
  render: (f) => ok(
    `РАСЧЁТ КОМПЕНСАЦИИ (ст. 236 ТК РФ)\nРаботник: ${f.employeeName}\n\n${f.lines}\n\nИтого: ${f.totalKopecks} коп.`,
  ),
  needsLLM: false,
};

// --- LLM-генераторы (needsLLM: true, render — заглушка) ---

const payrollRegulation: DocGenerator = {
  docKind: "payroll_regulation",
  title: "Положение об оплате труда",
  requiredFields: [
    { key: "companyName", label: "Наименование", type: "text", required: true },
  ],
  render: (f) => ok(`[LLM] Положение об оплате труда — ${f.companyName}`),
  needsLLM: true,
};

const explanatory: DocGenerator = {
  docKind: "explanatory",
  title: "Пояснительная записка",
  requiredFields: [],
  render: () => ok(`[LLM] Пояснительная записка`),
  needsLLM: true,
};

const writtenClarification: DocGenerator = {
  docKind: "written_clarification",
  title: "Письменные пояснения",
  requiredFields: [],
  render: () => ok(`[LLM] Письменные пояснения`),
  needsLLM: true,
};

/**
 * Реестр генераторов. null = документ третьей стороны, не генерируется.
 * Record<PrimaryDocKind, ...> — пропуск ключа = ошибка компиляции.
 */
export const GENERATORS: Record<PrimaryDocKind, DocGenerator | null> = {
  payment_order: null,
  bank_statement: null,
  account_card: null,
  contract: null,
  act: null,
  waybill: null,
  invoice: null,
  invoice_facture: null,
  order_internal: null,
  explanatory,
  order_hire: orderHire,
  personal_card: personalCard,
  staffing_table: staffingTable,
  timesheet,
  workbook_extract: workbookExtract,
  debt_calculation: debtCalculation,
  art236_calculation: art236Calculation,
  payroll_regulation: payrollRegulation,
  written_clarification: writtenClarification,
  other: null,
};

export type { DocGenerator } from "./types.js";
