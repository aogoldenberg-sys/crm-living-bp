import type { SourceDocKind, DocMappedSection } from "@crm/schemas";

// 22 раздела книги → ключевые слова
const SECTION_KEYWORDS: Record<string, string[]> = {
  executive_summary: ["резюме", "введение", "краткое описание", "цель проекта", "суть"],
  problem: ["проблема", "боль", "задача"],
  solution: ["решение", "продукт", "сервис", "услуга"],
  market_size: ["рынок", "объём", "tam", "sam", "som", "сегмент"],
  target_audience: ["аудитория", "целевой", "клиент", "потребитель"],
  value_proposition: ["ценность", "преимущество", "уникальность", "usp"],
  competitors: ["конкурент", "сравнение рынка"],
  business_model: ["бизнес-модель", "монетизация", "revenue model"],
  pricing: ["цена", "тариф", "прайс", "стоимость услуг"],
  product_roadmap: ["дорожная карта", "roadmap", "план развития", "этапы"],
  go_to_market: ["выход на рынок", "запуск", "gtm"],
  sales_channels: ["канал продаж", "сбыт", "дистрибуция"],
  marketing_strategy: ["маркетинг", "реклама", "продвижение", "smm"],
  team: ["команда", "сотрудник", "директор", "штат", "персонал"],
  operations: ["операции", "процесс", "ресурс", "поставщик", "инфраструктура"],
  finances: ["финанс", "выручка", "прибыль", "бюджет", "доход", "расход", "оборот", "баланс", "выписка", "касса"],
  unit_economics: ["unit economics", "юнит", "cac", "маржинальность", "ltv"],
  risks: ["риск", "угроза", "pest", "swot", "уязвимость"],
  legal: ["правовой", "лицензия", "нпа", "регуляторный", "устав"],
  kpi_metrics: ["kpi", "метрика", "показатель", "okr"],
  funding_ask: ["инвестиц", "финансирование", "грант", "субсидия", "займ"],
  exit_strategy: ["выход", "продажа бизнеса", "заключение", "итог"],
};

// Приоритет по виду документа (если страница неоднозначна)
const KIND_BIAS: Partial<Record<SourceDocKind, string>> = {
  bank_statement: "finances",
  cash_report: "finances",
  fin_report: "finances",
  staff_schedule: "team",
  turnover_sheet: "finances",
  fixed_asset_card: "finances",
  authority_request: "legal",
};

function scorePageForSection(text: string, sectionId: string): number {
  const lower = text.toLowerCase();
  const keywords = SECTION_KEYWORDS[sectionId] ?? [];
  return keywords.filter(kw => lower.includes(kw)).length;
}

export function classifyPage(
  pageText: string,
  pageNum: number,
  docKind: SourceDocKind,
): DocMappedSection | null {
  const biasSection = KIND_BIAS[docKind];
  if (biasSection) {
    const biasScore = scorePageForSection(pageText, biasSection);
    if (biasScore > 0 || pageText.length > 50) {
      return { sectionId: biasSection, pageRange: [pageNum, pageNum], confidence: 0.8 };
    }
  }

  let best: string | null = null;
  let bestScore = 0;
  for (const sectionId of Object.keys(SECTION_KEYWORDS)) {
    const score = scorePageForSection(pageText, sectionId);
    if (score > bestScore) { bestScore = score; best = sectionId; }
  }
  if (!best || bestScore < 1) return null;
  return {
    sectionId: best,
    pageRange: [pageNum, pageNum],
    confidence: Math.min(0.95, 0.5 + bestScore * 0.1),
  };
}

export function classifyDocument(
  docKind: SourceDocKind,
  pagesText: string[],
): DocMappedSection[] {
  const result: DocMappedSection[] = [];
  for (let i = 0; i < pagesText.length; i++) {
    const mapped = classifyPage(pagesText[i] ?? "", i + 1, docKind);
    if (mapped) result.push(mapped);
  }
  return result;
}
