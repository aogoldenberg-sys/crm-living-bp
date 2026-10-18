import { useState, useMemo } from "react";
import catalog from "../suppliersCatalog.json";
import "../orders.css";

interface Supplier {
  name: string;
  category: string;
  cat: string;
  icon: string;
  assortment: string;
  prices: string;
  conditions: string;
  status: string;
  section: string;
  // поля для будущего заполнения
  contact?: string;
  phone?: string;
  email?: string;
  hasContract?: boolean;
  paymentTerms?: string;
  sheetUrl?: string;
}

interface CategoryGroup {
  cat: string;
  icon: string;
  suppliers: Supplier[];
}

const data = catalog as CategoryGroup[];

function statusColor(status: string): string {
  if (status.startsWith("✅")) return "#16A34A";
  if (status.startsWith("⚠️")) return "#D97706";
  if (status.startsWith("📩")) return "#2563EB";
  if (status.startsWith("📤")) return "#7C3AED";
  if (status.startsWith("❓")) return "#9CA3AF";
  if (status.startsWith("✍️")) return "#D97706";
  return "#6B7280";
}

function sectionLabel(section: string) {
  return section === "current" ? "Работаем" : "Новый";
}

export function SuppliersView(_: { businessId: string }) {
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [openCat, setOpenCat] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data
      .map((group) => ({
        ...group,
        suppliers: group.suppliers.filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.category.toLowerCase().includes(q) ||
            s.assortment.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.suppliers.length > 0);
  }, [search]);

  const totalSuppliers = data.reduce((n, g) => n + g.suppliers.length, 0);

  return (
    <div className="go-main">
      <div className="go-header">
        <h1 className="go-title">Поставщики · Густорико</h1>
      </div>

      <div className="go-stats">
        <div className="go-stat-card">
          <div className="label">Всего поставщиков</div>
          <div className="value">{totalSuppliers}</div>
        </div>
        <div className="go-stat-card">
          <div className="label">Категорий</div>
          <div className="value">{data.length}</div>
        </div>
        <div className="go-stat-card">
          <div className="label">Работаем сейчас</div>
          <div className="value">{data.reduce((n, g) => n + g.suppliers.filter((s) => s.section === "current").length, 0)}</div>
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <input
          className="go-search-input"
          placeholder="Поиск по поставщику, категории, ассортименту..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOpenCat(null); setOpenId(null); }}
        />
      </div>

      <div className="go-cat-grid">
        {filtered.map((group) => {
          const isCatOpen = openCat === group.cat;
          return (
            <div key={group.cat}>
              {/* Category header */}
              <button
                className={`go-cat-card${isCatOpen ? " go-cat-card--active" : ""}`}
                onClick={() => { setOpenCat(isCatOpen ? null : group.cat); setOpenId(null); }}
              >
                <span className="go-cat-icon">{group.icon}</span>
                <div className="go-cat-info">
                  <span className="go-cat-name">{group.cat}</span>
                  <span className="go-cat-counts">{group.suppliers.length} поставщика</span>
                </div>
                <span className="go-cat-chevron">{isCatOpen ? "▲" : "▼"}</span>
              </button>

              {/* Suppliers list */}
              {isCatOpen && (
                <div className="go-sup-list">
                  {group.suppliers.map((s) => {
                    const isOpen = openId === s.name;
                    return (
                      <div key={s.name}>
                        {/* Supplier row */}
                        <div
                          className={`go-sup-row${isOpen ? " go-sup-row--open" : ""}`}
                          onClick={() => setOpenId(isOpen ? null : s.name)}
                        >
                          <div className="go-sup-row-main">
                            <span className="go-sup-name">{s.name}</span>
                            <span className="go-sup-cat">{s.category}</span>
                          </div>
                          <div className="go-sup-row-meta">
                            <span
                              className="go-badge"
                              style={{ background: statusColor(s.status) + "18", color: statusColor(s.status), fontSize: 11 }}
                            >
                              {s.status}
                            </span>
                            <span
                              className="go-badge"
                              style={{ background: s.section === "current" ? "rgba(22,163,74,.12)" : "rgba(37,99,235,.1)", color: s.section === "current" ? "#16A34A" : "#2563EB", fontSize: 11 }}
                            >
                              {sectionLabel(s.section)}
                            </span>
                            <span className="go-sup-chevron">{isOpen ? "▲" : "▼"}</span>
                          </div>
                        </div>

                        {/* Supplier card */}
                        {isOpen && (
                          <div className="go-sup-card">
                            <div className="go-sup-card-grid">

                              <div className="go-sup-field">
                                <div className="go-sup-field-label">Ассортимент</div>
                                <div className="go-sup-field-value">{s.assortment || "—"}</div>
                              </div>

                              <div className="go-sup-field">
                                <div className="go-sup-field-label">Цены</div>
                                <div className="go-sup-field-value">{s.prices || "—"}</div>
                              </div>

                              <div className="go-sup-field">
                                <div className="go-sup-field-label">Условия</div>
                                <div className="go-sup-field-value">{s.conditions || "—"}</div>
                              </div>

                              <div className="go-sup-field">
                                <div className="go-sup-field-label">Контакт</div>
                                <div className="go-sup-field-value" style={{ color: "#9CA3AF" }}>— заполнить</div>
                              </div>

                              <div className="go-sup-field">
                                <div className="go-sup-field-label">Телефон</div>
                                <div className="go-sup-field-value" style={{ color: "#9CA3AF" }}>— заполнить</div>
                              </div>

                              <div className="go-sup-field">
                                <div className="go-sup-field-label">Email</div>
                                <div className="go-sup-field-value" style={{ color: "#9CA3AF" }}>— заполнить</div>
                              </div>

                              <div className="go-sup-field">
                                <div className="go-sup-field-label">Договор</div>
                                <div className="go-sup-field-value" style={{ color: "#9CA3AF" }}>— уточнить</div>
                              </div>

                              <div className="go-sup-field">
                                <div className="go-sup-field-label">Оплата</div>
                                <div className="go-sup-field-value" style={{ color: "#9CA3AF" }}>— уточнить</div>
                              </div>

                            </div>

                            {s.sheetUrl ? (
                              <a
                                href={s.sheetUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="go-btn go-btn--outline"
                                style={{ marginTop: 12, display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}
                              >
                                📊 Открыть прайс
                              </a>
                            ) : (
                              <div style={{ marginTop: 12, fontSize: 12, color: "#9CA3AF" }}>
                                Прайс: загрузить в Google Sheets и добавить ссылку
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className="go-empty">Ничего не найдено по запросу «{search}»</div>
      )}
    </div>
  );
}
