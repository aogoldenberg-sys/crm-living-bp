import type { DocMappedSection, SourceDocKind } from "@crm/schemas";

export type Gap = {
  sectionId: string;
  canInfer: boolean;
  requiredDocKind: SourceDocKind | null;
  whereToGet: string;
};

// Разделы, выводимые из финансовых данных без доп. документов
const CAN_INFER = new Set([
  "finances",
  "unit_economics",
  "kpi_metrics",
  "risks",
  "executive_summary",
]);

const REQUIRED_DOC: Partial<Record<string, { kind: SourceDocKind; where: string }>> = {
  team: { kind: "staff_schedule", where: "Кадровый отдел / 1С ЗУП — штатное расписание" },
  operations: { kind: "doc_registry", where: "Реестр договоров с поставщиками" },
  legal: { kind: "doc_registry", where: "Учредительные документы / лицензии" },
  funding_ask: { kind: "fin_report", where: "Бухгалтерская отчётность (баланс + форма 2)" },
  pricing: { kind: "cash_report", where: "Кассовые отчёты / прайс-лист" },
};

const ALL_22_SECTIONS = [
  "executive_summary", "problem", "solution", "market_size", "target_audience",
  "value_proposition", "competitors", "business_model", "pricing", "product_roadmap",
  "go_to_market", "sales_channels", "marketing_strategy", "team", "operations",
  "finances", "unit_economics", "risks", "legal", "kpi_metrics", "funding_ask", "exit_strategy",
];

export function deriveGaps(mappedSections: DocMappedSection[]): Gap[] {
  const covered = new Set(mappedSections.map(s => s.sectionId));
  const gaps: Gap[] = [];

  for (const sectionId of ALL_22_SECTIONS) {
    if (covered.has(sectionId)) continue;

    const canInfer = CAN_INFER.has(sectionId);
    const req = REQUIRED_DOC[sectionId];

    gaps.push({
      sectionId,
      canInfer,
      requiredDocKind: req?.kind ?? null,
      whereToGet: req?.where ?? (canInfer
        ? "Будет выведено из имеющихся данных"
        : "Уточните у специалиста"),
    });
  }

  return gaps;
}
