// Единое определение региона заказа/остатка.
// В базе встречаются: "msk" | "spb" | "Москва" | "Санкт-Петербург" |
// "Московская область" | "Ленинградская область" | null (тогда смотрим адрес).

export type RegionCode = "msk" | "spb";

const SPB_MARKERS = ["spb", "спб", "петербург", "с.-петербург", "ленинградская", "ленобласть"];

function hasSpbMarker(s: string): boolean {
  const v = s.toLowerCase();
  return SPB_MARKERS.some((m) => v.includes(m));
}

/** Нормализует регион. Без явного признака СПб — "msk" (основной склад). */
export function normalizeRegion(region?: string | null, address?: string | null): RegionCode {
  if (region && region.trim()) return hasSpbMarker(region) ? "spb" : "msk";
  if (address && hasSpbMarker(address)) return "spb";
  return "msk";
}

/** Совпадает ли объект с фильтром региона (undefined — без фильтра). */
export function matchesRegion(
  obj: { region?: string | null; address?: string | null },
  filter?: string,
): boolean {
  if (!filter) return true;
  return normalizeRegion(obj.region, obj.address) === normalizeRegion(filter);
}
