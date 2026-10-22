import { useState, useEffect } from "react";
import { loadPricelist } from "../useOrders";

interface SalesItem {
  group: string; name: string; article: string; barcode: string;
  priceKopecks: number; minQty: number;
}

export interface PickedItem {
  productName: string; productId: string; barcode: string | null;
  unitPrice: number; quantity: number;
}

interface Props {
  title: string;
  defaultQty?: number;
  onSelect: (item: PickedItem) => void;
  onClose: () => void;
}

async function loadItems(): Promise<SalesItem[]> {
  const pl = await loadPricelist();
  return pl
    .filter(it => it.name && it.price > 0 && it.price < 100_000_000)
    .map(it => ({
      group:       it.sname ?? "",
      name:        it.name,
      article:     it.sku == null ? "" : String(it.sku),
      barcode:     it.barcode == null ? "" : String(it.barcode),
      priceKopecks: it.price,
      minQty:      it.quant ?? 1,
    }));
}

export function ItemPickerModal({ title, defaultQty = 1, onSelect, onClose }: Props) {
  const [items, setItems] = useState<SalesItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [qty, setQty] = useState(defaultQty);
  const [picked, setPicked] = useState<SalesItem | null>(null);

  useEffect(() => {
    loadItems().then(it => { setItems(it); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const q = search.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const filtered = words.length === 0
    ? items.slice(0, 40)
    : items.filter(it => {
        const name = it.name.toLowerCase();
        return words.every(w =>
          name.includes(w) || it.barcode.includes(w) || it.article.toLowerCase().includes(w)
        );
      }).slice(0, 40);

  function confirm() {
    if (!picked) return;
    onSelect({
      productName: picked.name,
      productId: picked.article || picked.barcode,
      barcode: picked.barcode || null,
      unitPrice: picked.priceKopecks,
      quantity: qty,
    });
  }

  const key = (it: SalesItem) => it.article + it.barcode;
  const isSelected = (it: SalesItem) => picked ? key(it) === key(picked) : false;

  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:2000,display:"flex",
      alignItems:"center",justifyContent:"center",padding:16 }} onClick={onClose}>
      <div style={{ background:"#fff",borderRadius:14,padding:24,maxWidth:580,width:"100%",
        maxHeight:"82vh",display:"flex",flexDirection:"column",boxShadow:"0 8px 40px rgba(0,0,0,.25)" }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12 }}>
          <h3 style={{ margin:0,fontSize:15,fontWeight:700 }}>{title}</h3>
          <button onClick={onClose} style={{ background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#8B7355" }}>✕</button>
        </div>
        <input autoFocus placeholder="Поиск: название, штрихкод, артикул…"
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ fontSize:13,padding:"8px 12px",border:"1px solid #e0d8cc",borderRadius:8,marginBottom:8,outline:"none" }} />
        {loading && <div style={{ color:"#aaa",fontSize:12,padding:8 }}>Загрузка прайса…</div>}
        {!loading && q.length > 0 && filtered.length === 0 && (
          <div style={{ color:"#aaa",fontSize:12,padding:8 }}>Ничего не найдено по «{q}»</div>
        )}
        <div style={{ flex:1,overflowY:"auto",marginBottom:8 }}>
          {filtered.map((it) => (
            <div key={key(it)} onClick={() => setPicked(it)}
              style={{ padding:"8px 12px",borderRadius:8,marginBottom:3,cursor:"pointer",
                background: isSelected(it) ? "rgba(200,154,52,.12)" : "rgba(0,0,0,.02)",
                border: isSelected(it) ? "1px solid #C89A34" : "1px solid transparent",
              }}>
              <div style={{ fontSize:12,fontWeight:500 }}>{it.name}</div>
              <div style={{ display:"flex",gap:12,marginTop:2,fontSize:11,color:"#8B7355" }}>
                <span>Арт: {it.article || "—"}</span>
                <span>ШК: {it.barcode || "—"}</span>
                <span style={{ fontWeight:700,color:"#2E7D32" }}>
                  {(it.priceKopecks / 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽
                </span>
                <span style={{ color:"#aaa" }}>мин. {it.minQty} шт</span>
              </div>
            </div>
          ))}
        </div>
        {picked && (
          <div style={{ borderTop:"1px solid #e0d8cc",paddingTop:12,display:"flex",gap:10,alignItems:"center",flexWrap:"wrap" }}>
            <div style={{ flex:1,fontSize:12,minWidth:0 }}>
              <div style={{ fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{picked.name}</div>
              <div style={{ color:"#2E7D32",marginTop:2,fontWeight:600 }}>
                {(picked.priceKopecks / 100).toFixed(2)} ₽/шт
              </div>
            </div>
            <div style={{ display:"flex",alignItems:"center",gap:6 }}>
              <label style={{ fontSize:12,color:"#8B7355" }}>Кол-во:</label>
              <input type="number" min={1} value={qty} onChange={e => setQty(Math.max(1, +e.target.value || 1))}
                style={{ width:60,padding:"4px 8px",border:"1px solid #e0d8cc",borderRadius:6,fontSize:13 }} />
            </div>
            <button onClick={confirm}
              style={{ padding:"8px 18px",background:"#C89A34",color:"#fff",border:"none",
                borderRadius:8,fontWeight:700,cursor:"pointer",fontSize:13,whiteSpace:"nowrap" }}>
              Выбрать
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
