import { useState, useEffect } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../../firebase";
import { useOrders, fmtRub, type Order } from "../useOrders";
import "../orders.css";

interface Props { businessId: string; onGoToPurchasing?: (clientName: string) => void }

// ── Градиенты как k-stage-card в Kairos main ────────────────────────────────
const GRADS = [
  { bg: "linear-gradient(135deg,#8A6415 0%,#B98D2A 15%,#E4C260 34%,#F7E4A0 50%,#E0BA4C 64%,#A67E1E 83%,#7C5C12 100%)", text: "#3A2800", sub: "rgba(58,40,0,.7)" },
  { bg: "linear-gradient(135deg,#6E3F1C 0%,#995C2C 15%,#C68B4A 33%,#E9B778 46%,#F3D29A 52%,#C88A46 64%,#8E5427 82%,#5F3818 100%)", text: "#fff", sub: "rgba(255,255,255,.7)" },
  { bg: "linear-gradient(135deg,#5A3316 0%,#83502A 16%,#B27A42 34%,#D9A768 50%,#A96E38 64%,#7A481F 83%,#4E2E13 100%)", text: "#fff", sub: "rgba(255,255,255,.7)" },
  { bg: "linear-gradient(135deg,#A6791C 0%,#D4AB40 16%,#F4DE88 40%,#FFF6CC 52%,#E4BF52 66%,#B0851F 84%,#8A6614 100%)", text: "#3A2800", sub: "rgba(58,40,0,.7)" },
  // тёмно-синий для оперативных метрик
  { bg: "linear-gradient(135deg,#1A2A4A 0%,#2A4070 20%,#3A5890 40%,#4A70B0 55%,#3A5890 70%,#2A4070 85%,#1A2A4A 100%)", text: "#fff", sub: "rgba(255,255,255,.7)" },
  { bg: "linear-gradient(135deg,#1A3A2A 0%,#2A5A3A 20%,#3A7A50 40%,#4A9A68 55%,#3A7A50 70%,#2A5A3A 85%,#1A3A2A 100%)", text: "#fff", sub: "rgba(255,255,255,.7)" },
  { bg: "linear-gradient(135deg,#4A1A1A 0%,#7A2A2A 20%,#A84040 40%,#C85858 55%,#A84040 70%,#7A2A2A 85%,#4A1A1A 100%)", text: "#fff", sub: "rgba(255,255,255,.7)" },
];

function IngotCard({ label, value, sub, idx }: { label: string; value: string; sub?: string; idx: number }) {
  const g = GRADS[idx % GRADS.length];
  return (
    <div style={{
      borderRadius: 18, padding: "20px 22px 22px", position: "relative",
      overflow: "hidden", background: g.bg,
      border: "1px solid rgba(255,255,255,.22)",
      boxShadow: "0 6px 28px rgba(80,50,10,.25), inset 0 1px 0 rgba(255,255,255,.28)",
    }}>
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0, borderRadius: 18,
        background: "linear-gradient(112deg, transparent 22%, rgba(255,255,255,.55) 40%, rgba(255,255,255,.08) 50%, transparent 62%)",
        mixBlendMode: "screen",
      }} />
      <div style={{ position: "relative", zIndex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em", color: g.sub, marginBottom: 12 }}>{label}</div>
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 52, fontWeight: 700, color: g.text, letterSpacing: "-.02em", lineHeight: 1 }}>{value}</div>
        {sub && <div style={{ fontSize: 13, fontWeight: 500, color: g.sub, marginTop: 10 }}>{sub}</div>}
      </div>
    </div>
  );
}

export function DirectorView({ businessId }: Props) {
  const { orders, loading } = useOrders(businessId, "director", "");
  const [costByOrder, setCostByOrder] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    return onSnapshot(collection(db, `tenants/${businessId}/purchase_lines`), snap => {
      const m = new Map<string, number>();
      for (const d of snap.docs) {
        const pl = d.data() as { orderId: string; unitCostKopecks: number; qty: number };
        m.set(pl.orderId, (m.get(pl.orderId) ?? 0) + (pl.unitCostKopecks ?? 0) * (pl.qty ?? 0));
      }
      setCostByOrder(m);
    });
  }, [businessId]);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthLabel = now.toLocaleString("ru-RU", { month: "long", year: "numeric" });

  // createdAt может прийти из Firestore как Timestamp-объект или ISO-строка
  const toDate = (v: unknown): Date => {
    if (typeof v === "string") return new Date(v);
    if (v && typeof v === "object" && "toDate" in v) return (v as { toDate(): Date }).toDate();
    if (v instanceof Date) return v;
    return new Date(0);
  };

  // Только отгруженные за текущий месяц
  const delivMonth = orders.filter((o: Order) => o.status === "delivered" && toDate(o.createdAt) >= monthStart);
  const delivMsk   = delivMonth.filter((o: Order) => !o.region || o.region === "msk");
  const delivSpb   = delivMonth.filter((o: Order) => o.region === "spb");

  const revMsk    = delivMsk.reduce((s: number, o: Order) => s + o.totalKopecks, 0);
  const revSpb    = delivSpb.reduce((s: number, o: Order) => s + o.totalKopecks, 0);
  const costMsk   = delivMsk.reduce((s: number, o: Order) => s + (costByOrder.get(o.id) ?? 0), 0);
  const costSpb   = delivSpb.reduce((s: number, o: Order) => s + (costByOrder.get(o.id) ?? 0), 0);
  const profitMsk = revMsk - costMsk;
  const profitSpb = revSpb - costSpb;

  const pct = (profit: number, rev: number) => rev > 0 ? `${Math.round(profit / rev * 100)}% маржа` : "нет данных";

  // Оперативные метрики
  const monthOrders  = orders.filter((o: Order) => toDate(o.createdAt) >= monthStart);
  const awaitShip    = orders.filter((o: Order) => ["approved", "sourcing", "ordered"].includes(o.status));
  const overdueOrders = orders.filter((o: Order) => {
    if (["delivered", "cancelled"].includes(o.status)) return false;
    return Date.now() - toDate(o.createdAt).getTime() > 3 * 24 * 60 * 60 * 1000;
  });

  if (loading) return <div className="go-empty">Загрузка…</div>;

  return (
    <div>
      <div className="go-header">
        <h2 className="go-title">Сводная · Густорико</h2>
        <p className="go-subtitle">{monthLabel}</p>
      </div>

      {/* Финансы — 2×2 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14, marginBottom: 14 }}>
        <IngotCard label="Выручка МСК" value={fmtRub(revMsk)} sub={`${delivMsk.length} отгрузок`} idx={0} />
        <IngotCard label="Прибыль МСК" value={fmtRub(profitMsk)} sub={pct(profitMsk, revMsk)} idx={1} />
        <IngotCard label="Выручка СПб" value={fmtRub(revSpb)} sub={`${delivSpb.length} отгрузок`} idx={2} />
        <IngotCard label="Прибыль СПб" value={fmtRub(profitSpb)} sub={pct(profitSpb, revSpb)} idx={3} />
      </div>

      {/* Операции — 3 в ряд */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        <IngotCard label="Заказов за месяц" value={String(monthOrders.length)} sub="новых заявок" idx={4} />
        <IngotCard label="Ожидают отгрузки" value={String(awaitShip.length)} sub="в работе" idx={5} />
        <IngotCard label="Долги по срокам" value={String(overdueOrders.length)} sub="> 3 дней без отгрузки" idx={6} />
      </div>
    </div>
  );
}
