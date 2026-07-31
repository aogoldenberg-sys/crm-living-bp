import type { RequestItem, ChecklistEntry } from "@crm/schemas";

interface Props {
  items: RequestItem[];
  entries: ChecklistEntry[];
  onConfirm: () => void;
}

const RU_AVAIL: Record<string, string> = {
  have_file: "Файл загружен",
  have_paper: "Есть на бумаге",
  restorable: "Восстановим",
  missing_no_event: "Отсутствует",
  not_applicable: "Не применимо",
};

export function RequestSummary({ items, entries, onConfirm }: Props) {
  const byItem = new Map<string, ChecklistEntry[]>();
  for (const e of entries) {
    const list = byItem.get(e.requestItemId) ?? [];
    list.push(e);
    byItem.set(e.requestItemId, list);
  }

  const openCount = entries.filter(e => e.availability === "missing_no_event").length;

  return (
    <div className="crm-v2-panel">
      <h2 className="crm-v2-title">Пункты требования</h2>
      <p className="crm-v2-sub">
        Система сопоставила запрос с журналом событий.
        {openCount > 0 && <> <strong>{openCount} позиций</strong> требуют уточнения.</>}
      </p>

      {items.map(item => {
        const itemEntries = byItem.get(item.itemId) ?? [];
        return (
          <div key={item.itemId} className="crm-v2-group">
            <p className="crm-v2-group-text">
              {item.rawText.length > 100 ? item.rawText.slice(0, 100) + "…" : item.rawText}
            </p>
            {itemEntries.map(e => (
              <div key={e.entryId} className="crm-v2-entry">
                <span className="crm-v2-entry-label">{e.label}</span>
                <span className={`crm-v2-badge crm-v2-badge--${e.availability}`}>
                  {RU_AVAIL[e.availability] ?? e.availability}
                </span>
              </div>
            ))}
          </div>
        );
      })}

      <button type="button" className="crm-v2-btn" onClick={onConfirm}>
        {openCount > 0 ? "Уточнить недостающие" : "Собрать пакет"}
      </button>
    </div>
  );
}
