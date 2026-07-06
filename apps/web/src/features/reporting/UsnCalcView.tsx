import { useState } from "react";
import { computeUsn6, computeUsn15, computeKudir } from "@crm/core";
import type { TaxProfile, TaxPeriod } from "@crm/schemas";
import type { BusinessEvent } from "@crm/schemas";
import "./TaxReportingScreen.css";

interface Props {
  mode: "usn" | "kudir";
  events: readonly BusinessEvent[];
  businessId: string;
}

const CURRENT_YEAR = new Date().getFullYear();

// ── Minimal УСН XML serializer ───────────────────────────────────────────────

function serializeUsnXml(decl: ReturnType<typeof computeUsn6 | typeof computeUsn15>): string {
  if (!decl.ok) return "";
  const d = decl.value;
  const fmtKop = (n: number) => (n / 100).toFixed(2);
  return `<?xml version="1.0" encoding="UTF-8"?>
<УСН xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <Декларация>
    <ИД>${d.declarationId}</ИД>
    <ИНН>${d.profileInn}</ИНН>
    <Период>${d.period.year}</Период>
    <Режим>${d.regime}</Режим>
    <Доход1кв>${fmtKop(d.incomeByQuarter[0] ?? 0)}</Доход1кв>
    <Доход2кв>${fmtKop(d.incomeByQuarter[1] ?? 0)}</Доход2кв>
    <Доход3кв>${fmtKop(d.incomeByQuarter[2] ?? 0)}</Доход3кв>
    <ДоходГод>${fmtKop(d.incomeByQuarter[3] ?? 0)}</ДоходГод>
    <НалогКуплате>${fmtKop(d.taxToPay)}</НалогКуплате>
    <Уверенность>${d.confidence}</Уверенность>
    <СтатусЧерновик>${d.status}</СтатусЧерновик>
    ${d.warnings.map((w) => `<Предупреждение>${w}</Предупреждение>`).join("\n    ")}
  </Декларация>
</УСН>`;
}

function serializeKudirXml(kudir: ReturnType<typeof computeKudir>): string {
  if (!kudir.ok) return "";
  const k = kudir.value;
  const fmtKop = (n: number | null) => (n ? (n / 100).toFixed(2) : "");
  return `<?xml version="1.0" encoding="UTF-8"?>
<КУДиР xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <ИНН>${k.profileInn}</ИНН>
  <Период>${k.period.year}</Период>
  <СуммаДоходов>${fmtKop(k.totalIncome)}</СуммаДоходов>
  <СуммаРасходов>${fmtKop(k.totalExpense)}</СуммаРасходов>
  <Строки>
${k.rows.map((r) => `    <Строка>
      <№>${r.rowNo}</№>
      <Дата>${r.date}</Дата>
      <Документ>${r.docRef}</Документ>
      <Содержание>${r.content}</Содержание>
      <Доход>${fmtKop(r.income)}</Доход>
      <Расход>${fmtKop(r.expense)}</Расход>
    </Строка>`).join("\n")}
  </Строки>
</КУДиР>`;
}

