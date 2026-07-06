import type { BusinessEvent } from "@crm/schemas";
import type {
  RequestItem,
  ChecklistEntry,
  DocAvailability,
  PrimaryDocKind,
} from "@crm/schemas";

/**
 * Сопоставление пунктов запроса с event-логом.
 * Чистые функции. Ноль импортов кроме schemas.
 *
 * Главный инвариант модуля:
 *   restorable ⇒ evidence.length ≥ 1
 * Документ восстановим ТОЛЬКО если операция есть в логе.
 */

/**
 * Локальная ошибка сопоставления. Коды намеренно отличаются от DomainError —
 * это бизнес-валидация входных данных запроса, не инфраструктурная ошибка.
 */
type MatchError = {
  code: "invalid_period" | "empty_request";
  detail: string;
};

type MatchResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: MatchError };

/** Какие типы событий подтверждают какой вид документа. */
const EVIDENCE_MAP: Record<PrimaryDocKind, ReadonlyArray<BusinessEvent["type"]>> = {
  payment_order: ["payment_in", "payment_out"],
  bank_statement: ["payment_in", "payment_out"],
  account_card: ["payment_in", "payment_out"],
  invoice: ["deal_stage_changed", "payment_in"],
  invoice_facture: ["payment_in", "deal_stage_changed"],
  act: ["deal_stage_changed"],
  waybill: ["deal_stage_changed"],
  contract: ["deal_stage_changed"],
  order_internal: [],       // приказы из лога не восстановимы — только have/missing
  explanatory: [],          // пояснительная пишется, не восстанавливается
  other: [],
};

/** Событие попадает в период и относится к контрагенту пункта? */
function eventMatchesItem(e: BusinessEvent, item: RequestItem): boolean {
  const d = "valueDate" in e ? e.valueDate : e.ts.slice(0, 10);
  if (item.periodFrom !== null && d < item.periodFrom) return false;
  if (item.periodTo !== null && d > item.periodTo) return false;
  if (item.counterpartyInn !== null) {
    const inn = "counterpartyInn" in e ? e.counterpartyInn : null;
    if (inn !== item.counterpartyInn) return false;
  }
  return true;
}

function availabilityFor(
  hasFile: boolean,
  evidence: ReadonlyArray<string>,
  kind: PrimaryDocKind,
): DocAvailability {
  if (hasFile) return "have_file";
  // Восстановление возможно только при доказательной базе в логе
  // и только для типов, где операция порождает документ детерминированно.
  if (evidence.length > 0 && EVIDENCE_MAP[kind].length > 0) return "restorable";
  return "missing_no_event";
}

export type UploadedDocIndex = ReadonlyMap<string, string>;
// ключ: `${kind}:${counterpartyInn ?? "any"}:${isoDate}` → fileRef
// строит адаптер по метаданным загруженных клиентом файлов

/**
 * Главная функция: пункт запроса → строки чек-листа.
 * Одна операция из лога = одна строка на каждый требуемый docKind.
 */
export function buildChecklist(
  items: ReadonlyArray<RequestItem>,
  events: ReadonlyArray<BusinessEvent>,
  uploaded: UploadedDocIndex,
  makeId: () => string,          // uuid снаружи — детерминизм в тестах
): MatchResult<ChecklistEntry[]> {
  if (items.length === 0) {
    return { ok: false, error: { code: "empty_request", detail: "нет пунктов" } };
  }
  const entries: ChecklistEntry[] = [];

  for (const item of items) {
    if (
      item.periodFrom !== null &&
      item.periodTo !== null &&
      item.periodFrom > item.periodTo
    ) {
      return {
        ok: false,
        error: { code: "invalid_period", detail: item.rawText },
      };
    }

    const matched = events.filter((e) => eventMatchesItem(e, item));

    for (const kind of item.docKinds) {
      if (matched.length === 0) {
        // Операций нет вообще → одна строка «отсутствует»,
        // клиент сможет вручную перевести в have_paper галочкой.
        entries.push(makeEntry(makeId(), item, kind, null, [], "missing_no_event"));
        continue;
      }
      for (const e of matched) {
        const allowed = EVIDENCE_MAP[kind];
        const isEvidence = allowed.includes(e.type);
        const evidence = isEvidence ? [e.eventId] : [];
        const date = "valueDate" in e ? e.valueDate : e.ts.slice(0, 10);
        const inn = "counterpartyInn" in e ? (e.counterpartyInn ?? "any") : "any";
        const fileRef = uploaded.get(`${kind}:${inn}:${date}`) ?? null;
        entries.push(
          makeEntry(
            makeId(), item, kind, fileRef, evidence,
            availabilityFor(fileRef !== null, evidence, kind),
          ),
        );
      }
    }
  }
  return { ok: true, value: dedupe(entries) };
}

function makeEntry(
  entryId: string,
  item: RequestItem,
  docKind: PrimaryDocKind,
  fileRef: string | null,
  evidence: string[],
  availability: DocAvailability,
): ChecklistEntry {
  return {
    entryId,
    requestItemId: item.itemId,
    docKind,
    label: buildLabel(docKind, item),
    availability,
    fileRef,
    evidence,
    confirmedByOwner: false,
  };
}

function buildLabel(kind: PrimaryDocKind, item: RequestItem): string {
  const period =
    item.periodFrom !== null && item.periodTo !== null
      ? `${item.periodFrom} — ${item.periodTo}`
      : "весь период";
  const cp = item.counterpartyName ?? "все контрагенты";
  return `${RU_KIND[kind]} · ${cp} · ${period}`;
}

const RU_KIND: Record<PrimaryDocKind, string> = {
  payment_order: "Платёжное поручение",
  bank_statement: "Выписка по счёту",
  account_card: "Карточка счёта",
  contract: "Договор",
  act: "Акт",
  waybill: "Накладная",
  invoice: "Счёт",
  invoice_facture: "Счёт-фактура",
  order_internal: "Приказ",
  explanatory: "Пояснительная записка",
  other: "Прочее",
};

/** Схлопывает дубли: один docKind × одно событие-основание. */
function dedupe(entries: ChecklistEntry[]): ChecklistEntry[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    const key = `${e.requestItemId}:${e.docKind}:${e.evidence[0] ?? "none"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Готовность пакета: доля строк, закрытых файлом/дубликатом/объяснением. */
export function caseCompleteness(entries: ReadonlyArray<ChecklistEntry>): number {
  if (entries.length === 0) return 0;
  const closed = entries.filter(
    (e) =>
      e.availability === "have_file" ||
      e.availability === "not_applicable" ||
      (e.availability === "restorable" && e.confirmedByOwner) ||
      (e.availability === "missing_no_event" && e.confirmedByOwner),
  ).length;
  return closed / entries.length;
}
