import { useState, useMemo, useEffect, useRef } from "react";
import { collection, onSnapshot, doc, setDoc } from "firebase/firestore";
import { db } from "../../firebase";
import { loadPricelist, type PricelistMatch } from "../useOrders";
import catalog from "../suppliersCatalog.json";
import "../orders.css";

type PlIndex = {
  byBarcode: Map<string, PricelistMatch[]>;
  byWord:    Map<string, PricelistMatch[]>;
};

const STOP = new Set(["вода","напиток","напитки","газированный","газированная",
  "негазированный","натуральный","сок","соки","молоко","масло","сахар","мл","пэт",
  "стекло","банка","жестяная","картон","блок","упаковка","штук","литр","литра",
  "литров","грамм","гр","кг","шт","пак","дой","туба","бутылка","бут"]);
function norm(s: string) { return s.toLowerCase().replace(/[^а-яёa-z0-9]/gi, " ").replace(/\s+/g, " ").trim(); }

const SHEET_ID = "1BqrvyxXYUDT-wmBC0RR1Xnz_29hPIn6FNgrMFKhs-uA";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`;

// Уникальные иконки и описание ассортимента per-поставщик
// Используется как fallback, если в Firestore record пусто
const SUPPLIER_META: Record<string, { icon: string; assortment: string }> = {
  // Вода и напитки
  "ApexFood":              { icon: "🥤🌾", assortment: "Бакалея, кондитерские изделия" },
  "OKF Korea":             { icon: "🇰🇷🧃", assortment: "Напитки из Кореи" },
  "Ашкуди Энерджи":       { icon: "⚡🥤", assortment: "Энергетические напитки" },
  "Мултон":                { icon: "🍊🧃", assortment: "Соки, воды, напитки (Добрый)" },
  "Мурат / Ярмарка":      { icon: "🏪💧", assortment: "Продукты питания" },
  "Байкал":                { icon: "💧🏔️", assortment: "Минеральная вода" },
  "Сенежская":             { icon: "💧🌊", assortment: "Минеральная вода" },
  "Черноголовка":          { icon: "🫧🍾", assortment: "Газированные напитки" },
  // Алкоголь и пиво
  "Бочкарев / UniteBrewery": { icon: "🍺🏭", assortment: "Пиво, безалкогольные" },
  // Мясо и консервы
  "Скорпинский":           { icon: "🥩🥫", assortment: "Тушёнка, консервы мясные" },
  "Скопинский":            { icon: "🥩🫙", assortment: "Тушёнка, консервы мясные" },
  // Сыры и молочное
  "Курский МЗ":            { icon: "🧈🥛", assortment: "Масло, молочная продукция" },
  "Молтрейд":              { icon: "🥛🧀", assortment: "Молочная продукция" },
  "Пик пак сыр":           { icon: "🧀🔖", assortment: "Сыры фасованные" },
  // Кондитерские изделия
  "Дикси":                 { icon: "🟠🏪", assortment: "= Первым Делом: бакалея, хлебцы, 5 264 позиции" },
  "Кэнди Фрут":            { icon: "🍭🍿", assortment: "Сахарная вата, сладости, попкорн" },
  "Скатерть-Самобранка":   { icon: "🎉🍫", assortment: "Кондитерские изделия" },
  "ТД Орион":              { icon: "🍜🥢", assortment: "Азиатские соусы и лапша" },
  "Тандер":                { icon: "🔴🏬", assortment: "Магнит/Тандер: жвачка, мармелад, халва, конфеты" },
  "Чупа Лэнд":             { icon: "🍭🎈", assortment: "Леденцы, жевательная резинка" },
  // Бакалея и консервы
  "Eurotrade24":           { icon: "🌍🍪", assortment: "Импортные снеки, печенье" },
  "Great Green":           { icon: "🌿🥗", assortment: "Экопродукты" },
  "Аксиома":               { icon: "🧂🌾", assortment: "Бакалея, специи" },
  "ИнтерФуд Групп":        { icon: "🦐🧀", assortment: "Сыры, морепродукты" },
  "Метро":                 { icon: "🔵🛒", assortment: "Бакалея, напитки, FMCG — 27 категорий" },
  "Первым Делом":          { icon: "🟠🏪", assortment: "Бакалея, хлебцы, крупы, сухофрукты — 5 264 поз. (= Дикси)" },
  "Профитс (Русина)":      { icon: "🫒🥫", assortment: "Оливки, маслины, консервация" },
  "ТД ЕврАзия":            { icon: "🌏🫙", assortment: "Бакалея, восточные товары" },
  // Замороженные
  "ЛетоК":                 { icon: "🍇❄️", assortment: "Сухофрукты, замороженные продукты" },
  // Прочее
  "ZSM RICHI":             { icon: "🧴📦", assortment: "Товары FMCG" },
  "АРТ-ГРУПП ТР":          { icon: "🚚📦", assortment: "Логистика, товары" },
  "Торговый Дом Восток":   { icon: "🌏🍱", assortment: "Восточные товары" },
};

interface Sup {
  id: string; name: string; cat: string; icon: string;
  contact?: string; phone?: string; email?: string;
  conditions?: string; paymentTerms?: string; hasContract?: boolean;
  status?: string; section?: string; assortment?: string;
  sheetName?: string; sheetUrl?: string | null; notes?: string;
}

function slugify(name: string) {
  return name.toLowerCase().replace(/[^a-zа-яё0-9]/gi, "_").slice(0, 30);
}

function sheetLink(sheetName: string) {
  return `${SHEET_URL}#gid=0&sheet=${encodeURIComponent(sheetName)}`;
}

