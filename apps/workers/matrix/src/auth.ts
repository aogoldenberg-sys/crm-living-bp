/**
 * Проверка сотрудника Густорико по Firebase ID token.
 * Подпись и срок токена проверяет сам Firestore REST, а правило emailRoles/{email}
 * пускает только владельца этого email — значит 200 = валидный токен сотрудника.
 */

export type Verdict = "ok" | "anonymous" | "denied";

// Кэш на изолят: /events опрашивается каждые несколько секунд, без кэша — чтение Firestore на каждый опрос.
const verified = new Map<string, number>();
const TTL_MS = 5 * 60_000;

function claims(token: string): { email?: string; exp?: number } | null {
  try {
    const part = token.split(".")[1] ?? "";
    return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as { email?: string; exp?: number };
  } catch {
    return null;
  }
}

export async function checkEmployee(req: Request, projectId: string): Promise<Verdict> {
  const header = req.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) return "anonymous";
  const token = header.slice(7);
  const now = Date.now();
  if ((verified.get(token) ?? 0) > now) return "ok";

  const c = claims(token);
  if (!c?.email || !c.exp) return "denied";
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/tenants/gustoriko/emailRoles/${encodeURIComponent(c.email)}`;
  const r = await fetch(url, { headers: { Authorization: header } });
  if (!r.ok) return "denied";

  if (verified.size > 500) verified.clear();
  verified.set(token, Math.min(c.exp * 1000, now + TTL_MS));
  return "ok";
}
