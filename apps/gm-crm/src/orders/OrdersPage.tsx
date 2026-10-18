import { useState, useEffect, useRef } from "react";
import { collection, query, onSnapshot, orderBy } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../auth/useAuth";
import { SalesView } from "./views/SalesView";
import { AssemblyView } from "./views/AssemblyView";
import { PurchasingView } from "./views/PurchasingView";
import { FinanceView } from "./views/FinanceView";
import { DirectorView } from "./views/DirectorView";
import { SuppliersView } from "./views/SuppliersView";
import { DebtsView } from "./views/DebtsView";
import { ClientsView } from "./views/ClientsView";
import { ItemsView } from "./views/ItemsView";
import { LogisticsView } from "./views/LogisticsView";
import { ChatView } from "./views/ChatView";
// MailingView теперь внутри ClientsView
import { IncomingCallPopup } from "../telephony/IncomingCallPopup";
import { CallLogView } from "../telephony/CallLogView";
import { GUSTORIKO_ROLES, useGustorikoRole } from "../auth/useRole";
import "./orders.css";

const BASE_URL = import.meta.env.BASE_URL as string;

// ── Летающие шары (скопировано из Kairos Dashboard) ──────────────────────
const BALL_INIT = [
  { size: 52, rx: 0.12, ry: 0.20 },
  { size: 38, rx: 0.18, ry: 0.72 },
  { size: 30, rx: 0.88, ry: 0.28 },
  { size: 44, rx: 0.80, ry: 0.78 },
  { size: 26, rx: 0.52, ry: 0.08 },
  { size: 36, rx: 0.92, ry: 0.55 },
];
function useBalls() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(
    BALL_INIT.map(b => ({
      x: b.rx * window.innerWidth, y: b.ry * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.8, vy: (Math.random() - 0.5) * 0.8,
      size: b.size,
    }))
  );
  const mouseRef = useRef({ x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 });
  const rafRef = useRef(0);
  useEffect(() => {
    const onMouse = (e: MouseEvent) => { mouseRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener("mousemove", onMouse);
    const tick = () => {
      const W = window.innerWidth, H = window.innerHeight;
      const s = stateRef.current;
      const el = containerRef.current;
      if (!el) { rafRef.current = requestAnimationFrame(tick); return; }
      const children = el.children as HTMLCollectionOf<HTMLImageElement>;
      for (let i = 0; i < s.length; i++) {
        const b = s[i];
        if (i < 5) {
          b.x += b.vx; b.y += b.vy;
          if (b.x - b.size/2 < 0)  { b.x = b.size/2; b.vx = Math.abs(b.vx); }
          if (b.x + b.size/2 > W)  { b.x = W - b.size/2; b.vx = -Math.abs(b.vx); }
          if (b.y - b.size/2 < 0)  { b.y = b.size/2; b.vy = Math.abs(b.vy); }
          if (b.y + b.size/2 > H)  { b.y = H - b.size/2; b.vy = -Math.abs(b.vy); }
        } else {
          const mx = mouseRef.current.x, my = mouseRef.current.y;
          b.vx += (mx - b.x) * 0.0016; b.vy += (my - b.y) * 0.0016;
          b.vx *= 0.94; b.vy *= 0.94;
          b.x += b.vx; b.y += b.vy;
        }
        if (children[i]) children[i].style.transform = `translate(${b.x - b.size/2}px,${b.y - b.size/2}px)`;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(rafRef.current); window.removeEventListener("mousemove", onMouse); };
  }, []);
  return containerRef;
}

const NAV_ICONS: Record<string, string> = {
  sales: "📋", assembly: "📦", purchasing: "🛒", clients: "👥",
  items: "🏷️", suppliers: "🤝", finance: "💰", director: "📊", debts: "⚠️", logistics: "🗺️", calls: "📞",
  chat: "💬", mailing: "📨",
};

type Section = "sales" | "assembly" | "purchasing" | "finance" | "director" | "suppliers" | "debts" | "clients" | "items" | "logistics" | "calls" | "chat";

const ALL_SECTIONS: { id: Section; label: string }[] = [
  { id: "sales",      label: "Заказы" },
  { id: "assembly",   label: "Сборка" },
  { id: "purchasing", label: "Закупки" },
  { id: "clients",    label: "Клиенты" },
  { id: "items",      label: "Товары" },
  { id: "suppliers",  label: "Поставщики" },
  { id: "finance",    label: "Финансы" },
  { id: "director",   label: "Сводная" },
  { id: "debts",      label: "Долги" },
  { id: "logistics",  label: "Логистика" },
  { id: "calls",      label: "Звонки" },
  // mailing перенесён в суб-таб ClientsView; chat — кнопка верхнего угла
];

const HIDDEN_FOR_ROLE: Partial<Record<string, Section[]>> = {
  sales_manager:  ["finance", "director", "clients", "chat"],
  marina_manager: ["finance", "director", "chat"],
  spb_manager:    ["suppliers", "director"],
};

const DEFAULT_SECTION: Record<string, Section> = {
  sales: "sales", assembly: "assembly", purchasing: "purchasing",
  finance: "finance", director: "director",
  sales_manager: "sales", marina_manager: "sales", spb_manager: "sales",
};

export function OrdersPage() {
  const ballsRef = useBalls();
  const { user, logout } = useAuth();
  const bid = "gustoriko";
  const [ballsOn, setBallsOn] = useState(() => localStorage.getItem('gm_balls') !== 'off');
  const { roleId, displayName, managerName, loading } = useGustorikoRole();
  const [section, setSection] = useState<Section | null>(null);
  const [chatToasts, setChatToasts] = useState<{ id: string; author: string; text: string }[]>([]);
  const hiddenForActive = (roleId ? HIDDEN_FOR_ROLE[roleId] : undefined) ?? [];
  const requestedSection: Section = section ?? (roleId ? DEFAULT_SECTION[roleId] : undefined) ?? "sales";
  // Если роль скрывает раздел — фолбэк на первый видимый
  const active: Section = hiddenForActive.includes(requestedSection)
    ? (ALL_SECTIONS.find(s => !hiddenForActive.includes(s.id))?.id ?? "sales")
    : requestedSection;
  const [purchasingClient, setPurchasingClient] = useState<string | null>(null);
  const [assemblyFocusId, setAssemblyFocusId] = useState<string | null>(null);
  const [badgeCounts, setBadgeCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!bid) return;
    const q = query(collection(db, `tenants/${bid}/orders`));
    return onSnapshot(q, snap => {
      let received = 0, approved = 0;
      const clientsTabSeen = localStorage.getItem("gm_clients_tab") ?? "0";
      const newClientNames = new Set<string>();
      snap.docs.forEach(d => {
        const data = d.data() as { status: string; assignedManager?: string; createdAt?: string; customerName?: string };
        const s = data.status;
        if (s === "received") received++;
        // Для sales_manager — считаем только свои заказы
        if (s === "sourcing") {
          const isFiltered = (roleId === "sales_manager" || roleId === "marina_manager") && managerName;
          if (isFiltered) {
            if (data.assignedManager === managerName) approved++;
          } else {
            approved++;
          }
        }
        // Клиенты с новыми заказами
        if ((data.createdAt ?? "") > clientsTabSeen && data.customerName &&
            !/^заказ\s*#/i.test(data.customerName.trim())) {
          newClientNames.add(data.customerName);
        }
      });
      setBadgeCounts(prev => ({ ...prev, sales: received, assembly: approved, clients: newClientNames.size }));
    });
  }, [roleId, managerName]);

  useEffect(() => {
    const q = collection(db, `tenants/${bid}/debts`);
    return onSnapshot(q, snap => {
      setBadgeCounts(prev => ({ ...prev, debts: snap.docs.length }));
    });
  }, []);

  // ── Чат: непрочитанные + push-уведомления ──────────────────────────────
  const chatActiveRef = useRef(false);
  useEffect(() => { chatActiveRef.current = active === "chat"; }, [active]);

  useEffect(() => {
    if (!user?.email) return;
    const STORAGE_KEY = `gm_chat_seen_${bid}`;
    let lastSeen = localStorage.getItem(STORAGE_KEY) ?? "0";
    // запрашиваем разрешение на уведомления при первом монтировании
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      void Notification.requestPermission();
    }
    const q = query(collection(db, `tenants/${bid}/chat`), orderBy("ts", "asc"));
    return onSnapshot(q, snap => {
      const myEmail = user.email!;
      let unread = 0;
      snap.docs.forEach(d => {
        const data = d.data() as { ts: string; author: string; text: string };
        if (data.ts > lastSeen && data.author !== myEmail) {
          unread++;
          // push + in-app toast только если чат не открыт
          if (!chatActiveRef.current) {
            if (typeof Notification !== "undefined" && Notification.permission === "granted") {
              new Notification(`Чат — ${data.author}`, {
                body: data.text.slice(0, 80),
                icon: "/gm-crm/logo-badge.png",
                tag: d.id,
              });
            }
            setChatToasts(prev => {
              if (prev.some(t => t.id === d.id)) return prev;
              return [...prev, { id: d.id, author: data.author, text: data.text.slice(0, 80) }];
            });
            setTimeout(() => setChatToasts(prev => prev.filter(t => t.id !== d.id)), 6000);
          }
        }
      });
      setBadgeCounts(prev => ({ ...prev, chat: unread }));
    });
  }, [user?.email]);

  // При переключении в чат — сбрасываем счётчик и сохраняем метку
  useEffect(() => {
    if (active === "chat") {
      setBadgeCounts(prev => ({ ...prev, chat: 0 }));
      localStorage.setItem(`gm_chat_seen_${bid}`, new Date().toISOString());
    }
  }, [active]);

  // При переключении в клиенты — сбрасываем счётчик и сохраняем метку
  useEffect(() => {
    if (active === "clients") {
      setBadgeCounts(prev => ({ ...prev, clients: 0 }));
      localStorage.setItem("gm_clients_tab", new Date().toISOString());
    }
  }, [active]);

  function goToPurchasing(clientName: string) {
    setPurchasingClient(clientName);
    setSection("purchasing");
  }

  function goToAssembly(orderId: string) {
    setAssemblyFocusId(orderId);
    setSection("assembly");
  }

  function handleSectionChange(s: Section) {
    if (s !== "purchasing") setPurchasingClient(null);
    if (s !== "assembly") setAssemblyFocusId(null);
    setSection(s);
  }

  if (loading) return <div className="loading-screen">Загрузка...</div>;
  if (!user) return null;
  if (!roleId) return (
    <div className="loading-screen" style={{ flexDirection: "column", gap: 12 }}>
      <p>Нет доступа к системе Густорико.</p>
      <button onClick={() => void logout()} style={{ padding: "8px 20px", cursor: "pointer" }}>Выйти</button>
    </div>
  );

  const roleInfo = GUSTORIKO_ROLES[roleId as keyof typeof GUSTORIKO_ROLES];

  const hidden = HIDDEN_FOR_ROLE[roleId] ?? [];
  const visibleSections = ALL_SECTIONS.filter(s => !hidden.includes(s.id));
  const regionFilter = roleId === "spb_manager" ? "spb" : undefined;

  return (
    <div className="go-page">
      {/* Фоновый градиент */}
      <div className="go-bg" aria-hidden="true" />

      {/* Летающие золотые шары */}
      <div ref={ballsRef} className="go-balls-layer" aria-hidden="true" style={{ visibility: ballsOn ? 'visible' : 'hidden' }}>
        {BALL_INIT.map((b, i) => (
          <img key={i} src={BASE_URL + "ball-gold.png"} alt=""
            className="go-ball" style={{ width: b.size, height: b.size }} />
        ))}
      </div>

      <aside className="go-sidebar">
        <div className="go-logo">
          <img src={BASE_URL + "logo-badge.png"} alt="Kairos" />
          <div>
            <span className="go-logo-name">KAIROS</span>
            <span className="go-logo-sub">Gustoriko</span>
          </div>
        </div>

        <nav className="go-nav">
          {visibleSections.map((s) => (
            <button
              key={s.id}
              className={"go-nav-btn" + (active === s.id ? " active" : "")}
              onClick={() => handleSectionChange(s.id)}
              style={{ position: "relative" }}
            >
              <span className="go-nav-icon">{NAV_ICONS[s.id]}</span>
              {s.label}
              {(badgeCounts[s.id] ?? 0) > 0 && (
                <span style={{
                  position: "absolute", top: 4, right: 6,
                  background: "#C62828", color: "#fff",
                  fontSize: 10, fontWeight: 700, lineHeight: 1,
                  padding: "2px 5px", borderRadius: 10, minWidth: 16, textAlign: "center",
                }}>
                  {badgeCounts[s.id]}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Вращающаяся спираль */}
        <div className="go-spiral-wrap">
          <img src={BASE_URL + "spiral.png"} alt="" className="go-spiral" />
        </div>

        <div className="go-user">
          <div className="go-user-name">{user.displayName ?? user.email}</div>
          <div className="go-role-badge">{displayName ?? roleInfo?.displayName ?? roleId}</div>
          <button className="go-logout" onClick={() => void logout()}>Exit</button>
        </div>
      </aside>

      <main className="go-main">
        {active === "sales"      && <SalesView businessId={bid} onGoToPurchasing={goToPurchasing} onGoToAssembly={goToAssembly} readonlyManager={roleId === "sales_manager" || roleId === "marina_manager"} regionFilter={regionFilter} />}
        {active === "assembly"   && <AssemblyView businessId={bid} managerFilter={(roleId === "sales_manager" || roleId === "marina_manager") ? (managerName ?? undefined) : undefined} showManagerAssign={roleId !== "sales_manager" && roleId !== "marina_manager"} regionFilter={regionFilter} focusOrderId={assemblyFocusId ?? undefined} />}
        {active === "purchasing" && <PurchasingView businessId={bid} clientFilter={purchasingClient} regionFilter={regionFilter} />}
        {active === "finance"    && <FinanceView businessId={bid} regionFilter={regionFilter} />}
        {active === "director"   && <DirectorView businessId={bid} onGoToPurchasing={goToPurchasing} />}
        {active === "suppliers"  && <SuppliersView businessId={bid} />}
        {active === "debts"      && <DebtsView businessId={bid} managerFilter={roleId === "sales_manager" ? (managerName ?? undefined) : undefined} regionFilter={regionFilter} />}
        {active === "clients"    && <ClientsView businessId={bid} regionFilter={regionFilter} />}
        {active === "items"      && <ItemsView businessId={bid} regionFilter={regionFilter} />}
        {active === "logistics"  && <LogisticsView businessId={bid} />}
        {active === "calls"      && <CallLogView />}
        {active === "chat"       && <ChatView businessId={bid} currentUser={user?.email ?? ""} />}
        {/* mailing перенесён в ClientsView */}
      </main>

      {/* Правый верхний угол: чат + шарики */}
      <div style={{ position: 'fixed', top: 14, right: 14, zIndex: 150, display: 'flex', gap: 8, alignItems: 'center' }}>
        {/* Кнопка Чат — серебряный слиток */}
        {!hidden.includes("chat" as Section) && (
          <button
            onClick={() => handleSectionChange("chat")}
            title="Чат команды"
            style={{
              position: 'relative',
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '9px 18px', borderRadius: 14, cursor: 'pointer',
              background: active === "chat"
                ? 'linear-gradient(135deg,#c8c8c8 0%,#989898 40%,#b8b8b8 60%,#808080 100%)'
                : 'linear-gradient(135deg,#f0f0f0 0%,#c8c8c8 35%,#e0e0e0 60%,#a8a8a8 100%)',
              border: '1px solid #909090',
              backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
              boxShadow: '0 3px 14px rgba(0,0,0,.22), inset 0 1px 0 rgba(255,255,255,.65)',
              color: '#2a2a2a', fontSize: 14, fontWeight: 700,
              letterSpacing: '.02em', transition: 'all .15s',
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>💬</span>
            <span>Чат</span>
            {(badgeCounts.chat ?? 0) > 0 && (
              <span style={{
                position: 'absolute', top: -5, right: -5,
                background: '#C62828', color: '#fff', borderRadius: '50%',
                fontSize: 11, fontWeight: 700, minWidth: 20, height: 20,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '0 4px', lineHeight: 1, boxShadow: '0 1px 4px rgba(0,0,0,.3)',
              }}>
                {badgeCounts.chat}
              </span>
            )}
          </button>
        )}

        {/* Кнопка шарики */}
        <button
          onClick={() => { const next = !ballsOn; setBallsOn(next); localStorage.setItem('gm_balls', next ? 'on' : 'off'); }}
          title={ballsOn ? 'Скрыть шарики' : 'Показать шарики'}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '6px 13px', borderRadius: 12, cursor: 'pointer',
            background: ballsOn ? 'rgba(200,154,52,.18)' : 'rgba(255,255,255,.75)',
            border: `1px solid ${ballsOn ? 'rgba(200,154,52,.45)' : 'rgba(200,154,52,.22)'}`,
            backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
            boxShadow: '0 2px 12px rgba(160,110,20,.10)',
            color: '#8B6914', fontSize: 12, fontWeight: 600,
            transition: 'all .15s',
          }}
        >
          {ballsOn ? '✦' : '✧'} шарики
        </button>
      </div>

      {/* In-app тосты чата — сверху справа */}
      {chatToasts.length > 0 && (
        <div style={{ position: 'fixed', top: 66, right: 14, zIndex: 300, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 320 }}>
          {chatToasts.map(t => (
            <div key={t.id}
              onClick={() => { handleSectionChange("chat"); setChatToasts([]); }}
              style={{
                background: 'linear-gradient(135deg,#f0f0f0 0%,#d8d8d8 40%,#e8e8e8 100%)',
                border: '1px solid #909090',
                borderRadius: 12, padding: '10px 14px', cursor: 'pointer',
                boxShadow: '0 4px 18px rgba(0,0,0,.25), inset 0 1px 0 rgba(255,255,255,.7)',
                display: 'flex', gap: 10, alignItems: 'flex-start',
                animation: 'slideInRight .25s ease',
              }}
            >
              <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>💬</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#222', marginBottom: 2 }}>{t.author}</div>
                <div style={{ fontSize: 12, color: '#444', lineHeight: 1.4 }}>{t.text}</div>
              </div>
              <button onClick={e => { e.stopPropagation(); setChatToasts(prev => prev.filter(x => x.id !== t.id)); }}
                style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 14, padding: '0 0 0 4px', flexShrink: 0 }}>✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Всплывающий попап при входящем звонке — всегда активен */}
      <IncomingCallPopup />
    </div>
  );
}
