import { useState, useEffect, useRef, useMemo } from "react";
import { collection, onSnapshot, doc, setDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { useAuth } from "../../auth/useAuth";
import { useOrders, loadPricelist } from "../useOrders";
import { buildPlIndex, type PlIndex } from "../plIndex";
import { AssemblyCard } from "./AssemblyCard";
import catalog from "../suppliersCatalog.json";
import "../orders.css";

export type { PlIndex };

type CatEntry = { cat: string; icon: string; suppliers: { name: string; cat: string; icon: string; section?: string; hasContract?: boolean; status?: string; assortment?: string; conditions?: string }[] };
const CATALOG_FLAT = (catalog as CatEntry[]).flatMap((g) =>
  g.suppliers.map((s) => ({
    id: s.name.toLowerCase().replace(/[^a-zа-яё0-9]/gi, "_").slice(0, 30),
    name: s.name, cat: s.cat || g.cat, icon: s.icon || g.icon,
    section: s.section ?? "current", hasContract: s.hasContract ?? false,
    status: s.status ?? "", assortment: s.assortment ?? "", conditions: s.conditions ?? "",
  }))
);

interface Props { businessId: string; managerFilter?: string; showManagerAssign?: boolean; regionFilter?: string; focusOrderId?: string; }


function byDelivery(a: { deliveryDate?: string }, b: { deliveryDate?: string }) {
  // сначала с датой (ближайшая первая), потом без
  if (a.deliveryDate && b.deliveryDate) return a.deliveryDate.localeCompare(b.deliveryDate);
  if (a.deliveryDate) return -1;
  if (b.deliveryDate) return 1;
  return 0;
}

export function AssemblyView({ businessId, managerFilter, showManagerAssign = false, regionFilter, focusOrderId }: Props) {
  const { user } = useAuth();
  const uid = user?.uid ?? "";
  const { orders, loading } = useOrders(businessId, "assembly", uid);
  const [supplierNames, setSupplierNames] = useState<string[]>([]);
  const [plIndex, setPlIndex] = useState<PlIndex | null>(null);
  const seeded = useRef(false);

  // Загружаем прайс один раз — строим два индекса: по штрихкоду (нормализованному) и по словам
  useEffect(() => {
    loadPricelist().then(pl => setPlIndex(buildPlIndex(pl)));
  }, []);

  // Загружаем список всех поставщиков + досеваем пропущенных из каталога (один раз)
  useEffect(() => {
    seeded.current = false;
    const col = collection(db, `tenants/${businessId}/suppliers`);
    return onSnapshot(col, (snap) => {
      if (!seeded.current) {
        seeded.current = true;
        const existing = new Set(snap.docs.map((d) => d.id));
        const missing = CATALOG_FLAT.filter((s) => !existing.has(s.id));
        if (missing.length) {
          Promise.all(missing.map((s) => setDoc(doc(col, s.id), s))).catch(console.error);
        }
      }
      setSupplierNames(
        snap.docs.map(d => (d.data() as { name?: string }).name ?? d.id).filter(Boolean).sort(),
      );
    });
  }, [businessId]);

  const [search, setSearch] = useState("");

  const filtered = orders
    .filter(o => !managerFilter || o.assignedManager === managerFilter)
    .filter(o => !regionFilter || o.region === regionFilter);

  const searched = search.trim()
    ? filtered.filter(o => {
        const q = search.toLowerCase().trim();
        if (o.customerName?.toLowerCase().includes(q)) return true;
        if (o.id.toLowerCase().includes(q)) return true;
        if (String(Math.round((o.totalKopecks ?? 0) / 100)).includes(q)) return true;
        return o.items.some(it =>
          it.productName?.toLowerCase().includes(q) ||
          String(it.barcode ?? "").toLowerCase().includes(q) ||
          String(it.productId ?? "").toLowerCase().includes(q)
        );
      })
    : filtered;

  // Сводка по номенклатуре: строим только когда есть поисковый запрос
  // и хотя бы один результат совпал по товару (не только по клиенту/ID)
  const nomenclatureSummary = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return null;

    // Собираем строки: {productName, qty, unit, customerName, orderId, status}
    type Row = { productName: string; qty: number; unit: string; customerName: string; orderId: string; status: string };
    const rows: Row[] = [];
    for (const o of filtered) {
      for (const it of o.items) {
        const nameMatch = it.productName?.toLowerCase().includes(q);
        const barcodeMatch = String(it.barcode ?? "").toLowerCase().includes(q);
        if (!nameMatch && !barcodeMatch) continue;
        rows.push({
          productName: it.productName ?? it.productId ?? "—",
          qty: it.quantity ?? it.qty ?? 0,
          unit: it.unit ?? "шт",
          customerName: o.customerName ?? o.id,
          orderId: o.id,
          status: o.status,
        });
      }
    }
    if (rows.length === 0) return null;

    // Группируем по productName → суммируем qty и список заказчиков
    const byProduct = new Map<string, { totalQty: number; unit: string; customers: { name: string; qty: number; orderId: string; status: string }[] }>();
    for (const r of rows) {
      const key = r.productName;
      if (!byProduct.has(key)) byProduct.set(key, { totalQty: 0, unit: r.unit, customers: [] });
      const entry = byProduct.get(key)!;
      entry.totalQty += r.qty;
      entry.customers.push({ name: r.customerName, qty: r.qty, orderId: r.orderId, status: r.status });
    }
    return byProduct;
  }, [search, filtered]);

  const assembling = [...searched].sort(byDelivery);

  if (loading || !plIndex) return <div className="go-main"><div className="go-empty">{loading ? "Загрузка…" : "Загрузка прайса…"}</div></div>;

  return (
    <div className="go-main">
      <div className="go-header">
        <h1 className="go-title">Сборка · Густорико</h1>
      </div>

      <input
        placeholder="Поиск по клиенту, номеру, сумме или товару…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        style={{ width:"100%", marginBottom:16, padding:"8px 12px",
          fontSize:13, border:"1px solid #e0d8cc", borderRadius:8,
          background:"#faf8f4", boxSizing:"border-box" }}
      />

      {nomenclatureSummary && (
        <div style={{ marginBottom:20, border:"1px solid #e8dfc8", borderRadius:10, overflow:"hidden", background:"#fffdf7" }}>
          <div style={{ padding:"8px 14px", background:"#f5ede0", borderBottom:"1px solid #e8dfc8",
            fontSize:12, fontWeight:600, color:"#7a5c2e", display:"flex", justifyContent:"space-between" }}>
            <span>Номенклатура в активных заказах</span>
            <span style={{ fontWeight:400, color:"#a0896a" }}>{nomenclatureSummary.size} позиц.</span>
          </div>
          {[...nomenclatureSummary.entries()].map(([product, data]) => (
            <div key={product} style={{ borderBottom:"1px solid #f0e8d8", padding:"8px 14px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:4 }}>
                <span style={{ fontSize:13, fontWeight:600, color:"#3d2e1a" }}>{product}</span>
                <span style={{ fontSize:13, fontWeight:700, color:"#c8760a", whiteSpace:"nowrap", marginLeft:12 }}>
                  {data.totalQty % 1 === 0 ? data.totalQty : data.totalQty.toFixed(3)} {data.unit}
                </span>
              </div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:"4px 8px" }}>
                {data.customers.map((c, i) => (
                  <span key={i} style={{ fontSize:11, padding:"2px 8px", borderRadius:12,
                    background: c.status === "sourcing" ? "#fff3cd" : "#f0ebe0",
                    color: c.status === "sourcing" ? "#7a5500" : "#6b5740",
                    border:"1px solid " + (c.status === "sourcing" ? "#f0c842" : "#ddd0bc") }}>
                    {c.name} — {c.qty % 1 === 0 ? c.qty : c.qty.toFixed(3)} {data.unit}
                    {c.status === "sourcing" && <span style={{ marginLeft:4, fontSize:10 }}>⚙️</span>}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 14, color: "#8B7355", margin: "0 0 12px", fontWeight: 600 }}>
        В сборке ({assembling.length})
      </h2>
      {assembling.length === 0
        ? <div className="go-empty">Нет заказов в сборке</div>
        : assembling.map(o => (
            <AssemblyCard key={o.id} order={o} businessId={businessId} uid={uid} allSupplierNames={supplierNames} plIndex={plIndex} showManagerAssign={showManagerAssign} isFocused={focusOrderId === o.id} />
          ))
      }
    </div>
  );
}
