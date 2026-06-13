/**
 * Перцентили считаются из отсортированного массива по методу "nearest rank".
 * Сортировка выполняется единожды на входе, чтобы не дублировать её для p10/p50/p90.
 * Передача уже отсортированного массива — ответственность вызывающего кода.
 */

/**
 * Возвращает p-й перцентиль (0..1) из уже отсортированного массива.
 * Нижняя граница индекса защищена ?? 0 для noUncheckedIndexedAccess.
 */
export function percentileFromSorted(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)] ?? 0;
}

export interface TriplePercentile {
  p10: number;
  p50: number;
  p90: number;
}

/**
 * Принимает несортированный столбец значений (одна точка времени, все итерации).
 * Сортирует in-place — вызывающий код должен передавать мутируемый массив.
 * Возвращает p10/p50/p90 за один проход.
 */
export function computePercentiles(values: number[]): TriplePercentile {
  values.sort((a, b) => a - b);
  return {
    p10: percentileFromSorted(values, 0.1),
    p50: percentileFromSorted(values, 0.5),
    p90: percentileFromSorted(values, 0.9),
  };
}
