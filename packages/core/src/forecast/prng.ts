/**
 * Детерминированный PRNG вместо Math.random: тесты воспроизводимы при том же seed.
 * Mulberry32 — быстрый 32-битный генератор с хорошим распределением.
 * rng создаётся снаружи и передаётся параметром, чтобы функции оставались чистыми.
 */
export function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Box-Muller преобразует два равномерных [0,1) в стандартное нормальное.
 * Используем cos-ветку (не sin), чтобы тратить ровно 2 вызова rng на одно число.
 * Граничный случай u1=0 → log(0) = -Infinity; на практике вероятность ~2^-32, но
 * Math.max защищает от NaN при строгом тестировании.
 */
export function normalSample(mean: number, std: number, rng: () => number): number {
  const u1 = Math.max(rng(), Number.EPSILON);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + std * z;
}

/**
 * Knuth algorithm для Poisson с малым λ (λ ≤ 30).
 * Для λ > 30 используем нормальное приближение (CLT — Poisson → N(λ, λ) при большом λ).
 *
 * Почему не normalSample: нормальное распределение даёт непрерывные (дробные) значения
 * и отрицательные числа сделок. Poisson — дискретное, неотрицательное, точное.
 */
export function poissonSample(lambda: number, rng: () => number): number {
  if (lambda <= 0) return 0;
  if (lambda > 30) {
    // Normal approximation: Poisson(λ) ≈ N(λ, √λ) for large λ
    const sample = Math.round(Math.max(0, normalSample(lambda, Math.sqrt(lambda), rng)));
    return sample;
  }
  // Knuth algorithm
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}
