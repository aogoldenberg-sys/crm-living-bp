/**
 * Клиент для отправки событий в ingest-воркер.
 *
 * URL и секрет берутся из env — задаются в .env.local, не коммитятся.
 * Для MVP это достаточно: ingest — внутренний инструмент, не публичный API.
 */

const INGEST_URL = import.meta.env.VITE_INGEST_WORKER_URL as string | undefined;
const INGEST_SECRET = import.meta.env.VITE_INGEST_SECRET as string | undefined;

export interface IngestResult {
  events: number;
  skipped: number;
}

/**
 * Отправляет одно или несколько событий в ingest.
 * Throws если URL/секрет не настроены или сервер вернул ошибку.
 */
export async function postEvents(events: unknown[]): Promise<IngestResult> {
  if (!INGEST_URL || !INGEST_SECRET) {
    throw new Error(
      "VITE_INGEST_WORKER_URL и VITE_INGEST_SECRET не заданы в .env.local",
    );
  }

  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-secret": INGEST_SECRET,
    },
    body: JSON.stringify(events),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`ingest error: ${text}`);
  }

  return res.json() as Promise<IngestResult>;
}
