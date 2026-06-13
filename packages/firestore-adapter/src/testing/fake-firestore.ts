/**
 * In-memory реализация Firestore для тестов.
 *
 * Почему свой фейк вместо эмулятора: эмулятор требует запущенного процесса
 * и инициализации firebase-admin, что делает тесты медленными и зависимыми
 * от среды. Фейк работает в памяти, запускается за миллисекунды, не требует
 * никакого окружения.
 *
 * Покрывает только методы, которые реально использует адаптер:
 * collection → doc → set/get и collection → where → get.
 * Не имитирует транзакции, листенеры, индексы и прочее — YAGNI.
 *
 * Не импортирует firebase-admin: файл должен работать в тестах без
 * инициализации приложения. Приведение к нужному типу делается в тест-файлах
 * через `as unknown as FirebaseFirestore.Firestore`.
 */

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

/** Строитель запроса с поддержкой where-фильтров. */
class FakeQuery {
  protected filters: Array<{ field: string; op: string; value: unknown }> = [];

  constructor(protected readonly store: Map<string, StoredDoc>) {}

  where(field: string, op: string, value: unknown): FakeQuery {
    const q = new FakeQuery(this.store);
    q.filters = [...this.filters, { field, op, value }];
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
class FakeDocRef {
  constructor(
    private readonly store: Map<string, StoredDoc>,
    readonly id: string,
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
}

/** Ссылка на коллекцию — аналог CollectionReference. */
class FakeCollectionRef extends FakeQuery {
  constructor(store: Map<string, StoredDoc>) {
    super(store);
  }

  doc(id: string): FakeDocRef {
    return new FakeDocRef(this.store, id);
  }
}

/** Корневой объект, имитирующий FirebaseFirestore.Firestore. */
export class FakeFirestore {
  /** Отдельный Map на каждую коллекцию: `collectionPath → (docId → data)`. */
  private readonly collections = new Map<string, Map<string, StoredDoc>>();

  collection(path: string): FakeCollectionRef {
    if (!this.collections.has(path)) {
      this.collections.set(path, new Map());
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return new FakeCollectionRef(this.collections.get(path)!);
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
    // Возвращаем прокси, который бросит при get() или set()
    const err = this.error;
    return {
      where: () => ({
        get: async () => { throw err; },
      }),
      doc: () => ({
        set: async () => { throw err; },
        get: async () => { throw err; },
        id: "fake",
      }),
      get: async () => { throw err; },
      filters: [],
    } as unknown as ReturnType<FakeFirestore["collection"]>;
  }
}
