import { useEffect, useRef, useState } from "react";
import { useOrders, type Order } from "../useOrders";
import { esc } from "../htmlEscape";
import "../orders.css";

interface Props { businessId: string }

const YMAPS_KEY = "4772f4d3-e097-44d9-9adc-6fd741381c59";
const WAREHOUSES = [
  { id: "msk", label: "Москва", address: "Москва, 2-й Лыковский проезд, 3б" },
  { id: "spb", label: "Санкт-Петербург", address: "Санкт-Петербург, Обводного канала наб., 14" },
];
const ACTIVE_STATUSES = ["approved", "sourcing", "ordered"];

function loadYmaps(): Promise<void> {
  return new Promise((res, rej) => {
    const w = window as unknown as { ymaps?: { ready: (fn: () => void) => void } };
    if (w.ymaps?.ready) { w.ymaps.ready(res); return; }
    const s = document.createElement("script");
    s.src = `https://api-maps.yandex.ru/2.1/?apikey=${YMAPS_KEY}&lang=ru_RU`;
    s.onload = () => (window as any).ymaps.ready(res);
    s.onerror = () => rej(new Error("Yandex Maps failed to load"));
    document.head.appendChild(s);
  });
}

function dayBucket(iso: string): "today" | "tomorrow" | "d2" | "later" {
  const target = new Date(iso); target.setHours(0, 0, 0, 0);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - now.getTime()) / 86400000);
  if (diff <= 0)  return "today";
  if (diff === 1) return "tomorrow";
  if (diff === 2) return "d2";
  return "later";
}

const DAY_TABS = [
  { id: "today",    label: "Сегодня" },
  { id: "tomorrow", label: "Завтра" },
  { id: "d2",       label: "+2 дня" },
  { id: "all",      label: "Все" },
] as const;

