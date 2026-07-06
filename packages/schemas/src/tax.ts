import { z } from "zod";
import { Kopecks, IsoDate, IsoDateTime, Inn } from "./money.js";

/**
 * Налоговый блок. Все декларации — только draft.
 * Подписывает и отправляет человек (A3).
 * Расчёт ТОЛЬКО из событий лога. Нет данных — insufficient_data.
 */

export const TaxRegime = z.enum([
  "usn6",        // УСН доходы
  "usn15",       // УСН доходы-расходы
  "patent",      // ПСН
  "osno_zero",   // ОСНО нулевая отчётность
  "npd",         // самозанятость (справочно)
]);
export type TaxRegime = z.infer<typeof TaxRegime>;

export const TaxPeriod = z.object({
  year: z.number().int().min(2020).max(2035),
  quarter: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).nullable(),
  // null = годовой период
}).strict();
export type TaxPeriod = z.infer<typeof TaxPeriod>;

export const LegalForm = z.enum(["ip", "ooo"]);
export type LegalForm = z.infer<typeof LegalForm>;

/** Профиль налогоплательщика. Режим подтверждает клиент — из ЕГРЮЛ не виден. */
export const TaxProfile = z.object({
  inn: Inn,
  kpp: z.string().regex(/^\d{9}$/).nullable(),   // null для ИП
  legalForm: LegalForm,
  regime: TaxRegime,
  regimeConfirmedByOwner: z.boolean(),
  oktmo: z.string().regex(/^\d{8}$|^\d{11}$/),
  taxRatePct: z.number().min(0).max(20),          // региональные ставки УСН
  employees: z.boolean(),                          // влияет на вычет взносов
}).strict();
export type TaxProfile = z.infer<typeof TaxProfile>;

/**
 * Строка КУДиР. Порождается ТОЛЬКО из события лога.
 * eventId обязателен — это трейл до первички.
 */
export const KudirRow = z.object({
  rowNo: z.number().int().positive(),
  date: IsoDate,
  docRef: z.string(),                 // «п/п №14 от 03.02.2026»
  content: z.string().min(1),         // содержание операции
  income: Kopecks.nullable(),
  expense: Kopecks.nullable(),        // только usn15
  eventId: z.string().uuid(),
}).strict();
export type KudirRow = z.infer<typeof KudirRow>;

export const Kudir = z.object({
  profileInn: Inn,
  period: TaxPeriod,
  rows: z.array(KudirRow),
  totalIncome: Kopecks,
  totalExpense: Kopecks.nullable(),
  generatedAt: IsoDateTime,
  status: z.literal("draft"),
}).strict();
export type Kudir = z.infer<typeof Kudir>;

/** Страховые взносы ИП за себя. Константы года — в core с источником. */
export const InsuranceContribs = z.object({
  year: z.number().int(),
  fixedAmount: Kopecks,               // фикс за год
  overThresholdPct: z.number(),       // 1% свыше порога
  overThresholdBase: Kopecks,         // доход сверх порога
  overThresholdAmount: Kopecks,
  total: Kopecks,
  paidInPeriod: Kopecks,              // из payment_out по назначению
}).strict();
export type InsuranceContribs = z.infer<typeof InsuranceContribs>;

/** Декларация УСН. Суммы авансов по кварталам — нарастающим итогом. */
export const UsnDeclaration = z.object({
  declarationId: z.string().uuid(),
  profileInn: Inn,
  period: TaxPeriod,                  // quarter=null, год
  regime: z.enum(["usn6", "usn15"]),
  incomeByQuarter: z.tuple([Kopecks, Kopecks, Kopecks, Kopecks]), // нарастающим
  expenseByQuarter: z.tuple([Kopecks, Kopecks, Kopecks, Kopecks]).nullable(),
  contribsDeducted: z.tuple([Kopecks, Kopecks, Kopecks, Kopecks]),
  taxByQuarter: z.tuple([Kopecks, Kopecks, Kopecks, Kopecks]),
  minTax: Kopecks.nullable(),          // 1% для usn15
  taxToPay: Kopecks,
  /** Все eventId, вошедшие в расчёт. Полный трейл. */
  evidence: z.array(z.string().uuid()).min(1),
  confidence: z.number().min(0).max(1),
  warnings: z.array(z.string()),       // «разрыв в выписке март», …
  generatedAt: IsoDateTime,
  status: z.enum(["draft", "approved_by_owner"]),
}).strict();
export type UsnDeclaration = z.infer<typeof UsnDeclaration>;

/** Нулевая отчётность — пакет форм без цифр. */
export const ZeroReportKind = z.enum([
  "usn_zero",
  "nds_zero",          // ОСНО
  "profit_zero",       // ОСНО
  "balance_zero",      // бухотчётность ООО
  "rsv_zero",          // расчёт по страховым взносам
  "efs1_zero",
]);
export type ZeroReportKind = z.infer<typeof ZeroReportKind>;

export const ZeroPackage = z.object({
  packageId: z.string().uuid(),
  profileInn: Inn,
  period: TaxPeriod,
  reports: z.array(ZeroReportKind).min(1),
  /** Подтверждение клиента: операций не было. Обязательное. */
  noOperationsConfirmed: z.boolean(),
  /** Система сверила с логом: событий за период нет. */
  logIsEmpty: z.boolean(),
  generatedAt: IsoDateTime,
  status: z.enum(["draft", "approved_by_owner"]),
}).strict();
export type ZeroPackage = z.infer<typeof ZeroPackage>;

/** Патент: налог фиксирован, система считает взносы к вычету и следит за лимитом. */
export const PatentTracking = z.object({
  profileInn: Inn,
  year: z.number().int(),
  patentCostTotal: Kopecks,            // из патента, вводит клиент
  incomeActual: Kopecks,               // из лога — контроль лимита 60 млн
  limitExceeded: z.boolean(),
  contribsDeductible: Kopecks,
  evidence: z.array(z.string().uuid()),
  warnings: z.array(z.string()),
}).strict();
export type PatentTracking = z.infer<typeof PatentTracking>;
