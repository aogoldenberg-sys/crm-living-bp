import { useCallback, useState } from "react";

/**
 * Разбор десятичного числа из пользовательского ввода.
 * Принимает запятую как разделитель, пробелы / NBSP / узкий NBSP между разрядами.
 * Возвращает null для пустой строки и любого некорректного ввода (никогда NaN).
 */
export function parseDecimal(raw: string): number | null {
  const s = raw.replace(/[\s  ]/g, "").replace(",", ".");
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Рубли (строка) → целые копейки. Пустая строка → emptyValue. Отрицательные/некорректные → null. */
export function rubToKopecks(raw: string, emptyValue: number | null = null): number | null {
  if (raw.trim() === "") return emptyValue;
  const n = parseDecimal(raw);
  if (n === null || n < 0) return null;
  return Math.round(n * 100);
}

/** Рубли (строка) → рубли, округлённые до копеек. */
export function parseRub(raw: string, emptyValue: number | null = null): number | null {
  const k = rubToKopecks(raw, emptyValue === null ? null : Math.round(emptyValue * 100));
  return k === null ? null : k / 100;
}

/**
 * Количество (в т.ч. весовое, кг/л) с точностью до 0,001.
 * allowZero=false → требуется строго > 0.
 */
export function parseQty(raw: string, allowZero = false): number | null {
  const n = parseDecimal(raw);
  if (n === null) return null;
  const q = Math.round(n * 1000) / 1000;
  if (q < 0 || (!allowZero && q === 0)) return null;
  return q;
}

/**
 * Локальные строковые черновики числовых полей: пока поле редактируется,
 * показываем ровно то, что ввёл пользователь (без переформатирования),
 * а в числовое состояние пишем только корректные значения.
 */
export function useNumDrafts() {
  const [drafts, setDrafts] = useState<Record<string, { text: string; ok: boolean }>>({});

  const value = useCallback(
    (key: string, fallback: string) => drafts[key]?.text ?? fallback,
    [drafts],
  );
  const invalid = useCallback((key: string) => drafts[key]?.ok === false, [drafts]);
  const set = useCallback((key: string, text: string, ok: boolean) => {
    setDrafts((p) => ({ ...p, [key]: { text, ok } }));
  }, []);
  const clear = useCallback((key: string) => {
    setDrafts((p) => {
      if (!(key in p)) return p;
      const n = { ...p };
      delete n[key];
      return n;
    });
  }, []);
  const clearAll = useCallback(() => setDrafts({}), []);
  const anyInvalid = Object.values(drafts).some((d) => !d.ok);

  return { value, invalid, set, clear, clearAll, anyInvalid };
}