export function LogisticsView({ businessId }: Props) {
  const { orders, loading } = useOrders(businessId, "director", "", { archive: false });
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const ymapRef = useRef<any>(null);
  const routeRef = useRef<any>(null);
  const placemarksRef = useRef<any>(null);
  const [warehouse, setWarehouse] = useState("msk");
  const [dayTab, setDayTab] = useState<"today" | "tomorrow" | "d2" | "all">("today");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [building, setBuilding] = useState(false);
  const [routeInfo, setRouteInfo] = useState<{ distance: string; duration: string } | null>(null);
  const [mapError, setMapError] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [geocodeStatus, setGeocodeStatus] = useState<string | null>(null);

  const withAddress = orders.filter((o: Order) => ACTIVE_STATUSES.includes(o.status) && o.address);

  const filtered = dayTab === "all" ? withAddress : withAddress.filter((o: Order) => {
    const bucket = o.deliveryDate ? dayBucket(o.deliveryDate) : "today";
    return bucket === dayTab;
  });

  useEffect(() => {
    loadYmaps()
      .then(() => {
        if (!mapContainerRef.current || ymapRef.current) return;
        const ymaps = (window as any).ymaps;
        ymapRef.current = new ymaps.Map(mapContainerRef.current, {
          center: warehouse === "spb" ? [59.93, 30.32] : [55.75, 37.57],
          zoom: 9,
          controls: ["zoomControl", "typeSelector", "fullscreenControl"],
        });
        setMapReady(true);
      })
      .catch(() => setMapError(true));
    return () => {
      if (ymapRef.current) { ymapRef.current.destroy(); ymapRef.current = null; }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Показываем плейсмарки — координаты берём из Firestore (lat/lng от sync.mjs)
  useEffect(() => {
    const ymaps = (window as any).ymaps;
    if (!mapReady || !ymaps || !ymapRef.current) return;

    if (placemarksRef.current) {
      ymapRef.current.geoObjects.remove(placemarksRef.current);
      placemarksRef.current = null;
    }

    if (filtered.length === 0) { setGeocodeStatus(null); return; }

    const collection = new ymaps.GeoObjectCollection();
    ymapRef.current.geoObjects.add(collection);
    placemarksRef.current = collection;

    let added = 0;
    let pending = 0;
    for (const order of filtered) {
      if (order.lat && order.lng) {
        const pm = new ymaps.Placemark([order.lat, order.lng], {
          balloonContent: `<b>${order.customerName}</b><br/>${order.address ?? ""}${order.phone ? `<br/>📞 ${order.phone}` : ""}`,
          hintContent: order.customerName,
        }, { preset: "islands#redDotIcon" });
        collection.add(pm);
        added++;
      } else {
        pending++;
      }
    }

    if (added > 0) {
      try { ymapRef.current.setBounds(collection.getBounds(), { checkZoomRange: true, zoomMargin: 60 }); } catch { /* ignore */ }
      setGeocodeStatus(`✓ ${added} точек${pending > 0 ? ` · ${pending} без координат (появятся после синхронизации)` : ""}`);
    } else {
      setGeocodeStatus("Координаты загружаются при следующей синхронизации (~15 мин)");
    }
  }, [filtered, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function selectAll() {
    setSelected(new Set(filtered.map(o => o.id)));
  }

  async function buildRoute() {
    const ymaps = (window as any).ymaps;
    if (!ymaps || !ymapRef.current) return;
    const picks = filtered.filter((o: Order) => selected.has(o.id));
    if (picks.length === 0) return;

    setBuilding(true);
    setRouteInfo(null);
    if (routeRef.current) { ymapRef.current.geoObjects.remove(routeRef.current); routeRef.current = null; }

    const wh = WAREHOUSES.find(w => w.id === warehouse)!;
    const points = [wh.address, ...picks.map((o: Order) => o.address!), wh.address];

    const route = new ymaps.multiRouter.MultiRoute(
      { referencePoints: points, params: { routingMode: "auto" } },
      { boundsAutoApply: true, wayPointStartIconColor: "#C89A34", wayPointFinishIconColor: "#2E7D32" },
    );

    route.model.events.once("requestsuccess", () => {
      const r = route.model.getRoutes()[0];
      if (r) {
        setRouteInfo({
          distance: r.properties.get("distance")?.text ?? "—",
          duration: r.properties.get("duration")?.text ?? "—",
        });
      }
      setBuilding(false);
    });
    route.model.events.once("requesterror", () => setBuilding(false));

    ymapRef.current.geoObjects.add(route);
    routeRef.current = route;
  }

  function printSheet() {
    const wh = WAREHOUSES.find(w => w.id === warehouse)!;
    const picks = filtered.filter((o: Order) => selected.has(o.id));
    const date = new Date().toLocaleDateString("ru-RU");
    const rows = picks.map((o: Order, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${esc(o.customerName)}</td>
        <td>${esc(o.address ?? "—")}</td>
        <td>${esc(o.phone ?? "—")}</td>
        <td>${o.items.length} поз.</td>
        <td style="width:80px"></td>
      </tr>`).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>Путевой лист ${date}</title>
      <style>
        body{font-family:Arial,sans-serif;font-size:12px;padding:24px;color:#111}
        h2{margin:0 0 4px;font-size:16px}
        .meta{color:#555;margin-bottom:16px;font-size:11px;border-bottom:1px solid #ddd;padding-bottom:8px}
        table{width:100%;border-collapse:collapse;margin-bottom:24px}
        th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;font-size:11px}
        th{background:#f5f5f5;font-weight:700}
        .signs{display:flex;gap:40px;margin-top:40px}
        .sign{flex:1;border-top:1px solid #333;padding-top:6px;font-size:11px;color:#555}
      </style></head><body>
      <h2>Путевой лист — Густорико</h2>
      <div class="meta">Дата: ${date} &nbsp;|&nbsp;
        Склад: ${esc(wh.label)} (${esc(wh.address)}) &nbsp;|&nbsp;
        Маршрут: ${esc(routeInfo?.distance ?? "не построен")} / ${esc(routeInfo?.duration ?? "—")} &nbsp;|&nbsp;
        Точек: ${picks.length}
      </div>
      <table>
        <thead><tr>
          <th style="width:30px">#</th>
          <th>Клиент</th><th>Адрес</th><th>Телефон</th>
          <th style="width:60px">Позиций</th>
          <th style="width:80px">Подпись</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="signs">
        <div class="sign">Водитель: ___________________</div>
        <div class="sign">Диспетчер: ___________________</div>
        <div class="sign">Дата выезда: ___________________</div>
      </div>
      </body></html>`;

    const win = window.open("", "_blank");
    if (win) { win.document.write(html); win.document.close(); win.print(); }
  }

  if (loading) return <div className="go-empty">Загрузка…</div>;

  return (
    <div style={{ display: "flex", gap: 16, height: "calc(100vh - 120px)", overflow: "hidden" }}>

      {/* ── Левая панель ── */}
      <div style={{ width: 320, display: "flex", flexDirection: "column", gap: 10, overflowY: "auto", flexShrink: 0, paddingBottom: 12 }}>
        <div className="go-header" style={{ marginBottom: 0 }}>
          <h2 className="go-title" style={{ fontSize: 17 }}>Логистика</h2>
          <p className="go-subtitle" style={{ fontSize: 11 }}>Маршруты доставки</p>
        </div>

        {/* Склад */}
        <div style={{ display: "flex", gap: 6 }}>
          {WAREHOUSES.map(w => (
            <button key={w.id} onClick={() => setWarehouse(w.id)} style={{
              flex: 1, padding: "6px 8px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: `1px solid ${warehouse === w.id ? "#C89A34" : "#e0d8cc"}`,
              background: warehouse === w.id ? "rgba(200,154,52,.12)" : "transparent",
              color: warehouse === w.id ? "#8B6914" : "#777",
            }}>{w.label}</button>
          ))}
        </div>

        {/* День */}
        <div style={{ display: "flex", gap: 4 }}>
          {DAY_TABS.map(({ id, label }) => (
            <button key={id} onClick={() => setDayTab(id)} style={{
              flex: 1, padding: "5px 2px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer",
              border: `1px solid ${dayTab === id ? "#1565C0" : "#e0d8cc"}`,
              background: dayTab === id ? "rgba(21,101,192,.08)" : "transparent",
              color: dayTab === id ? "#1565C0" : "#777",
            }}>{label}</button>
          ))}
        </div>

        {/* Список */}
        {filtered.length === 0 ? (
          <div className="go-empty" style={{ fontSize: 12 }}>Нет заказов с адресом</div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#8B7355" }}>{filtered.length} заказов</span>
              <button onClick={selectAll} style={{ fontSize: 11, color: "#1565C0", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                Выбрать все
              </button>
            </div>
            {filtered.map((o: Order) => (
              <label key={o.id} style={{
                display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 10px", cursor: "pointer",
                background: selected.has(o.id) ? "rgba(200,154,52,.07)" : "#fff",
                border: `1px solid ${selected.has(o.id) ? "rgba(200,154,52,.35)" : "#ede8df"}`,
                borderRadius: 8, fontSize: 12,
              }}>
                <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)}
                  style={{ marginTop: 2, accentColor: "#C89A34" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.customerName}</div>
                  <div style={{ color: "#8B7355", fontSize: 11, marginTop: 2 }}>{o.address}</div>
                  {o.phone && <div style={{ color: "#555", fontSize: 11 }}>{o.phone}</div>}
                  {o.deliveryDate && (
                    <div style={{ color: "#2E7D32", fontSize: 10, marginTop: 2 }}>
                      Доставка: {new Date(o.deliveryDate).toLocaleDateString("ru-RU")}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </>
        )}

        {/* Статус геокодирования */}
        {geocodeStatus && (
          <div style={{ fontSize: 11, color: geocodeStatus.startsWith("❌") ? "#C62828" : "#2E7D32", textAlign: "center", padding: "4px 0" }}>
            {geocodeStatus}
          </div>
        )}

        {/* Кнопки */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
          {routeInfo && (
            <div style={{ fontSize: 12, color: "#2E7D32", fontWeight: 600, textAlign: "center", padding: "6px 0" }}>
              {routeInfo.distance} · {routeInfo.duration}
            </div>
          )}
          <button onClick={() => void buildRoute()} disabled={selected.size === 0 || building} style={{
            padding: "10px", borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: selected.size > 0 ? "pointer" : "default",
            background: selected.size > 0 ? "#C89A34" : "#e8e4dc", color: selected.size > 0 ? "#fff" : "#aaa", border: "none",
          }}>
            {building ? "Строим маршрут…" : `Маршрут (${selected.size} точек)`}
          </button>
          <button onClick={printSheet} disabled={selected.size === 0} style={{
            padding: "8px", borderRadius: 8, fontSize: 12, fontWeight: 600,
            cursor: selected.size > 0 ? "pointer" : "default",
            background: "transparent", border: `1px solid ${selected.size > 0 ? "#1565C0" : "#e0d8cc"}`,
            color: selected.size > 0 ? "#1565C0" : "#aaa",
          }}>
            Путевой лист
          </button>
        </div>
      </div>

      {/* ── Карта ── */}
      {mapError ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#C62828", fontSize: 13 }}>
          Не удалось загрузить карту
        </div>
      ) : (
        <div ref={mapContainerRef} style={{ flex: 1, borderRadius: 12, overflow: "hidden", minHeight: 400 }} />
      )}
    </div>
  );
}