// ── SupplierModal ─────────────────────────────────────────────────────────────
function SupplierModal({ sup, businessId, onClose }: { sup: Sup | null; businessId: string; onClose: () => void }) {
  const isNew = !sup?.id;
  const [form, setForm] = useState<Partial<Sup>>(sup ?? { section: "current", hasContract: false });
  const [saving, setSaving] = useState(false);

  if (!form) return null;
  const f = (k: keyof Sup, v: string | boolean) => setForm((p) => ({ ...p, [k]: v }));

  async function save() {
    setSaving(true);
    try {
      const id = form.id ?? slugify(form.name ?? "supplier");
      await setDoc(doc(db, `tenants/${businessId}/suppliers`, id), { ...form, id });
      onClose();
    } catch (e) {
      console.error("save supplier:", e);
      alert("Ошибка сохранения. Проверьте подключение.");
    } finally {
      setSaving(false);
    }
  }

  const sheetUrl = form.sheetUrl
    || (form.sheetName ? `${SHEET_URL}#gid=0&sheet=${encodeURIComponent(form.sheetName)}` : null);

  const textFields: [keyof Sup, string, boolean][] = [
    ["name","Название", false], ["cat","Категория", false],
    ["contact","Контакт (ФИО)", false], ["phone","Телефон", false],
    ["email","Email", false], ["conditions","Условия поставки", true],
    ["paymentTerms","Оплата / отсрочка", false], ["assortment","Ассортимент", true],
    ["notes","Примечания", true],
  ];

  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:1000,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"32px 16px",overflowY:"auto" }}
      onClick={onClose}>
      <div style={{ background:"#fff",borderRadius:14,padding:28,maxWidth:600,width:"100%",boxShadow:"0 8px 40px rgba(0,0,0,.2)" }} onClick={(e)=>e.stopPropagation()}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4 }}>
          <h2 style={{ margin:0,fontSize:17,fontWeight:700 }}>{isNew ? "Новый поставщик" : form.name}</h2>
          <button onClick={onClose} style={{ background:"none",border:"none",fontSize:22,cursor:"pointer",color:"#8B7355" }}>✕</button>
        </div>

        {/* Ссылка на прайс-лист */}
        {sheetUrl && (
          <a href={sheetUrl} target="_blank" rel="noreferrer"
            style={{ fontSize:12,color:"#8B6914",textDecoration:"none",display:"inline-flex",alignItems:"center",gap:6,
              padding:"4px 10px",background:"rgba(200,154,52,.08)",borderRadius:8,border:"1px solid rgba(200,154,52,.25)",marginBottom:18 }}>
            📊 Прайс-лист → Google Sheets {form.sheetName ? `· ${form.sheetName.split(" — ")[0]}` : ""}
          </a>
        )}

        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10 }}>
          {textFields.map(([k,label,wide]) => (
            <div key={k} className="go-field" style={{ marginBottom:0, gridColumn: wide ? "1/-1" : undefined }}>
              <label>{label}</label>
              <input value={(form[k] as string) ?? ""} onChange={(e)=>f(k,e.target.value)} />
            </div>
          ))}
          {/* sheetName — скрытое служебное поле */}
          <div className="go-field" style={{ marginBottom:0, gridColumn:"1/-1" }}>
            <label>Лист Google Sheets (служебное)</label>
            <input value={(form.sheetName as string) ?? ""} onChange={(e)=>f("sheetName",e.target.value)} style={{ fontSize:11,color:"#8B7355" }} />
          </div>
          <div className="go-field" style={{ marginBottom:0 }}>
            <label>Договор</label>
            <select value={form.hasContract ? "yes" : "no"} onChange={(e)=>f("hasContract", e.target.value==="yes")}>
              <option value="no">❌ Нет</option>
              <option value="yes">✅ Есть</option>
            </select>
          </div>
          <div className="go-field" style={{ marginBottom:0 }}>
            <label>Статус работы</label>
            <select value={form.section ?? "current"} onChange={(e)=>f("section",e.target.value)}>
              <option value="current">Работаем</option>
              <option value="new">Новый</option>
              <option value="paused">Пауза</option>
            </select>
          </div>
        </div>
        {isNew && (
          <div style={{ marginTop:16,padding:"10px 14px",background:"rgba(200,154,52,.07)",
            border:"1px solid rgba(200,154,52,.25)",borderRadius:8,fontSize:12,color:"#8B6914",lineHeight:1.6 }}>
            ℹ️ <b>Прайс в поиске заказов:</b> карточка сохранится сразу, но товары этого поставщика появятся
            в поиске только после добавления листа в Google Sheets и обновления прайс-файла
            (import_pricelist.py → pricelist.json → FTP).
          </div>
        )}
        <div style={{ display:"flex",gap:10,marginTop:16 }}>
          <button className="go-btn go-btn--gold" onClick={()=>void save()} disabled={saving||!form.name}>
            {saving?"…":"Сохранить"}
          </button>
          <button className="go-btn go-btn--outline" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
}

