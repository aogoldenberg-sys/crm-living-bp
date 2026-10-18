// ── Индекс прайса для сборки и поиска поставщиков ──────────────────────────
// Чистые функции (без React/Firebase) — покрыты тестами (plIndex.test.ts).
// Ключи byBarcode нормализуются через normalizeBarcode: штрихкод/артикул
// числом и строкой, с ведущими нулями, ".0" и т.п. дают один ключ.

import { normalizeBarcode, type PricelistMatch, type loadPricelist } from "./useOrders";

type PlItem = Awaited<ReturnType<typeof loadPricelist>>[number];

export type PlIndex = {
  byBarcode: Map<string, PricelistMatch[]>; // normalizeBarcode(barcode|sku) → matches
  byWord:    Map<string, PricelistMatch[]>; // нормализованное слово → matches
};

export const PL_STOP = new Set(["вода","напиток","напитки","газированный","газированная",
  "негазированный","натуральный","сок","соки","молоко","масло","сахар","мл","пэт",
  "стекло","банка","жестяная","картон","блок","упаковка","штук","литр","литра",
  "литров","грамм","гр","кг","шт","пак","дой","туба","бутылка","бут"]);

export function plNorm(s: string): string {
  return String(s ?? "").toLowerCase().replace(/[^а-яёa-z0-9]/gi, " ").replace(/\s+/g, " ").trim();
}

/** Индексы по нормализованному штрихкоду/артикулу и по словам названия. */
export function buildPlIndex(pl: PlItem[]): PlIndex {
  const byBarcode: PlIndex["byBarcode"] = new Map();
  const byWord: PlIndex["byWord"] = new Map();
  const push = (idx: Map<string, PricelistMatch[]>, k: string | null, m: PricelistMatch) => {
    if (!k) return;
    const arr = idx.get(k);
    if (arr) arr.push(m); else idx.set(k, [m]);
  };
  for (const it of pl) {
    // Фильтруем мусорные цены (дата из Excel, > 10 млн руб за коробку)
    if (it.price > 10_000_000) continue;
    // price уже в копейках за штуку; quant = мин. кол-во заказа (не делитель)
    const match: PricelistMatch = {
      supplierId: it.sid, supplierName: it.sname,
      priceKopecks: it.price,
      barcode: it.barcode == null ? null : String(it.barcode),
      productName: it.name,
    };
    const bc = normalizeBarcode(it.barcode);
    const sku = normalizeBarcode(it.sku);
    push(byBarcode, bc, match);
    if (sku && sku !== bc) push(byBarcode, sku, match);
    // Индексируем каждое значимое слово из названия товара
    const words = plNorm(it.name).split(" ").filter(w => w.length > 3 && !PL_STOP.has(w));
    for (const w of words) push(byWord, w, match);
  }
  return { byBarcode, byWord };
}

/** Поиск по коду (штрихкод/артикул) с нормализацией запроса. */
export function plLookupCode(plIndex: PlIndex, code: unknown): PricelistMatch[] | undefined {
  const k = normalizeBarcode(code);
  return k ? plIndex.byBarcode.get(k) : undefined;
}

/** Подбор предложений прайса для позиции заказа (сборка заказа). */
export function computePlMatches(
  plIndex: PlIndex,
  item: { productName: string; barcode?: string | number | null; productId?: string | number | null },
): PricelistMatch[] {
  const sorted = (arr: PricelistMatch[]) => [...arr].sort((a, b) => (a.priceKopecks ?? 0) - (b.priceKopecks ?? 0));
  const byBc = plLookupCode(plIndex, item.barcode);
  if (byBc?.length) return sorted(byBc);
  const byId = plLookupCode(plIndex, item.productId);
  if (byId?.length) return sorted(byId);

  const words = plNorm(item.productName).split(" ").filter(w => w.length >= 3 && !PL_STOP.has(w)).slice(0, 5);
  if (!words.length) return [];
  const wordSets = words.map(w => ({ w, hits: plIndex.byWord.get(w) ?? [] }));
  wordSets.sort((a, b) => a.hits.length - b.hits.length);
  const anchor = wordSets.find(s => s.hits.length > 0);
  if (!anchor) return [];
  const minMatch = Math.max(1, Math.ceil(words.length * 0.5));
  // Если запрос — продукт питания, пропускаем упаковочные позиции
  const PACK = ["стакан", "бумажный", "крышка", "дпе16", "подложк"];
  const queryIsFood = !PACK.some(w => plNorm(item.productName).includes(w));
  const seen = new Map<string, PricelistMatch>();
  for (const m of anchor.hits) {
    const n = plNorm(m.productName);
    if (queryIsFood && PACK.some(w => n.includes(w))) continue;
    if (words.filter(w => n.includes(w)).length < minMatch) continue;
    const key = m.supplierName + "|" + m.productName;
    const ex = seen.get(key);
    if (!ex || (m.priceKopecks ?? 0) < (ex.priceKopecks ?? 0)) seen.set(key, m);
  }
  return sorted([...seen.values()]).slice(0, 6);
}
