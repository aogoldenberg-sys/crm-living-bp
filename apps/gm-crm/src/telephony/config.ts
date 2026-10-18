/** URL Cloudflare Worker — заполнить после деплоя */
export const MATRIX_WORKER_URL = "https://crm-matrix.aogoldenberg.workers.dev";

/**
 * Карта: имя менеджера (как в CRM) → внутренний номер/логин в Matrix АТС.
 * Заполнить после получения данных от Matrix.
 */
// Внутренние номера Matrix АТС: имя менеджера → extension
export const MANAGER_EXTENSIONS: Record<string, string> = {
  "admin":    "701",
  "Анатолий": "705",
  "anatoliy": "705",
  "Марина":   "704",
  "marina":   "704",
};

/** Найти extension по имени менеджера (fuzzy: первое совпадение подстроки) */
export function findExtension(managerName: string | null | undefined): string | null {
  if (!managerName) return null;
  const key = Object.keys(MANAGER_EXTENSIONS).find(k =>
    managerName.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(managerName.toLowerCase())
  );
  return key ? (MANAGER_EXTENSIONS[key] ?? null) : null;
}
