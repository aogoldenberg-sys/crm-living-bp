/**
 * In-memory реализация Db-интерфейса для тестов.
 *
 * Почему свой фейк вместо эмулятора: эмулятор требует запущенного процесса,
 * Firebase-проекта и инициализации — делает тесты медленными и зависимыми
 * от среды. Фейк работает в памяти, запускается за миллисекунды.
 *
 * Покрывает только методы, которые реально использует адаптер:
 * collection → doc → set/get и collection → (where →)? orderBy → get.
 * Не имитирует транзакции, листенеры, индексы — YAGNI.
 *
 * Явно реализует интерфейс Db из db.ts — TypeScript проверит совместимость
 * с FirestoreRestClient на этапе компиляции.
 */

import type { Db, CollectionRef, DocRef, DocSnapshot, QuerySnapshot, Query } from "../db.js";

type DocData = Record<string, unknown>;

/** Хранит один документ: данные + флаг существования. */
interface StoredDoc {
  data: DocData;
  exists: boolean;
}

/** Фиктивный snapshot документа, аналог DocumentSnapshot. */
class FakeDocSnapshot {
  constructor(
    private readonly _data: DocData | undefined,
    readonly exists: boolean,
    readonly id: string,
  ) {}

  data(): DocData | undefined {
    return this._data;
  }
}

/** Фиктивный snapshot запроса, аналог QuerySnapshot. */
class FakeQuerySnapshot {
  constructor(readonly docs: FakeDocSnapshot[]) {}
}

/** Строитель запроса с поддержкой where-фильтров и orderBy. */
class FakeQuery {
  protected filters: Array<{ field: string; op: string; value: unknown }> = [];
  protected _orderBy: { field: string; direction: "asc" | "desc" } | null = null;

  constructor(protected readonly store: Map<string, StoredDoc>) {}

  where(field: string, op: string, value: unknown): FakeQuery {
    const q = new FakeQuery(this.store);
    q.filters = [...this.filters, { field, op, value }];
    q._orderBy = this._orderBy;
    return q;
  }

  /**
   * Сортировка нужна в тестах, чтобы поведение совпадало с реальным Firestore.
   * Сортируем лексикографически — для IsoDateTime (Z-суффикс) это корректный
   * хронологический порядок.
   */
  orderBy(field: string, direction: "asc" | "desc" = "asc"): FakeQuery {
    const q = new FakeQuery(this.store);
    q.filters = [...this.filters];
    q._orderBy = { field, direction };
    return q;
  }

  async get(): Promise<FakeQuerySnapshot> {
    const docs: FakeDocSnapshot[] = [];

    for (const [id, stored] of this.store.entries()) {
      if (!stored.exists) continue;

      if (this.matchesFilters(stored.data)) {
        docs.push(new FakeDocSnapshot(stored.data, true, id));
      }
    }

    if (this._orderBy) {
      const { field, direction } = this._orderBy;
      docs.sort((a, b) => {
        const aVal = String(a.data()?.[field] ?? "");
        const bVal = String(b.data()?.[field] ?? "");
        const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        return direction === "asc" ? cmp : -cmp;
      });
    }

    return new FakeQuerySnapshot(docs);
  }

  private matchesFilters(data: DocData): boolean {
    return this.filters.every(({ field, op, value }) => {
      const docVal = data[field];
      if (docVal === undefined || docVal === null) return false;
      // Приводим к string для лексикографического сравнения ISO-дат/дататаймов.
      // Для числовых полей также работает корректно при однотипных значениях.
      const a = String(docVal);
      const b = String(value);
      if (op === ">=") return a >= b;
      if (op === "<=") return a <= b;
      if (op === "==") return a === b;
      return true;
    });
  }
}

/** Ссылка на документ — аналог DocumentReference. */
class FakeDocRef implements DocRef {
  constructor(
    private readonly store: Map<string, StoredDoc>,
    readonly id: string,
    private readonly db: FakeFirestore,
    private readonly collectionPath: string,
  ) {}

  async set(data: DocData): Promise<void> {
    this.store.set(this.id, { data, exists: true });
  }

  async get(): Promise<FakeDocSnapshot> {
    const stored = this.store.get(this.id);
    if (!stored || !stored.exists) {
      return new FakeDocSnapshot(undefined, false, this.id);
    }
    return new FakeDocSnapshot(stored.data, true, this.id);
  }

  collection(path: string): CollectionRef {
    return this.db.collection(`${this.collectionPath}/${this.id}/${path}`);
  }
}

/** Ссылка на коллекцию — аналог CollectionReference. */
class FakeCollectionRef extends FakeQuery {
  constructor(
    store: Map<string, StoredDoc>,
    private readonly db: FakeFirestore,
    private readonly path: string,
  ) {
    super(store);
  }

  doc(id: string): FakeDocRef {
    return new FakeDocRef(this.store, id, this.db, this.path);
  }
}

/** Корневой объект, реализующий интерфейс Db. */
export class FakeFirestore implements Db {
  /** Отдельный Map на каждую коллекцию: `collectionPath → (docId → data)`. */
  private readonly collections = new Map<string, Map<string, StoredDoc>>();

  collection(path: string): FakeCollectionRef {
    if (!this.collections.has(path)) {
      this.collections.set(path, new Map());
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return new FakeCollectionRef(this.collections.get(path)!, this, path);
  }

  /** Вспомогательный метод для тестов: выбросить при следующей операции. */
  throwOnNext(error: Error): void {
    this._pendingError = error;
  }

  private _pendingError: Error | null = null;

  /** Проверяется коллекцией — если задан pendingError, бросает и сбрасывает флаг. */
  _checkError(): void {
    if (this._pendingError) {
      const e = this._pendingError;
      this._pendingError = null;
      throw e;
    }
  }
}

/**
 * Версия FakeFirestore с поддержкой симуляции ошибок I/O.
 * Оборачивает collection() так, чтобы первый вызов get/set бросил ошибку.
 */
export class ErrorFakeFirestore extends FakeFirestore {
  private readonly error: Error;

  constructor(error: Error) {
    super();
    this.error = error;
  }

  override collection(_path: string): ReturnType<FakeFirestore["collection"]> {
    // Возвращаем прокси, который бросит при get() или set().
    // Покрываем все цепочки, которые использует адаптер:
    //   col.orderBy().get()
    //   col.where().orderBy().get()
    const err = this.error;
    const throwingQuery = { orderBy: () => throwingQuery, get: async () => { throw err; } };
    return {
      where: () => throwingQuery,
      orderBy: () => throwingQuery,
      doc: () => ({
        set: async () => { throw err; },
        get: async () => { throw err; },
        collection: () => { throw err; },
        id: "fake",
      }),
      get: async () => { throw err; },
      filters: [],
      _orderBy: null,
    } as unknown as ReturnType<FakeFirestore["collection"]>;
  }
}
