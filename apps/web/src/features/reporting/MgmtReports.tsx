import { useState } from "react";
import * as XLSX from "xlsx";
import { computePnL, computeCashFlow, computeMgmtBalance } from "@crm/core";
import { useBusinessEvents } from "./useBusinessEvents";
import "./MgmtReports.print.css";

interface Props {
  businessId: string;
}

const YEAR = new Date().getFullYear();

// ── Minimal CSV builder → opens in Excel ──────────────────────────────────────

function downloadCsv(rows: string[][], filename: string) {
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }); // BOM for Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadXlsx(sheetData: unknown[][], filename: string) {
  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Отчёт");
  XLSX.writeFile(wb, filename);
}

function fmtRub(kop: number): string {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(kop / 100);
}

function fmtMonth(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", { month: "short", year: "numeric" });
}

// ── Views ─────────────────────────────────────────────────────────────────────

function PnLView({ businessId, events }: { businessId: string; events: Parameters<typeof computePnL>[0] }) {
  const now = new Date().toISOString();
  const result = computePnL(events, businessId, YEAR, now);

  if (!result.ok) {
    return (
      <p style={{ color: "#8B7355", fontSize: 13, margin: "24px 0" }}>
        Нет платёжных событий за {YEAR}. Загрузите банковскую выписку через Дашборд.
      </p>
    );
  }

  const { rows, totalRevenue, totalNetProfit } = result.value;

  function handleDownload() {
    const headers = ["Месяц", "Выручка", "Себест.", "Вал. прибыль", "OpEx", "EBITDA", "Чист. прибыль"];
    const data = rows.map((r) => [
      fmtMonth(r.month),
      r.revenue / 100,
      r.cogs / 100,
      r.grossProfit / 100,
      r.opex / 100,
      r.ebitda / 100,
      r.netProfit / 100,
    ]);
    data.push(["ИТОГО", totalRevenue / 100, "", "", "", "", totalNetProfit / 100]);
    downloadXlsx([headers, ...data], `П_и_Л_${YEAR}.xlsx`);
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div>
          <span style={{ fontSize: 13, color: "#8B7355" }}>Выручка: </span>
          <strong style={{ color: "#1A1814" }}>{fmtRub(totalRevenue)}</strong>
          <span style={{ margin: "0 12px", fontSize: 13, color: "#8B7355" }}>Чист. прибыль: </span>
          <strong style={{ color: totalNetProfit >= 0 ? "#1A6B32" : "#B91C1C" }}>{fmtRub(totalNetProfit)}</strong>
        </div>
        <button onClick={handleDownload} style={dlBtnStyle}>📥 XLSX</button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              {["Месяц", "Выручка", "Себест.", "Вал. прибыль", "OpEx", "EBITDA", "Чист. прибыль"].map((h) => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month}>
                <td style={tdStyle}>{fmtMonth(r.month)}</td>
                <td style={tdStyle}>{fmtRub(r.revenue)}</td>
                <td style={tdStyle}>{fmtRub(r.cogs)}</td>
                <td style={{ ...tdStyle, color: r.grossProfit >= 0 ? "#1A6B32" : "#B91C1C" }}>{fmtRub(r.grossProfit)}</td>
                <td style={tdStyle}>{fmtRub(r.opex)}</td>
                <td style={{ ...tdStyle, color: r.ebitda >= 0 ? "#1A6B32" : "#B91C1C" }}>{fmtRub(r.ebitda)}</td>
                <td style={{ ...tdStyle, fontWeight: 600, color: r.netProfit >= 0 ? "#1A6B32" : "#B91C1C" }}>{fmtRub(r.netProfit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CashFlowView({ businessId, events }: { businessId: string; events: Parameters<typeof computeCashFlow>[0] }) {
  const now = new Date().toISOString();
  const result = computeCashFlow(events, businessId, YEAR, now);

  if (!result.ok) {
    return (
      <p style={{ color: "#8B7355", fontSize: 13, margin: "24px 0" }}>
        Нет платёжных событий за {YEAR}. Загрузите банковскую выписку через Дашборд.
      </p>
    );
  }

  const { rows } = result.value;

  function handleDownload() {
    const headers = ["Месяц", "Опер. CF", "Инвест. CF", "Финанс. CF", "Чист. CF", "Баланс"];
    const data = rows.map((r) => [
      fmtMonth(r.month),
      r.operatingCf / 100,
      r.investingCf / 100,
      r.financingCf / 100,
      r.netCf / 100,
      r.endBalance / 100,
    ]);
    downloadXlsx([headers, ...data], `CashFlow_${YEAR}.xlsx`);
  }

  return (
    <>
      <div style={{ textAlign: "right", marginBottom: 12 }}>
        <button onClick={handleDownload} style={dlBtnStyle}>📥 XLSX</button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              {["Месяц", "Опер. CF", "Инвест. CF", "Финанс. CF", "Чист. CF", "Баланс на конец"].map((h) => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.month}>
                <td style={tdStyle}>{fmtMonth(r.month)}</td>
                <td style={{ ...tdStyle, color: r.operatingCf >= 0 ? "#1A6B32" : "#B91C1C" }}>{fmtRub(r.operatingCf)}</td>
                <td style={tdStyle}>{fmtRub(r.investingCf)}</td>
                <td style={tdStyle}>{fmtRub(r.financingCf)}</td>
                <td style={{ ...tdStyle, fontWeight: 600, color: r.netCf >= 0 ? "#1A6B32" : "#B91C1C" }}>{fmtRub(r.netCf)}</td>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{fmtRub(r.endBalance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function BalanceView({ events }: { events: Parameters<typeof computePnL>[0] }) {
  const asOfIso = new Date().toISOString();
  const bal = computeMgmtBalance(events, asOfIso);
  const asOf = new Date().toLocaleDateString("ru-RU");

  const hasPayments = events.some((e) => e.type === "payment_in" || e.type === "payment_out");
  if (!hasPayments) {
    return (
      <p style={{ color: "#8B7355", fontSize: 13, margin: "24px 0" }}>
        Нет платёжных событий. Загрузите банковскую выписку через Дашборд.
      </p>
    );
  }

  function handleDownload() {
    downloadXlsx(
      [
        ["Управленческий баланс (упрощённый)", `на ${asOf}`],
        [],
        ["Показатель", "Сумма (руб.)"],
        ["Денежные средства", bal.cash / 100],
        ["Дебиторская задолженность", bal.ar / 100],
        ["Кредиторская задолженность", bal.ap / 100],
        ["Собственный капитал", bal.equity / 100],
      ],
      `Баланс_${asOf.replace(/\./g, "-")}.xlsx`,
    );
  }

  const rows = [
    { label: "Денежные средства", value: bal.cash },
    { label: "Дебиторская задолж.", value: bal.ar },
    { label: "Кредиторская задолж.", value: bal.ap },
    { label: "Собственный капитал", value: bal.equity },
  ];

  return (
    <>
      <div style={{ textAlign: "right", marginBottom: 12 }}>
        <button onClick={handleDownload} style={dlBtnStyle}>📥 XLSX</button>
      </div>
      <p style={{ fontSize: 12, color: "#8B7355", margin: "0 0 16px" }}>
        Упрощённый баланс — кассовая позиция по событиям лога. Данные на {asOf}.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              {["Показатель", "Сумма"].map((h) => <th key={h} style={thStyle}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ label, value }) => (
              <tr key={label}>
                <td style={tdStyle}>{label}</td>
                <td style={{ ...tdStyle, fontWeight: 600, color: value < 0 ? "#B91C1C" : "#1A1814" }}>
                  {fmtRub(value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const tableStyle: React.CSSProperties = {
  width: "100%", borderCollapse: "collapse", fontSize: 13,
};
const thStyle: React.CSSProperties = {
  padding: "8px 12px", textAlign: "left", fontWeight: 600, fontSize: 12,
  color: "#8B7355", borderBottom: "2px solid rgba(200,160,60,0.2)", whiteSpace: "nowrap",
};
const tdStyle: React.CSSProperties = {
  padding: "7px 12px", borderBottom: "1px solid rgba(200,160,60,0.1)",
  color: "#1A1814", whiteSpace: "nowrap",
};
const dlBtnStyle: React.CSSProperties = {
  padding: "6px 14px", background: "linear-gradient(135deg,#C89A34,#E4C260)",
  border: "none", borderRadius: 7, fontSize: 12, fontWeight: 600,
  color: "#4A3208", cursor: "pointer",
};

// ── Main ──────────────────────────────────────────────────────────────────────

type Report = "pnl" | "cashflow" | "balance";

export function MgmtReports({ businessId }: Props) {
  const [active, setActive] = useState<Report | null>(null);
  const { data: events = [] } = useBusinessEvents(businessId);

  const cards: Array<{ id: Report; title: string; subtitle: string }> = [
    { id: "pnl", title: "П&Л", subtitle: "Доходы и расходы по месяцам" },
    { id: "cashflow", title: "Cash Flow", subtitle: "Движение денежных средств" },
    { id: "balance", title: "Баланс", subtitle: "Упрощённый управленческий баланс" },
  ];

  if (active) {
    const card = cards.find((c) => c.id === active)!;
    return (
      <div>
        <button
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#8B7355", marginBottom: 16 }}
          onClick={() => setActive(null)}
        >
          ← Назад к отчётам
        </button>
        <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700, color: "#1A1814" }}>
          {card.title} за {YEAR}
        </h3>
        {active === "pnl" && <PnLView businessId={businessId} events={events} />}
        {active === "cashflow" && <CashFlowView businessId={businessId} events={events} />}
        {active === "balance" && <BalanceView events={events} />}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: "#1A1814", margin: "0 0 4px" }}>
        Управленческая отчётность
      </h2>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "#8B7355" }}>
        Отчёты формируются из событий лога. {events.length > 0 ? `${events.length} событий в базе.` : "Загрузите банковскую выписку."}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {cards.map((card) => (
          <div
            key={card.id}
            style={{
              background: "rgba(255,255,255,0.6)", border: "1px solid rgba(200,160,60,0.25)",
              borderRadius: 12, padding: "20px 24px", display: "flex",
              alignItems: "center", justifyContent: "space-between",
            }}
          >
            <div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 15, color: "#1A1814" }}>{card.title}</p>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "#8B7355" }}>{card.subtitle}</p>
            </div>
            <button
              style={dlBtnStyle}
              onClick={() => setActive(card.id)}
            >
              Сформировать
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
