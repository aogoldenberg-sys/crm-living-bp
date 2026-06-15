/**
 * Минимальный интерфейс Db: только то, что реально использует адаптер.
 *
 * Две реализации:
 *   - FirestoreRestClient (rest-client.ts) — для CF Workers (fetch + JWT, без gRPC)
 *   - FakeFirestore (testing/fake-firestore.ts) — для unit-тестов (in-memory)
 *
 * firebase-admin остаётся в client.ts для VPS/серверного кода,
 * но Workers его не используют — только REST.
 */

export interface DocSnapshot {
  readonly exists: boolean;
  readonly id: string;
  data(): Record<string, unknown> | undefined;
}

export interface QuerySnapshot {
  readonly docs: ReadonlyArray<DocSnapshot>;
}

export interface Query {
  where(field: string, op: string, value: unknown): Query;
  orderBy(field: string, direction?: "asc" | "desc"): Query;
  get(): Promise<QuerySnapshot>;
}

export interface CollectionRef extends Query {
  doc(id: string): DocRef;
}

export interface DocRef {
  readonly id: string;
  get(): Promise<DocSnapshot>;
  set(data: Record<string, unknown>): Promise<void>;
}

export interface Db {
  collection(path: string): CollectionRef;
}
