/**
 * Rule-based маппинг текста страницы → section ID без Claude.
 *
 * Логика: для каждой страницы проверяем наличие ключевых слов.
 * Возвращаем sectionId с максимальным количеством совпадений.
 * Если совпадений нет — возвращаем null (Claude заполнит).
 */

const SECTION_KEYWORDS: Record<string, string[]> = {
  executive_summary: ["резюме", "summary", "обзор", "введение", "краткое", "цель проекта"],
  problem: ["проблема", "боль", "задача", "challenge", "pain"],
  solution: ["решение", "продукт", "сервис", "услуга", "solution", "product"],
  market_size: ["рынок", "объём", "tam", "sam", "som", "market", "сегмент"],
  target_audience: ["аудитория", "целевой", "клиент", "потребитель", "customer"],
  value_proposition: ["ценность", "преимущество", "уникальность", "usp", "value"],
  competitors: ["конкурент", "competitor", "сравнение", "рынок услуг"],
  business_model: ["модель", "монетизация", "revenue model", "бизнес-модель"],
  pricing: ["цена", "тариф", "прайс", "price", "стоимость услуг"],
  product_roadmap: ["дорожная карта", "roadmap", "план развития", "этапы"],
  go_to_market: ["выход на рынок", "gtm", "go-to-market", "запуск"],
  sales_channels: ["канал продаж", "сбыт", "дистрибуция", "sales channel"],
  marketing_strategy: ["маркетинг", "реклама", "продвижение", "marketing", "smm"],
  team: ["команда", "team", "сотрудник", "генеральный", "директор", "опыт команды"],
  operations: ["операции", "процесс", "ресурс", "infrastructure", "поставщик"],
  finances: ["финанс", "выручка", "прибыль", "p&l", "бюджет", "доход", "расход", "бухгалтер"],
  unit_economics: ["unit economics", "юнит", "ltr", "cac", "маржинальность"],
  risks: ["риск", "risk", "угроза", "pest", "swot"],
  legal: ["правовой", "legal", "лицензия", "нпа", "регуляторный"],
  kpi_metrics: ["kpi", "метрика", "показатель", "okr", "цель"],
  funding_ask: ["инвестиц", "финансирование", "грант", "субсидия", "funding"],
  exit_strategy: ["выход", "exit", "заключение", "итог", "вывод"],
};

export function mapPageToSection(pageText: string): string | null {
  const lower = pageText.toLowerCase();
  let best: string | null = null;
  let bestScore = 0;
  for (const [sectionId, keywords] of Object.entries(SECTION_KEYWORDS)) {
    const score = keywords.filter(kw => lower.includes(kw)).length;
    if (score > bestScore) { bestScore = score; best = sectionId; }
  }
  // Минимум 2 ключевых слова для уверенности
  return bestScore >= 2 ? best : null;
}

export function mapDocumentToSections(
  pages: Array<{ pageNum: number; text: string }>,
): Map<string, { pages: number[]; text: string; confidence: number }> {
  const result = new Map<string, { pages: number[]; text: string; confidence: number }>();

  for (const { pageNum, text } of pages) {
    const sectionId = mapPageToSection(text);
    if (!sectionId) continue;

    if (!result.has(sectionId)) {
      result.set(sectionId, { pages: [], text: "", confidence: 0.7 });
    }
    const entry = result.get(sectionId)!;
    entry.pages.push(pageNum);
    entry.text += (entry.text ? "\n\n" : "") + text;
    // confidence растёт если несколько страниц подтверждают раздел
    entry.confidence = Math.min(0.95, 0.7 + entry.pages.length * 0.05);
  }

  return result;
}
