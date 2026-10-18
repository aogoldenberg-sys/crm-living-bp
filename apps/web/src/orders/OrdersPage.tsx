import { useState } from "react";
import { useAuth } from "../auth/useAuth";
import { SalesView } from "./views/SalesView";
import { AssemblyView } from "./views/AssemblyView";
import { PurchasingView } from "./views/PurchasingView";
import { FinanceView } from "./views/FinanceView";
import { DirectorView } from "./views/DirectorView";
import { SuppliersView } from "./views/SuppliersView";
import { GUSTORIKO_ROLES, useGustorikoRole } from "../auth/useRole";
import "./orders.css";

const BASE_URL = import.meta.env.BASE_URL as string;

// Какие вкладки доступны для каждой роли
const ROLE_TABS: Record<string, { id: string; label: string }[]> = {
  sales:      [{ id: "orders",    label: "Мои заказы" }],
  assembly:   [{ id: "assembly",  label: "Сборка" }],
  purchasing: [{ id: "purchasing", label: "Закупки" }, { id: "suppliers", label: "Поставщики" }],
  finance:    [{ id: "finance",   label: "Финансы" }],
  director:   [
    { id: "director",   label: "Сводная" },
    { id: "orders",     label: "Заказы" },
    { id: "suppliers",  label: "Поставщики" },
    { id: "purchasing", label: "Закупки" },
    { id: "finance",    label: "Финансы" },
  ],
};

export function OrdersPage() {
  const { user, logout } = useAuth();
  const bid = "gustoriko";
  const { roleId, displayName, loading } = useGustorikoRole();
  const [activeTab, setActiveTab] = useState<string | null>(null);

  if (loading) return <div className="loading-screen">Загрузка...</div>;
  if (!user) return null;
  if (!roleId) return (
    <div className="loading-screen" style={{ flexDirection: "column", gap: 12 }}>
      <p>Нет доступа к системе Густорико.</p>
      <button onClick={() => void logout()} style={{ padding: "8px 20px", cursor: "pointer" }}>Выйти</button>
    </div>
  );

  const tabs = ROLE_TABS[roleId] ?? [{ id: "orders", label: "Заказы" }];
  const currentTab = activeTab ?? tabs[0].id;
  const roleInfo = GUSTORIKO_ROLES[roleId as keyof typeof GUSTORIKO_ROLES];

  return (
    <div className="go-page">
      {/* Sidebar */}
      <aside className="go-sidebar">
        <div className="go-logo">
          <img src={BASE_URL + "logo-badge.png"} alt="Kairos" />
          <div>
            <span className="go-logo-name">KAIROS</span>
            <span className="go-logo-sub">Gustoriko</span>
          </div>
        </div>

        <nav className="go-nav">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`go-nav-btn${currentTab === tab.id ? " active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="go-user">
          <div className="go-user-name">{user.displayName ?? user.email}</div>
          <div className="go-role-badge">{displayName ?? roleInfo?.displayName ?? roleId}</div>
          <button className="go-logout" onClick={() => void logout()}>Exit</button>
        </div>
      </aside>

      {/* Content */}
      {currentTab === "orders"     && <SalesView businessId={bid} />}
      {currentTab === "assembly"   && <AssemblyView businessId={bid} />}
      {currentTab === "purchasing" && <PurchasingView businessId={bid} />}
      {currentTab === "finance"    && <FinanceView businessId={bid} />}
      {currentTab === "director"   && <DirectorView businessId={bid} />}
      {currentTab === "suppliers"  && <SuppliersView businessId={bid} />}
    </div>
  );
}
