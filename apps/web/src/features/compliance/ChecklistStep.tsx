import { useState } from "react";
import { caseCompleteness, LEGAL_BASIS } from "@crm/core";
import type { ChecklistEntry, ComplianceCase, DocAvailability, PrimaryDocKind, RequestingAuthority, RequestMeta } from "@crm/schemas";
import "./ComplianceFlow.css";

const RU_STATUS: Record<string, string> = {
  extracting: "Анализ",
  checklist_review: "Проверка чек-листа",
  assembling: "Сборка пакета",
  response_draft: "Черновик ответа",
  done: "Готово",
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

// Категоризация документа по типу действия
const SYSTEM_GENERATES: PrimaryDocKind[] = [
  "explanatory", "written_clarification", "debt_calculation",
  "art236_calculation", "workbook_extract",
];
const SYSTEM_RESTORES: PrimaryDocKind[] = [
  "order_hire", "order_internal", "personal_card", "contract",
  "staffing_table", "payroll_regulation", "timesheet",
];

function docCategory(docKind: PrimaryDocKind): "generates" | "restores" | "client" {
  if (SYSTEM_GENERATES.includes(docKind)) return "generates";
  if (SYSTEM_RESTORES.includes(docKind)) return "restores";
  return "client";
}

// ── Блок «О чём запрос» ───────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#8B7355", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, color: "#1A0E00", lineHeight: 1.45 }}>{value}</div>
    </div>
  );
}

