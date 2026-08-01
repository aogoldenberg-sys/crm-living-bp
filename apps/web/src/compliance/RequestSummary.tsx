import { useState } from "react";
import type { RequestItem, ChecklistEntry, PrimaryDocKind, RequestingAuthority } from "@crm/schemas";
import { LEGAL_BASIS } from "@crm/core";

/** Что система может сделать с этим типом документа */
type DocAction = "will_compose" | "provide_self" | "export_bank";

const ACTION_LABEL: Record<DocAction, string> = {
  will_compose: "составим",
  provide_self: "приложите сами",
  export_bank: "выгрузите из банка",
};

/** Типы, для которых генератор есть (из ai-kit GENERATORS) */
const COMPOSABLE: Set<PrimaryDocKind> = new Set([
  "order_hire", "personal_card", "staffing_table", "timesheet",
  "workbook_extract", "debt_calculation", "art236_calculation",
  "payroll_regulation", "explanatory", "written_clarification",
]);

const BANK_DOCS: Set<PrimaryDocKind> = new Set([
  "payment_order", "bank_statement", "account_card",
]);

function docAction(kind: PrimaryDocKind): DocAction {
  if (COMPOSABLE.has(kind)) return "will_compose";
  if (BANK_DOCS.has(kind)) return "export_bank";
  return "provide_self";
}

const RU_AVAIL: Record<string, string> = {
  have_file: "Файл загружен",
  have_paper: "Есть на бумаге",
  restorable: "Восстановим",
  missing_no_event: "Отсутствует",
  not_applicable: "Не применимо",
};

const RU_AUTHORITY: Record<RequestingAuthority, string> = {
  fns_kameral: "ФНС (камеральная)",
  fns_vyezd: "ФНС (выездная)",
  fns_vstrechka: "ФНС (встречная)",
  police: "МВД / Полиция",
  prosecutor: "Прокуратура",
  bank_compliance: "Банк (115-ФЗ)",
  court: "Суд",
  labor_inspection: "ГИТ",
  audit_internal: "Внутренний аудит",
  counterparty: "Контрагент",
  other: "Прочий орган",
};

interface Props {
  items: RequestItem[];
  entries: ChecklistEntry[];
  authority?: RequestingAuthority;
  onConfirm: (checked: Record<string, boolean>) => void;
}

export function RequestSummary({ items, entries, authority, onConfirm }: Props) {
  // Галочки: entryId → checked (true = "у меня есть, приложу сам")
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const e of entries) {
      init[e.entryId] = e.availability === "have_file" || e.availability === "have_paper";
    }
    return init;
  });

  const toggle = (entryId: string) =>
    setChecked(prev => ({ ...prev, [entryId]: !prev[entryId] }));

  const byItem = new Map<string, ChecklistEntry[]>();
  for (const e of entries) {
    const list = byItem.get(e.requestItemId) ?? [];
    list.push(e);
    byItem.set(e.requestItemId, list);
  }

  const basis = authority ? LEGAL_BASIS[authority] : null;

  return (
    <div className="crm-v2-panel">
      {/* Блок "О чём запрос" */}
      {authority && (
        <section className="crm-v2-group crm-v2-summary-block">
          <p className="crm-v2-group-text" style={{ fontWeight: 600 }}>О чём запрос</p>
          <ul className="crm-v2-summary-list">
            <li><b>От кого:</b> {RU_AUTHORITY[authority]}</li>
            {basis && basis.norms.length > 0 && (
              <li><b>Основание:</b> {basis.norms.join(", ")}</li>
            )}
            <li><b>Что хотят:</b> {items.length} позиций документов</li>
            {basis && basis.deadlineDays !== null && (
              <li><b>Срок ответа:</b> {basis.deadlineDays} рабочих дней</li>
            )}
            {basis && basis.liability && (
              <li><b>Ответственность:</b> {basis.liability}</li>
            )}
          </ul>
        </section>
      )}

      <h2 className="crm-v2-title">Пункты требования</h2>
      <p className="crm-v2-sub">
        Отметьте галочкой документы, которые приложите сами.
      </p>

      {items.map(item => {
        const itemEntries = byItem.get(item.itemId) ?? [];
        return (
          <div key={item.itemId} className="crm-v2-group">
            <p className="crm-v2-group-text">
              {item.rawText.length > 100 ? item.rawText.slice(0, 100) + "\u2026" : item.rawText}
            </p>
            {itemEntries.map(e => (
              <div key={e.entryId} className="crm-v2-entry">
                <label className="crm-v2-check-label">
                  <input
                    type="checkbox"
                    checked={!!checked[e.entryId]}
                    onChange={() => toggle(e.entryId)}
                  />
                  <span className="crm-v2-entry-label">{e.label}</span>
                </label>
                <span className={`crm-v2-badge crm-v2-badge--${e.availability}`}>
                  {checked[e.entryId]
                    ? "приложите сами"
                    : ACTION_LABEL[docAction(e.docKind as PrimaryDocKind)] ?? RU_AVAIL[e.availability] ?? e.availability
                  }
                </span>
              </div>
            ))}
          </div>
        );
      })}

      <button type="button" className="crm-v2-btn" onClick={() => onConfirm(checked)}>
        Далее
      </button>
    </div>
  );
}