function downloadXml(xml: string, filename: string) {
  const blob = new Blob([xml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Component ────────────────────────────────────────────────────────────────

export function UsnCalcView({ mode, events, businessId: _ }: Props) {
  const [year, setYear] = useState(CURRENT_YEAR);
  const [inn, setInn] = useState("");
  const [oktmo, setOktmo] = useState("");
  const [regime, setRegime] = useState<"usn6" | "usn15">("usn6");
  const [rate, setRate] = useState(6);
  const [employees, setEmployees] = useState(false);
  const [computed, setComputed] = useState(false);

  const now = new Date().toISOString();
  const period: TaxPeriod = { year, quarter: null };

  const profile: TaxProfile = {
    inn: inn || "000000000000",
    kpp: null,                    // ИП — всегда null
    legalForm: "ip",
    regime,
    regimeConfirmedByOwner: true, // пользователь выбирает осознанно
    oktmo: oktmo || "00000000",   // 8 цифр — заглушка, пользователь должен ввести
    taxRatePct: rate,
    employees,
  };

  const usnResult = computed
    ? (regime === "usn6"
        ? computeUsn6(events, profile, year, () => crypto.randomUUID(), now)
        : computeUsn15(events, profile, year, () => crypto.randomUUID(), now))
    : null;

  const kudirResult = computed ? computeKudir(events, profile, period, now) : null;

  const hasEvents = events.filter(
    (e) => e.type === "payment_in" || e.type === "payment_out",
  ).length > 0;

  function handleCompute() {
    setComputed(true);
  }

  const fmtRub = (kop: number) =>
    new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(kop / 100);

  return (
    <div className="tax-calc">
      {/* Форма профиля */}
      <div className="tax-calc-form">
        <div className="tax-field">
          <label className="tax-label">Год</label>
          <select
            className="tax-input"
            value={year}
            onChange={(e) => { setYear(Number(e.target.value)); setComputed(false); }}
          >
            {[CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <div className="tax-field">
          <label className="tax-label">ИНН</label>
          <input
            className="tax-input"
            type="text"
            maxLength={12}
            placeholder="123456789012"
            value={inn}
            onChange={(e) => setInn(e.target.value)}
          />
        </div>

        <div className="tax-field">
          <label className="tax-label">ОКТМО</label>
          <input
            className="tax-input"
            type="text"
            maxLength={11}
            placeholder="12345678"
            value={oktmo}
            onChange={(e) => setOktmo(e.target.value)}
          />
        </div>

        {mode === "usn" && (
          <>
            <div className="tax-field">
              <label className="tax-label">Режим</label>
              <select
                className="tax-input"
                value={regime}
                onChange={(e) => { setRegime(e.target.value as "usn6" | "usn15"); setRate(e.target.value === "usn6" ? 6 : 15); setComputed(false); }}
              >
                <option value="usn6">УСН 6% (доходы)</option>
                <option value="usn15">УСН 15% (доходы минус расходы)</option>
              </select>
            </div>

            <div className="tax-field">
              <label className="tax-label">Ставка %</label>
              <input
                className="tax-input"
                type="number"
                min={0}
                max={20}
                step={0.5}
                value={rate}
                onChange={(e) => { setRate(Number(e.target.value)); setComputed(false); }}
              />
            </div>

            <div className="tax-field tax-field--check">
              <label className="tax-label tax-label--check">
                <input
                  type="checkbox"
                  checked={employees}
                  onChange={(e) => { setEmployees(e.target.checked); setComputed(false); }}
                />
                Есть наёмные работники
              </label>
            </div>
          </>
        )}

        {!hasEvents && (
          <div className="tax-no-events">
            ⚠️ Нет событий за {year} в базе. Загрузите банковскую выписку через «Загрузить XML документ ФНС» или обратитесь к вашему бухгалтеру.
          </div>
        )}

        <button
          className="tax-calc-btn"
          onClick={handleCompute}
          disabled={!hasEvents}
          type="button"
        >
          Рассчитать
        </button>
      </div>

      {/* Результаты УСН */}
      {mode === "usn" && usnResult && (
        <div className="tax-result">
          {usnResult.ok ? (
            <>
              <div className="tax-result-header">
                <span className="tax-result-label">Налог к уплате за {year}</span>
                <span className="tax-result-amount">{fmtRub(usnResult.value.taxToPay)}</span>
              </div>
              <table className="tax-table">
                <thead>
                  <tr>
                    <th>Квартал</th>
                    <th>Доход (нарастающим)</th>
                    <th>Авансовый платёж</th>
                  </tr>
                </thead>
                <tbody>
                  {([1, 2, 3, 4] as const).map((q) => (
                    <tr key={q}>
                      <td>{q} кв.</td>
                      <td>{fmtRub(usnResult.value.incomeByQuarter[q - 1] ?? 0)}</td>
                      <td>{fmtRub(usnResult.value.taxByQuarter[q - 1] ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {usnResult.value.warnings.length > 0 && (
                <div className="tax-warnings">
                  {usnResult.value.warnings.map((w, i) => <p key={i} className="tax-warning">⚠️ {w}</p>)}
                </div>
              )}
              <div className="tax-result-actions">
                <button
                  type="button"
                  className="tax-download-btn"
                  onClick={() => downloadXml(serializeUsnXml(usnResult), `УСН_${year}_черновик.xml`)}
                >
                  📥 Скачать XML
                </button>
              </div>
            </>
          ) : (
            <p className="tax-error">⚠️ {usnResult.error.detail}</p>
          )}
        </div>
      )}

      {/* Результаты КУДиР */}
      {mode === "kudir" && kudirResult && (
        <div className="tax-result">
          {kudirResult.ok ? (
            <>
              <div className="tax-result-header">
                <span className="tax-result-label">КУДиР за {year}</span>
                <span className="tax-result-amount">{kudirResult.value.rows.length} строк</span>
              </div>
              <table className="tax-table">
                <thead>
                  <tr>
                    <th>№</th>
                    <th>Дата</th>
                    <th>Содержание</th>
                    <th>Доход</th>
                    <th>Расход</th>
                  </tr>
                </thead>
                <tbody>
                  {kudirResult.value.rows.slice(0, 50).map((r) => (
                    <tr key={r.rowNo}>
                      <td>{r.rowNo}</td>
                      <td>{r.date}</td>
                      <td style={{ maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.content}</td>
                      <td>{r.income ? fmtRub(r.income) : ""}</td>
                      <td>{r.expense ? fmtRub(r.expense) : ""}</td>
                    </tr>
                  ))}
                  {kudirResult.value.rows.length > 50 && (
                    <tr><td colSpan={5} style={{ color: "#8B7355", textAlign: "center", fontStyle: "italic" }}>...ещё {kudirResult.value.rows.length - 50} строк в XML</td></tr>
                  )}
                </tbody>
              </table>
              <div className="tax-result-summary">
                <span>Итого доход: <strong>{fmtRub(kudirResult.value.totalIncome)}</strong></span>
                {kudirResult.value.totalExpense != null && (
                  <span>Итого расход: <strong>{fmtRub(kudirResult.value.totalExpense)}</strong></span>
                )}
              </div>
              <div className="tax-result-actions">
                <button
                  type="button"
                  className="tax-download-btn"
                  onClick={() => downloadXml(serializeKudirXml(kudirResult), `КУДиР_${year}_черновик.xml`)}
                >
                  📥 Скачать XML
                </button>
              </div>
            </>
          ) : (
            <p className="tax-error">⚠️ {kudirResult.error.detail}</p>
          )}
        </div>
      )}
    </div>
  );
}
