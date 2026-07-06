import type { KndPayment, KndUsnIncome } from "@crm/schemas";

/**
 * XSD-валидатор без libxml2.
 * Полная валидация по XSD требует нативных биндингов,
 * поэтому проверяем структурно: обязательные поля + паттерны.
 */

export type XsdRule = {
  field: string;
  required: boolean;
  pattern?: RegExp;
  description: string;
};

export type XsdViolation = {
  field: string;
  description: string;
  reason: "missing" | "pattern_mismatch";
  value?: string;
};

/** Результат валидации: ok=true или массив всех нарушений сразу. */
export type XsdResult =
  | { ok: true }
  | { ok: false; violations: XsdViolation[] };

export const KND_RULES: Record<string, XsdRule[]> = {
  "1152017": [
    { field: "КНД",       required: true,  pattern: /^\d{7}$/,          description: "Код КНД" },
    { field: "ДатаДок",   required: true,  pattern: /^\d{4}-\d{2}-\d{2}$/, description: "Дата документа" },
    { field: "ИННЮЛ",     required: false, pattern: /^\d{10}$/,         description: "ИНН организации" },
    { field: "ДохНалПер", required: true,                               description: "Доходы за налоговый период" },
    { field: "СумНал",    required: true,                               description: "Сумма налога" },
  ],
  "1151078": [
    { field: "КНД",     required: true,  pattern: /^\d{7}$/,            description: "Код КНД" },
    { field: "ДатаДок", required: true,  pattern: /^\d{4}-\d{2}-\d{2}$/, description: "Дата документа" },
    { field: "ИННФЛ",   required: true,  pattern: /^\d{12}$/,           description: "ИНН физлица" },
    { field: "ГодД",    required: true,  pattern: /^\d{4}$/,            description: "Год справки" },
    { field: "СуммДох", required: true,                                 description: "Сумма дохода" },
  ],
  "1161101": [
    { field: "КНД",      required: true,  pattern: /^\d{7}$/,           description: "Код КНД" },
    { field: "ДатаДок",  required: true,  pattern: /^\d{4}-\d{2}-\d{2}$/, description: "Дата документа" },
    { field: "НомерДок", required: true,                                description: "Номер платёжного поручения" },
    { field: "Сумма",    required: true,                                description: "Сумма платежа" },
    { field: "ИННПлат",  required: true,  pattern: /^\d{10,12}$/,       description: "ИНН плательщика" },
    { field: "ИННПолуч", required: true,  pattern: /^\d{10,12}$/,       description: "ИНН получателя" },
  ],
};

/**
 * Валидирует поля КНД-документа по встроенным правилам.
 * fields — уже распарсенные строковые значения из parser.ts.
 * Числовые поля (суммы) передаются строкой или числом — конвертируем toString().
 */
export function validateKndXml(
  fields: Record<string, string | number | undefined>,
  knd: string,
): XsdResult {
  const rules = KND_RULES[knd];
  if (!rules) return { ok: false, violations: [{ field: "КНД", description: "Код КНД", reason: "missing" }] };

  const violations: XsdViolation[] = [];

  for (const rule of rules) {
    const raw = fields[rule.field];
    const value = raw !== undefined && raw !== null ? String(raw) : undefined;

    if (value === undefined || value === "") {
      if (rule.required) {
        violations.push({ field: rule.field, description: rule.description, reason: "missing" });
      }
      continue;
    }

    if (rule.pattern && !rule.pattern.test(value)) {
      violations.push({ field: rule.field, description: rule.description, reason: "pattern_mismatch", value });
    }
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

// Re-export типов из schemas для удобства использователей модуля
export type { KndPayment, KndUsnIncome };
