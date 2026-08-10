import { useEffect, useState } from "react";
import { collection, query, orderBy, limit, getDocs } from "firebase/firestore";
import { db } from "../../firebase";
import type { RequestingAuthority } from "@crm/schemas";
import "./ComplianceFlow.css";

const RU_AUTHORITY: Record<RequestingAuthority, string> = {
  fns_kameral: "ФНС (камеральная)",
  fns_vyezd: "ФНС (выездная)",
  fns_vstrechka: "ФНС (встречная)",
  police: "МВД / Полиция",
  prosecutor: "Прокуратура",
  bank_compliance: "Банк (115-ФЗ)",
  court: "Суд",
  bailiffs: "ФССП / Приставы",
  labor_inspection: "ГИТ",
  audit_internal: "Внутренний аудит",
  counterparty: "Контрагент",
  other: "Прочий орган",
};

const RU_STATUS: Record<string, string> = {
  extracting: "Анализ",
  checklist_review: "Чек-лист",
  assembling: "Сборка",
  response_draft: "Черновик",
  done: "Готов",
};

const STATUS_COLOR: Record<string, string> = {
  done: "#1E6B3A",
  checklist_review: "#7A5E00",
  assembling: "#7A5E00",
  extracting: "#1a5276",
  response_draft: "#5A3D00",
};

const STATUS_BG: Record<string, string> = {
  done: "#E6F5EA",
  checklist_review: "#FFF3CD",
  assembling: "#FFF3CD",
  extracting: "#E8F0FE",
  response_draft: "rgba(200,160,60,0.1)",
};

type CaseSummary = {
  caseId: string;
  authority: string;
  status: string;
  createdAt: string;
  recipientName?: string;
};

interface Props {
  businessId: string;
  onSelectCase: (caseId: string) => void;
  onNewCase: () => void;
}

export function CasesListView({ businessId, onSelectCase, onNewCase }: Props) {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) return;
    const q = query(
      collection(db, `tenants/${businessId}/compliance_cases`),
      orderBy("createdAt", "desc"),
      limit(20),
    );
    getDocs(q)
      .then((snap) => {
        const list: CaseSummary[] = snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          const meta = data.requestMeta as Record<string, unknown> | undefined;
          return {
            caseId: d.id,
            authority: (data.authority as string) ?? "other",
            status: (data.status as string) ?? "extracting",
            createdAt: (data.createdAt as string) ?? "",
            recipientName: (meta?.recipientName as string) ?? undefined,
          };
        });
        setCases(list);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [businessId]);

  function formatDate(iso: string): string {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
    } catch { return iso.slice(0, 10); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "24px 0" }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#1A1814" }}>
        Мои кейсы
      </h2>

      {/* Кнопка нового кейса */}
      <button
        type="button"
        onClick={onNewCase}
        style={{
          padding: "14px 24px",
          background: "linear-gradient(135deg, #C89A34, #E4C260)",
          border: "none",
          borderRadius: 12,
          fontSize: 15,
          fontWeight: 700,
          color: "#3A2800",
          cursor: "pointer",
          textAlign: "left",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span style={{ fontSize: 20 }}>＋</span>
        Новый кейс — загрузить требование
      </button>

      {/* Список кейсов */}
      {loading ? (
        <div style={{ color: "#8B7355", fontSize: 14, padding: "12px 0" }}>Загрузка истории…</div>
      ) : cases.length === 0 ? (
        <div style={{ color: "#8B7355", fontSize: 14, padding: "12px 0" }}>
          История пуста — загрузите первый документ
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <p style={{ margin: "0 0 4px", fontSize: 13, color: "#8B7355", fontWeight: 500 }}>
            История ({cases.length})
          </p>
          {cases.map((c) => (
            <button
              key={c.caseId}
              type="button"
              onClick={() => onSelectCase(c.caseId)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 16px",
                background: "#fff",
                border: "1px solid rgba(200,160,60,0.2)",
                borderRadius: 12,
                cursor: "pointer",
                textAlign: "left",
                transition: "box-shadow 0.15s",
              }}
              onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 2px 12px rgba(200,160,60,0.15)")}
              onMouseLeave={e => (e.currentTarget.style.boxShadow = "none")}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#1A1814", marginBottom: 2 }}>
                  {RU_AUTHORITY[c.authority as RequestingAuthority] ?? c.authority}
                  {c.recipientName && (
                    <span style={{ fontWeight: 400, color: "#8B7355", marginLeft: 6 }}>· {c.recipientName}</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "#AAA098" }}>{formatDate(c.createdAt)}</div>
              </div>
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                padding: "3px 8px",
                borderRadius: 10,
                color: STATUS_COLOR[c.status] ?? "#666",
                background: STATUS_BG[c.status] ?? "#F0F0F0",
                whiteSpace: "nowrap",
              }}>
                {RU_STATUS[c.status] ?? c.status}
              </span>
              <span style={{ color: "#C89A34", fontSize: 16 }}>›</span>
            </button>
          ))}
        </div>
      )}

      {/* Тарифы */}
      <a
        href="https://opentgp.ru/kairos/#pricing"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "block",
          marginTop: 8,
          padding: "12px 20px",
          background: "#5A3D00",
          color: "#F5E6C8",
          borderRadius: 12,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: "0.06em",
          textDecoration: "none",
          textAlign: "center",
        }}
      >
        ТАРИФЫ И ОПЛАТА
      </a>
    </div>
  );
}
