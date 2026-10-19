import { auth } from "../firebase";

// РЕШЕНИЕ: Bearer-токен и X-Idempotency-Key шлём только при VITE_SEND_ID_TOKEN=1.
// Пока pay-proxy / crm-email / crm-matrix не разрешили эти заголовки в CORS, браузер
// заблокирует запрос целиком — рассылка, переписка и звонки сломаются. Включать после серверов.
export const SEND_ID_TOKEN = import.meta.env.VITE_SEND_ID_TOKEN === "1";

/** Заголовок Authorization для наших прокси/воркеров: сервер проверяет Firebase ID token и email в emailRoles. */
export async function authHeader(): Promise<Record<string, string>> {
  if (!SEND_ID_TOKEN) return {};
  const token = await auth.currentUser?.getIdToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
