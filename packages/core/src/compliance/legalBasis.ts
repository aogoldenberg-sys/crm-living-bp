import type { RequestingAuthority } from "@crm/schemas";

type LegalBasisEntry = {
  norms: string[];
  deadlineDays: number | null;
  liability: string | null;
};

/**
 * Справочник правовых оснований по типу органа.
 * Record гарантирует: пропуск ключа = ошибка компиляции.
 */
export const LEGAL_BASIS: Record<RequestingAuthority, LegalBasisEntry> = {
  fns_kameral: {
    norms: ["ст. 88 НК РФ", "ст. 93 НК РФ"],
    deadlineDays: 10,
    liability: null,
  },
  fns_vyezd: {
    norms: ["ст. 89 НК РФ", "ст. 93 НК РФ"],
    deadlineDays: null,
    liability: null,
  },
  fns_vstrechka: {
    norms: ["ст. 93.1 НК РФ"],
    deadlineDays: 5,
    liability: null,
  },
  police: {
    norms: ["ст. 13 ФЗ «О полиции»"],
    deadlineDays: null,
    liability: null,
  },
  prosecutor: {
    norms: ["ст. 6 ФЗ от 17.01.1992 № 2202-1", "ст. 22 ФЗ от 17.01.1992 № 2202-1"],
    deadlineDays: null,
    liability: "ст. 17.7 КоАП РФ",
  },
  bank_compliance: {
    norms: ["115-ФЗ"],
    deadlineDays: null,
    liability: null,
  },
  court: {
    norms: ["ст. 57 ГПК РФ", "ст. 66 АПК РФ"],
    deadlineDays: null,
    liability: null,
  },
  labor_inspection: {
    norms: ["ст. 357 ТК РФ"],
    deadlineDays: null,
    liability: null,
  },
  audit_internal: {
    norms: [],
    deadlineDays: null,
    liability: null,
  },
  counterparty: {
    norms: [],
    deadlineDays: null,
    liability: null,
  },
  other: {
    norms: [],
    deadlineDays: null,
    liability: null,
  },
};