// ── SupplierTile ──────────────────────────────────────────────────────────────
function SupplierTile({ s, onClick }: { s: Sup; onClick: () => void }) {
  const dot = s.section === "current" ? "#16A34A" : s.section === "paused" ? "#D97706" : "#2563EB";
  const meta = SUPPLIER_META[s.name];
  const icon = meta?.icon || s.icon || "📦";
  const sub  = s.assortment || meta?.assortment || "";
  const priceUrl = s.sheetUrl
    || (s.sheetName ? `${SHEET_URL}#gid=0&sheet=${encodeURIComponent(s.sheetName)}` : null);

  return (
    <div style={{ position:"relative" }}>
      <button onClick={onClick} style={{
        width:"100%",minHeight:164,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
        gap:5,padding:"14px 10px 28px",background:"#fff",border:"1px solid rgba(200,154,52,.2)",borderRadius:14,
        cursor:"pointer",textAlign:"center",transition:"border-color .15s",
      }}
      onMouseEnter={(e)=>(e.currentTarget.style.borderColor="#C89A34")}
      onMouseLeave={(e)=>(e.currentTarget.style.borderColor="rgba(200,154,52,.2)")}>
        <span style={{ fontSize:32,lineHeight:1.2 }}>{icon}</span>
        <span style={{ fontSize:12,fontWeight:700,color:"#1A1814",lineHeight:1.3,maxWidth:138,
          overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{s.name}</span>
        {sub && <span style={{ fontSize:10,color:"#8B6914",maxWidth:138,lineHeight:1.3,
          display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical",overflow:"hidden" }}>{sub}</span>}
        <span style={{ position:"absolute",top:9,right:9,width:8,height:8,borderRadius:"50%",background:dot }} title={s.section} />
        {s.hasContract && <span style={{ position:"absolute",top:8,left:9,fontSize:11 }}>📃</span>}
      </button>
      {priceUrl && (
        <a href={priceUrl} target="_blank" rel="noreferrer" onClick={(e)=>e.stopPropagation()}
          style={{ position:"absolute",bottom:6,left:"50%",transform:"translateX(-50%)",
            fontSize:10,color:"#8B6914",textDecoration:"none",whiteSpace:"nowrap",
            background:"rgba(200,154,52,.1)",borderRadius:6,padding:"2px 8px",border:"1px solid rgba(200,154,52,.25)" }}>
          📊 Прайс
        </a>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
// Все поставщики из каталога JSON с id
type CatEntry = { cat: string; icon: string; suppliers: { name: string; cat: string; icon: string; section?: string; hasContract?: boolean; status?: string; assortment?: string; conditions?: string; sheetUrl?: string | null }[] };
const CATALOG_FLAT = (catalog as CatEntry[]).flatMap((g) =>
  g.suppliers.map((s) => ({
    id: slugify(s.name), name: s.name, cat: s.cat || g.cat, icon: s.icon || g.icon,
    section: s.section ?? "current", hasContract: s.hasContract ?? false,
    status: s.status ?? "", assortment: s.assortment ?? "", conditions: s.conditions ?? "",
  }))
);

export function SuppliersView({ businessId }: { businessId: string }) {
  const [suppliers, setSuppliers] = useState<Sup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [editSup, setEditSup] = useState<Sup | null | "new">(null);
  const [plIndex, setPlIndex] = useState<PlIndex | null>(null);
  const seeded = useRef(false);

  useEffect(() => {
    loadPricelist().then(pl => {
      const byBarcode: PlIndex["byBarcode"] = new Map();
      const byWord: PlIndex["byWord"] = new Map();
      for (const it of pl) {
        if (it.price > 10_000_000) continue;
        const match: PricelistMatch = {
          supplierId: it.sid, supplierName: it.sname,
          priceKopecks: it.price, barcode: it.barcode, productName: it.name,
        };
        if (it.barcode) {
          const a = byBarcode.get(it.barcode) ?? []; a.push(match); byBarcode.set(it.barcode, a);
        }
        if (it.sku && it.sku !== it.barcode) {
          const a = byBarcode.get(it.sku) ?? []; a.push(match); byBarcode.set(it.sku, a);
        }
        const words = norm(it.name).split(" ").filter(w => w.length > 3 && !STOP.has(w));
        for (const w of words) {
          const a = byWord.get(w) ?? []; a.push(match); byWord.set(w, a);
        }
      }
      setPlIndex({ byBarcode, byWord });
    });
  }, []);

  // Загрузка из Firestore + досев пропущенных из каталога (один раз)
  useEffect(() => {
    seeded.current = false;
    const col = collection(db, `tenants/${businessId}/suppliers`);
    const unsub = onSnapshot(col, (snap) => {
      if (!seeded.current) {
        seeded.current = true;
        const existing = new Set(snap.docs.map((d) => d.id));
        const missing = CATALOG_FLAT.filter((s) => !existing.has(s.id));
        if (missing.length) {
          Promise.all(missing.map((s) => setDoc(doc(col, s.id), s))).catch(console.error);
        }
      }
      setSuppliers(snap.docs.map((d) => d.data() as Sup));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [businessId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return suppliers;

    // 1. Прямое совпадение по полям поставщика
    const direct = suppliers.filter((s) =>
      (s.name ?? "").toLowerCase().includes(q) ||
      (s.cat ?? "").toLowerCase().includes(q) ||
      (s.assortment ?? "").toLowerCase().includes(q)
    );

    // 2. Поиск по товарам в прайсе (штрихкод или ключевые слова)
    const hits = new Set<string>();
    if (plIndex) {
      // Точный матч по штрихкоду
      for (const m of (plIndex.byBarcode.get(q) ?? [])) hits.add(m.supplierName);
      // Словарный матч: нормализуем запрос и ищем каждое слово в индексе
      const words = norm(q).split(" ").filter(w => w.length > 3 && !STOP.has(w));
      for (const w of words) {
        for (const m of (plIndex.byWord.get(w) ?? [])) hits.add(m.supplierName);
      }
    }

    if (hits.size === 0) return direct;

    // Добавляем поставщиков из прайса, которых нет в direct
    const directIds = new Set(direct.map(s => s.id));
    const fromPl = suppliers.filter(s => hits.has(s.name) && !directIds.has(s.id));
    return [...direct, ...fromPl];
  }, [search, suppliers, plIndex]);

  const groups = useMemo(() => {
    const map = new Map<string, { icon: string; suppliers: Sup[] }>();
    for (const s of filtered) {
      const g = map.get(s.cat) ?? { icon: s.icon, suppliers: [] };
      g.suppliers.push(s);
      map.set(s.cat, g);
    }
    return [...map.entries()].map(([cat, v]) => ({ cat, ...v }));
  }, [filtered]);

  return (
    <div className="go-main">
      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20,flexWrap:"wrap",gap:10 }}>
        <div>
          <h1 className="go-title" style={{ marginBottom:6 }}>Поставщики · Густорико</h1>
          <a href={SHEET_URL} target="_blank" rel="noreferrer"
            style={{ fontSize:13,color:"#8B6914",textDecoration:"none",display:"inline-flex",alignItems:"center",gap:6,padding:"4px 10px",background:"rgba(200,154,52,.08)",borderRadius:8,border:"1px solid rgba(200,154,52,.25)" }}>
            📊 Все поставщики и прайсы — Google Sheets
          </a>
        </div>
        <button className="go-btn go-btn--gold" onClick={() => setEditSup("new")}>+ Добавить поставщика</button>
      </div>

      {/* Поиск */}
      <input className="go-search-input" style={{ maxWidth:"100%",marginBottom:20 }}
        placeholder="Поиск по поставщику, товару, штрихкоду..."
        value={search} onChange={(e) => setSearch(e.target.value)} />

      {/* Категории с тайлами */}
      <div className="go-cat-grid">
        {groups.map((g) => {
            const isOpen = openCat === g.cat || (search.length > 0);
            return (
              <div key={g.cat}>
                <button className={`go-cat-card${isOpen ? " go-cat-card--active" : ""}`}
                  onClick={() => setOpenCat(isOpen && !search ? null : g.cat)}>
                  <span className="go-cat-icon">{g.icon}</span>
                  <div className="go-cat-info">
                    <span className="go-cat-name">{g.cat}</span>
                    <span className="go-cat-counts">{g.suppliers.length} поставщ.</span>
                  </div>
                  <span className="go-cat-chevron">{isOpen ? "▲" : "▼"}</span>
                </button>

                {isOpen && (
                  <div style={{ border:"1px solid #C89A34",borderTop:"none",borderBottomLeftRadius:10,borderBottomRightRadius:10,padding:16,marginBottom:6,background:"#FEFCF6" }}>
                    <div style={{ display:"flex",flexWrap:"wrap",gap:10 }}>
                      {g.suppliers.map((s) => (
                        <SupplierTile key={s.id} s={s} onClick={() => setEditSup(s)} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
      </div>

      {loading && <div className="go-empty">Загрузка поставщиков…</div>}
      {!loading && groups.length === 0 && search.length > 0 && (
        <div className="go-empty">Ничего не найдено по «{search}»</div>
      )}

      {/* Модалка редактирования/добавления */}
      {editSup !== null && (
        <SupplierModal
          sup={editSup === "new" ? null : editSup}
          businessId={businessId}
          onClose={() => setEditSup(null)}
        />
      )}
    </div>
  );
}
