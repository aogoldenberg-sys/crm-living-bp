/**
 * Доменные ошибки — не исключения, а данные.
 * Result вместо throw: ошибки явны в сигнатурах и проверяются TypeScript-ом.
 * Ядро никогда не бросает, чтобы вышестоящий слой мог безопасно делать reduce.
 */
export type DomainError =
  | { code: "INVALID_PERIOD"; message: string }
  | { code: "NO_EVENTS"; message: string }
  | { code: "NEGATIVE_BALANCE"; message: string }
  /** Plan = 0 при попытке вычислить отклонение — не период невалидный, а план не задан. */
  | { code: "ZERO_PLAN"; message: string };

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: DomainError };

/** Хелперы-конструкторы устраняют шаблонный код в каждой функции. */
export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err(error: DomainError): Result<never> {
  return { ok: false, error };
}
