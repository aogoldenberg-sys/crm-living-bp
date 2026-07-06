import { z } from "zod";
import { IsoDate, IsoDateTime, Kopecks, Inn } from "./money.js";

/**
 * Модуль ответов на запросы контролирующих органов и комплаенс банка.
 *
 * ЮРИДИЧЕСКАЯ РАМКА (нарушение = провал ревью):
 * 1. Система НИКОГДА не создаёт документы по операциям,
 *    которых нет в event-логе. Нет события — нет документа.
 * 2. Восстановление = проект ДУБЛИКАТА реально существовавшей
 *    операции, статус "draft", подписывает человек.
 * 3. Весь пакет — A3: система готовит, человек утверждает.
 * 4. Полный trail: запрос → сопоставление → основание → документ.
 */

/** Кто запрашивает. Определяет шаблон мотивированного ответа и сроки. */
export const RequestingAuthority = z.enum([
  "fns_kameral",        // камеральная проверка ФНС
  "fns_vyezd",          // выездная проверка ФНС
  "fns_vstrechka",      // встречная проверка (ст. 93.1 НК)
  "police",             // запрос МВД/полиции
  "prosecutor",         // прокуратура
  "bank_compliance",    // 115-ФЗ, комплаенс банка
  "court",              // судебный запрос
  "audit_internal",     // подготовка к аудиту (внутренний режим)
  "counterparty",       // запрос контрагента (сверка)
  "other",
]);
export type RequestingAuthority = z.infer<typeof RequestingAuthority>;

/** Типы первичных документов, которые система умеет сопоставлять. */
export const PrimaryDocKind = z.enum([
  "payment_order",      // платёжное поручение
  "bank_statement",     // выписка по счёту
  "account_card",       // карточка счёта (ОСВ по счёту)
  "contract",           // договор
  "act",                // акт выполненных работ/услуг
  "waybill",            // товарная накладная (ТОРГ-12)
  "invoice",            // счёт на оплату
  "invoice_facture",    // счёт-фактура / УПД
  "order_internal",     // приказ
  "explanatory",        // пояснительная записка
  "other",
]);
export type PrimaryDocKind = z.infer<typeof PrimaryDocKind>;

/**
 * Позиция запроса: один пункт из требования органа.
 * Claude-экстрактор разбирает входящий запрос на такие позиции.
 */
export const RequestItem = z.object({
  itemId: z.string().uuid(),
  /** Дословный текст пункта из запроса — сырьё для трейла. */
  rawText: z.string().min(1),
  docKinds: z.array(PrimaryDocKind).min(1),
  /** Период, за который требуют документы. */
  periodFrom: IsoDate.nullable(),
  periodTo: IsoDate.nullable(),
  /** Контрагент, если запрос точечный (встречка). */
  counterpartyInn: Inn.nullable(),
  counterpartyName: z.string().nullable(),
  /** Уверенность экстрактора в разборе пункта. */
  extractConfidence: z.number().min(0).max(1),
}).strict();
export type RequestItem = z.infer<typeof RequestItem>;

/**
 * Статус наличия документа. Ключевая развилка модуля.
 * ЗАПРЕЩЁН статус "сфабрикован" — его не существует по построению.
 */
export const DocAvailability = z.enum([
  "have_file",          // файл загружен, готов в пакет
  "have_paper",         // есть на бумаге — клиент отметил галочкой, надо отсканировать
  "restorable",         // файла нет, НО есть событие в логе → проект дубликата
  "missing_no_event",   // нет ни файла, ни события → запросить у контрагента
  "not_applicable",     // операция не наша / период мимо
]);
export type DocAvailability = z.infer<typeof DocAvailability>;

/**
 * Одна ячейка чек-листа «отметьте что есть».
 * evidence обязателен для restorable — это и есть защита от фабрикации.
 */
export const ChecklistEntry = z.object({
  entryId: z.string().uuid(),
  requestItemId: z.string().uuid(),
  docKind: PrimaryDocKind,
  /** Человекочитаемое описание: «Акт №14 от 03.02.2026, ООО Ромашка». */
  label: z.string().min(1),
  availability: DocAvailability,
  /** Ссылка на файл, если have_file. */
  fileRef: z.string().nullable(),
  /**
   * События-основания из append-only лога.
   * restorable без непустого evidence — невалидное состояние,
   * проверяется инвариантом в core (schema его описать не может).
   */
  evidence: z.array(z.string().uuid()),
  /** Отметка клиента (галочка в UI). */
  confirmedByOwner: z.boolean(),
}).strict();
export type ChecklistEntry = z.infer<typeof ChecklistEntry>;

/** Проект восстановленного документа. Только draft. Только дубликат. */
export const RestoredDocDraft = z.object({
  draftId: z.string().uuid(),
  entryId: z.string().uuid(),
  docKind: PrimaryDocKind,
  /** Поля документа, выведенные ИЗ СОБЫТИЙ, не придуманные. */
  fields: z.record(z.string(), z.union([z.string(), Kopecks])),
  evidence: z.array(z.string().uuid()).min(1),
  /** Дубликат помечается явно — в самом документе будет гриф. */
  duplicateMark: z.literal(true),
  status: z.enum(["draft", "approved_by_owner", "rejected"]),
  generatedAt: IsoDateTime,
}).strict();
export type RestoredDocDraft = z.infer<typeof RestoredDocDraft>;

/** Мотивированный ответ — сопроводительное письмо к пакету. */
export const MotivatedResponse = z.object({
  responseId: z.string().uuid(),
  authority: RequestingAuthority,
  /** Реквизиты входящего требования. */
  incomingRef: z.object({
    number: z.string().nullable(),
    date: IsoDate.nullable(),
    fileRef: z.string(),
  }).strict(),
  /** Текст письма. Генерирует ai-kit, редактирует человек. */
  letterDraft: z.string().min(1),
  /** Правовые основания, на которые ссылается письмо. */
  legalRefs: z.array(z.string()),
  /** Что предоставляем / что отсутствует и почему. */
  providedEntryIds: z.array(z.string().uuid()),
  missingExplained: z.array(z.object({
    entryId: z.string().uuid(),
    reason: z.string().min(1),
  }).strict()),
  /** Срок ответа по регламенту органа. Дедлайн — в календарь. */
  deadline: IsoDate.nullable(),
  status: z.enum(["draft", "approved", "sent"]),
}).strict();
export type MotivatedResponse = z.infer<typeof MotivatedResponse>;

/** Корневой документ кейса. Один входящий запрос = один кейс. */
export const ComplianceCase = z.object({
  caseId: z.string().uuid(),
  businessId: z.string(),               // назначается сервером, как везде
  authority: RequestingAuthority,
  createdAt: IsoDateTime,
  sourceFileRef: z.string(),            // скан/PDF входящего требования
  items: z.array(RequestItem),
  checklist: z.array(ChecklistEntry),
  drafts: z.array(RestoredDocDraft),
  response: MotivatedResponse.nullable(),
  /** Готовность пакета: считается в core, не руками. */
  completeness: z.number().min(0).max(1),
  status: z.enum([
    "extracting",       // Claude разбирает запрос
    "checklist_review", // клиент ставит галочки
    "assembling",       // сборка пакета + дубликаты
    "response_draft",   // письмо готово, ждёт утверждения
    "done",
  ]),
}).strict();
export type ComplianceCase = z.infer<typeof ComplianceCase>;