function RequestMetaBlock({ authority, meta, itemCount }: {
  authority: RequestingAuthority;
  meta?: RequestMeta;
  itemCount: number;
}) {
  const basis = LEGAL_BASIS[authority];
  const m = meta ?? {};

  const deliveryText =
    m.deliveryMethod === "in_person" ? `Нарочно${m.deliveryAddress ? ` (${m.deliveryAddress})` : ""}` :
    m.deliveryMethod === "mail" ? "Почтой" :
    m.deliveryMethod === "electronic" ? "Электронно / ЭДО" : null;

  const executorText = m.executorName
    ? `${m.executorName}${m.executorPhone ? `, тел. ${m.executorPhone}` : ""}`
    : null;

  const complainantText = m.complainantName
    ? `${m.complainantName}${m.complainantRef ? ` (${m.complainantRef})` : ""}`
    : null;

  return (
    <section style={{ margin: "0 0 20px", borderRadius: 14, border: "1px solid rgba(200,160,60,0.22)", overflow: "hidden", fontSize: 14 }}>

      {/* Кому */}
      <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(200,160,60,0.12)", background: "rgba(200,160,60,0.04)" }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: "#5A3D00", marginBottom: 8 }}>КОМУ</div>
        <div style={{ color: "#1A0E00" }}>
          {[m.recipientName, m.recipientInn && `ИНН ${m.recipientInn}`, m.recipientDirector, m.recipientAddress]
            .filter(Boolean).join(" · ")}
          {!m.recipientName && <span style={{ color: "#AAA098", fontStyle: "italic" }}>{RU_AUTHORITY[authority]}</span>}
        </div>
      </div>

      {/* Основание + Повод + Дата + Срок */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
        <div style={{ padding: "14px 18px", borderRight: "1px solid rgba(200,160,60,0.12)", borderBottom: "1px solid rgba(200,160,60,0.12)" }}>
          <Field label="Основание" value={m.legalBasisText ?? (basis.norms.length ? basis.norms.join(", ") : null)} />
          <Field label="Повод" value={m.subjectText} />
          {complainantText && <Field label="Заявитель" value={complainantText} />}
        </div>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(200,160,60,0.12)" }}>
          <Field label="Дата требования" value={m.requestDate ?? undefined} />
          <Field label="Номер требования" value={m.requestNumber ?? "Не проставлен — поле пустое"} />
          <Field label="Срок" value={m.deadlineText ? `${m.deadlineText}${deliveryText ? `, ${deliveryText.toLowerCase()}` : ""}` : deliveryText} />
          <Field label="Подписал" value={m.officerName} />
          <Field label="Исполнитель" value={executorText} />
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#8B7355", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 2 }}>Позиций</div>
            <div style={{ fontSize: 14, color: "#1A0E00" }}>{itemCount}</div>
          </div>
        </div>
      </div>

      {/* Ответственность */}
      {(m.sanctionsText ?? basis.sanctions) && (
        <div style={{ padding: "12px 18px", borderBottom: "1px solid rgba(180,40,40,0.1)", background: "rgba(180,40,40,0.03)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#b42828", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Ответственность</div>
          <div style={{ fontSize: 13, color: "#3A0000", lineHeight: 1.55 }}>{m.sanctionsText ?? basis.sanctions}</div>
        </div>
      )}

      {/* Что это значит для Вас */}
      {m.topic && (
        <div style={{ padding: "12px 18px", background: "rgba(10,64,111,0.04)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#0A406F", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>Что это значит для вас</div>
          <div style={{ fontSize: 13, color: "#0A1A2E", lineHeight: 1.6 }}>{m.topic}</div>
        </div>
      )}
    </section>
  );
}

// ── Разбивка по веткам ────────────────────────────────────────────────────────

function BranchBreakdown({ items, entries }: {
  items: ComplianceCase["items"];
  entries: ChecklistEntry[];
}) {
  const generates: Array<{ num: string; label: string }> = [];
  const restores: Array<{ num: string; label: string }> = [];
  const clientOnly: Array<{ num: string; label: string }> = [];

  // Группируем entry по requestItemId → берём первый docKind
  const itemIndexMap = new Map(items.map((it, i) => [it.itemId, i]));

  for (const entry of entries) {
    const item = items.find(it => it.itemId === entry.requestItemId);
    if (!item) continue;
    const idx = itemIndexMap.get(item.itemId) ?? 0;
    const num = `п. ${idx + 1}`;
    const label = `${num} ${entry.label}`;
    const cat = docCategory(entry.docKind);
    if (cat === "generates") generates.push({ num, label });
    else if (cat === "restores") restores.push({ num, label });
    else clientOnly.push({ num, label });
  }

  // Дедуплицируем по label
  const dedup = (arr: Array<{ num: string; label: string }>) =>
    arr.filter((v, i, a) => a.findIndex(x => x.label === v.label) === i);

  const g = dedup(generates);
  const r = dedup(restores);
  const c = dedup(clientOnly);

  return (
    <div style={{ margin: "16px 0", borderRadius: 12, border: "1px solid rgba(200,160,60,0.2)", overflow: "hidden" }}>
      <div style={{ padding: "10px 18px", background: "rgba(200,160,60,0.08)", borderBottom: "1px solid rgba(200,160,60,0.15)", fontWeight: 700, fontSize: 13, color: "#3A2800" }}>
        Разбивка по веткам
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0 }}>
        <BranchCol title="Составляет система" color="#1a6b2a" bg="rgba(26,107,42,0.04)" items={g} />
        <BranchCol title="Восстанавливает по форме" color="#5A3D00" bg="rgba(200,160,60,0.04)" items={r} borderLeft borderRight />
        <BranchCol title="Только у клиента" color="#0A406F" bg="rgba(10,64,111,0.04)" items={c} />
      </div>
    </div>
  );
}

function BranchCol({ title, color, bg, items, borderLeft, borderRight }: {
  title: string; color: string; bg: string;
  items: Array<{ num: string; label: string }>;
  borderLeft?: boolean; borderRight?: boolean;
}) {
  return (
    <div style={{
      padding: "12px 14px", background: bg,
      borderLeft: borderLeft ? "1px solid rgba(200,160,60,0.15)" : undefined,
      borderRight: borderRight ? "1px solid rgba(200,160,60,0.15)" : undefined,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>{title}</div>
      {items.length === 0
        ? <div style={{ fontSize: 12, color: "#AAA098", fontStyle: "italic" }}>—</div>
        : items.map((it, i) => (
          <div key={i} style={{ fontSize: 12, color: "#1A0E00", marginBottom: 4, lineHeight: 1.4 }}>· {it.label}</div>
        ))
      }
    </div>
  );
}

// ── Availability badge ────────────────────────────────────────────────────────

function AvailabilityBadge({ avail }: { avail: DocAvailability }) {
  switch (avail) {
    case "have_file":     return <span className="compliance-badge compliance-badge--green">Есть файл</span>;
    case "have_paper":    return <span className="compliance-badge compliance-badge--blue">На бумаге</span>;
    case "restorable":    return <span className="compliance-badge compliance-badge--yellow">Восстановим</span>;
    case "missing_no_event": return <span className="compliance-badge compliance-badge--grey">Отсутствует</span>;
    case "not_applicable":   return <span className="compliance-badge compliance-badge--grey">Не применимо</span>;
    default: return null;
  }
}

function toggleEntry(caseData: ComplianceCase, entryId: string): ComplianceCase {
  return {
    ...caseData,
    checklist: caseData.checklist.map(e =>
      e.entryId === entryId ? { ...e, confirmedByOwner: !e.confirmedByOwner } : e
    ),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface Props {
  caseData: ComplianceCase;
  onChange: (updated: ComplianceCase) => void;
  onNewCase?: () => void;
  onLogout?: () => void;
  /** Вызывается вместо прямого запуска сборки — оркестратор решает нужны ли поля */
  onRequestAssemble: () => void;
  assembling?: boolean;
  assembleError?: string | null;
}

export function ChecklistStep({ caseData, onChange, onNewCase, onLogout, onRequestAssemble, assembling = false, assembleError = null }: Props) {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const completeness = caseCompleteness(caseData.checklist);
  const pct = Math.round(completeness * 100);

  const grouped = new Map<string, ChecklistEntry[]>();
  for (const entry of caseData.checklist) {
    const list = grouped.get(entry.requestItemId) ?? [];
    list.push(entry);
    grouped.set(entry.requestItemId, list);
  }

  function handleAssemble() {
    setShowBreakdown(true);
    onRequestAssemble();
  }

  return (
    <div className="compliance-checklist">
      <div className="compliance-checklist-header">
        <h2 className="compliance-checklist-title">Чек-лист документов</h2>
        <span className="compliance-badge compliance-badge--yellow">{RU_STATUS[caseData.status] ?? caseData.status}</span>
      </div>

      {/* О чём запрос */}
      <RequestMetaBlock
        authority={caseData.authority}
        meta={caseData.requestMeta}
        itemCount={caseData.items.length}
      />

      {/* Разбивка — появляется только после нажатия кнопки */}
      {showBreakdown && (
        <BranchBreakdown items={caseData.items} entries={caseData.checklist} />
      )}

      {/* Progress */}
      <div className="compliance-progress">
        <div className="compliance-progress-bar" style={{ width: `${pct}%` }} />
      </div>
      <p style={{ margin: "0 0 20px", fontSize: 13, color: "#8B7355" }}>
        Готовность пакета: <strong>{pct}%</strong>
      </p>

      {/* Список документов по группам */}
      {caseData.items.map(item => {
        const entries = grouped.get(item.itemId) ?? [];
        return (
          <div key={item.itemId} className="compliance-group">
            <p className="compliance-group-title">
              {item.rawText.length > 80 ? item.rawText.slice(0, 80) + "…" : item.rawText}
            </p>
            {entries.map(entry => {
              const canConfirm = entry.availability !== "not_applicable";
              const isMissing = entry.availability === "missing_no_event";
              return (
                <div key={entry.entryId} className="compliance-entry">
                  <div style={{ flex: 1 }}>
                    <p className="compliance-entry-label">{entry.label}</p>
                    {entry.availability === "restorable" && entry.evidence.length > 0 && (
                      <p className="compliance-entry-sub">Основание: {entry.evidence.length} операций</p>
                    )}
                  </div>
                  <div className="compliance-entry-right">
                    <AvailabilityBadge avail={entry.availability} />
                    {canConfirm && (
                      <label className="crm-v2-check-label" style={{ gap: 6, cursor: "pointer", fontSize: 12, color: "#5A3D00" }}>
                        <input
                          type="checkbox"
                          className="compliance-checkbox"
                          checked={entry.confirmedByOwner}
                          onChange={() => {
                            if (isMissing && !entry.confirmedByOwner) {
                              onChange({
                                ...caseData,
                                checklist: caseData.checklist.map(e =>
                                  e.entryId === entry.entryId
                                    ? { ...e, confirmedByOwner: true, availability: "have_paper" }
                                    : e
                                ),
                              });
                            } else {
                              onChange(toggleEntry(caseData, entry.entryId));
                            }
                          }}
                          aria-label={`Подтвердить: ${entry.label}`}
                        />
                        {isMissing && !entry.confirmedByOwner ? "Есть у меня" : ""}
                      </label>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {assembleError && <p style={{ color: "#c62828", fontSize: 13, margin: "8px 0 0" }}>{assembleError}</p>}

      <button
        className="compliance-assemble-btn"
        onClick={handleAssemble}
        type="button"
        disabled={assembling}
      >
        {assembling ? "Собираем пакет…" : "Собрать пакет"}
      </button>

      <div style={{ display: "flex", gap: 12, marginTop: 16, width: "100%", flexWrap: "wrap" }}>
        {onNewCase && (
          <button type="button" className="paywall-back" onClick={onNewCase}>
            + Новый кейс
          </button>
        )}
        {onLogout && (
          <button type="button" className="paywall-back" style={{ marginLeft: "auto" }} onClick={onLogout}>
            Сменить пользователя
          </button>
        )}
      </div>
    </div>
  );
}
