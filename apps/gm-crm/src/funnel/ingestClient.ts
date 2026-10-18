/**
 * Клиент для отправки событий в ingest-воркер.
 *
 * URL берётся из env — задаётся в .env.local, не коммитится.
 */

const INGEST_URL = import.meta.env.VITE_INGEST_WORKER_URL as string | undefined;

export interface IngestResult {
  events: number;
  skipped: number;
}

/**
 * Отправляет события в ingest /events-user через Firebase ID token.
 * idToken — результат getIdToken() из Firebase Auth — передаётся снаружи.
 */
export async function postEvents(events: unknown[], idToken: string): Promise<IngestResult> {
  if (!INGEST_URL) {
    throw new Error("VITE_INGEST_WORKER_URL не задан в .env.local");
  }
  if (!idToken) {
    throw new Error("Firebase ID token required");
  }

  const res = await fetch(`${INGEST_URL}/events-user`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`,
    },
    body: JSON.stringify(events),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`ingest error: ${text}`);
  }

  return res.json() as Promise<IngestResult>;
}
