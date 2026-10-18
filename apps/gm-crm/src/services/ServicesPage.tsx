import { useEffect, useRef, useState } from "react"; // eslint-disable-line
import { useSearchParams, useNavigate } from "react-router-dom";
import { sendEmailVerification } from "firebase/auth";
import { useAuth } from "../auth/useAuth";
import { ComplianceV2 } from "../compliance/ComplianceV2.js";
import { TaxReportingScreen } from "../features/reporting/TaxReportingScreen";
import { useEntitlements } from "./useEntitlements";
import { PaywallScreen } from "./PaywallScreen";
import "./ServicesPage.css";

type ServiceTab = "tax" | "compliance";

function GatedTax({
  businessId, onUsed,
}: { businessId: string; onUsed: () => Promise<void> }) {
  useEffect(() => { void onUsed(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return <TaxReportingScreen businessId={businessId} />;
}

function EmailBanner() {
  const { user } = useAuth();
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  if (!user || user.emailVerified) return null;
  // Yandex users authenticated via custom token — no email in Firebase Auth
  if (user.uid.startsWith("yandex:")) return null;

  const handleResend = async () => {
    if (countdown > 0) return;
    await sendEmailVerification(user).catch(() => {});
    setCountdown(60);
  };

  return (
    <div className="svc-email-banner">
      <span>Подтвердите email, чтобы разблокировать все функции.</span>
      <button type="button" onClick={handleResend} disabled={countdown > 0}>
        {countdown > 0 ? `Отправить ещё раз (${countdown}с)` : "Отправить письмо"}
      </button>
    </div>
  );
}

export function ServicesPage() {
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") ?? "compliance") as ServiceTab;
  const [tab, setTab] = useState<ServiceTab>(initialTab);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const { businessId, user, logout } = useAuth();
  const navigate = useNavigate();
  const { loading, canCompliance, canReport, markReportUsed } =
    useEntitlements(businessId);

  // Закрывать меню при клике вне
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setShowProfileMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (loading) return <div className="loading-screen">Загрузка\u2026</div>;

  const tabBtn = (id: ServiceTab, label: string) => (
    <button
      type="button"
      className={`svc-tab${tab === id ? " svc-tab--active" : ""}`}
      onClick={() => setTab(id)}
    >
      {label}
    </button>
  );

  return (
    <div className="svc-page">
      <div className="svc-ball svc-ball--1"><img src={import.meta.env.BASE_URL + "ball-gold.png"} alt="" /></div>
      <div className="svc-ball svc-ball--2"><img src={import.meta.env.BASE_URL + "ball-glossy.png"} alt="" /></div>
      <div className="svc-ball svc-ball--3"><img src={import.meta.env.BASE_URL + "ball-gold.png"} alt="" /></div>
      <div className="svc-ball svc-ball--4"><img src={import.meta.env.BASE_URL + "ball-glossy.png"} alt="" /></div>
      <div className="svc-ball svc-ball--5"><img src={import.meta.env.BASE_URL + "ball-gold.png"} alt="" /></div>
      <header className="svc-header">
        <a href="/" className="svc-brand" target="_blank" rel="noopener noreferrer">
          <img src={import.meta.env.BASE_URL + "logo.png"} alt="Kairos"
            className="svc-logo" />
          <span className="svc-wordmark">KAIROS</span>
        </a>
        <nav className="svc-tabs">
          {tabBtn("compliance", "Требование / Запрос")}
          {tabBtn("tax", "Составить отчётность")}
          <button type="button" className="svc-tab" onClick={() => navigate("/onboarding")}>
            Создать бизнес-план
          </button>
          <button type="button" className="svc-tab" onClick={() => navigate("/onboarding")}>
            Оценить бизнес-план
          </button>
          <button type="button" className="svc-tab" onClick={() => navigate("/business")}>
            Анализ текущего бизнеса
          </button>
        </nav>
        <a
          href="https://opentgp.ru/kairos/#pricing"
          target="_blank"
          rel="noopener noreferrer"
          className="svc-tariffs-btn"
        >
          ТАРИФЫ
        </a>

        {/* Иконка профиля */}
        <div className="svc-profile" ref={profileRef}>
          <button
            type="button"
            className="svc-profile-btn"
            onClick={() => setShowProfileMenu(v => !v)}
            aria-label="Профиль"
            title={user?.displayName || user?.email || "Профиль"}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <circle cx="10" cy="7" r="3.5" stroke="#5A3D00" strokeWidth="1.5"/>
              <path d="M3 17c0-3.314 3.134-6 7-6s7 2.686 7 6" stroke="#5A3D00" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
          {showProfileMenu && (
            <div className="svc-profile-menu">
              {(user?.displayName || user?.email) && (
                <div className="svc-profile-email">
                  {user?.displayName && <div style={{ fontWeight: 600, color: "#3A2800", marginBottom: 2 }}>{user.displayName}</div>}
                  {user?.email && <div>{user.email}</div>}
                  {!user?.email && user?.uid?.startsWith("yandex:") && <div style={{ color: "#AAA098" }}>Яндекс ID</div>}
                </div>
              )}
              <button type="button" className="svc-profile-item" onClick={() => { setShowProfileMenu(false); void logout(); navigate("/login"); }}>
                Сменить пользователя
              </button>
              <button type="button" className="svc-profile-item svc-profile-item--danger" onClick={() => { setShowProfileMenu(false); void logout(); }}>
                Выйти
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="svc-content">
        {tab === "compliance" && (
          canCompliance
            ? <ComplianceV2 businessId={businessId ?? ""} />
            : <PaywallScreen feature="compliance" onBack={() => setTab("tax")} />
        )}

        {tab === "tax" && (
          canReport
            ? <GatedTax businessId={businessId ?? ""} onUsed={markReportUsed} />
            : <PaywallScreen feature="report" onBack={() => setTab("compliance")} />
        )}

        <EmailBanner />
      </main>
    </div>
  );
}
