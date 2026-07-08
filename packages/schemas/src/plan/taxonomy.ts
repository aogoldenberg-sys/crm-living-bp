/**
 * Единая таксономия разделов бизнес-плана.
 *
 * intake-ID = ключи REQUIRED_SECTIONS (packages/core/src/intake/sections.ts)
 * book-ID   = ключи SECTIONS (apps/web/src/plan/PlanSectionPage.tsx)
 *
 * Воркер сохраняет mappedSections под book-ID.
 * При коллизиях (несколько intake-ID → один book-ID) контент мёржится.
 */
export const INTAKE_TO_BOOK_ID: Record<string, string> = {
  executive_summary:  "mission",
  problem:            "priorities",
  solution:           "product",
  market_size:        "markets",
  target_audience:    "markets",       // мёрж с market_size
  value_proposition:  "advantages",
  competitors:        "competitors",
  business_model:     "contents",
  pricing:            "payments",
  product_roadmap:    "roadmap",
  go_to_market:       "marketing",
  sales_channels:     "marketing",     // мёрж с go_to_market
  marketing_strategy: "marketing",     // мёрж с go_to_market
  team:               "team",
  operations:         "resources",
  finances:           "finance",
  unit_economics:     "forecast",
  risks:              "risks",
  legal:              "appendix",
  kpi_metrics:        "kpi",
  funding_ask:        "investment",
  exit_strategy:      "conclusion",
};

/**
 * Обратный маппинг: book-ID → набор intake-ID (один-ко-многим).
 * Используется для поиска в обоих направлениях.
 */
export const BOOK_TO_INTAKE_IDS: Record<string, string[]> = Object.entries(
  INTAKE_TO_BOOK_ID,
).reduce<Record<string, string[]>>((acc, [intakeId, bookId]) => {
  (acc[bookId] ??= []).push(intakeId);
  return acc;
}, {});

/**
 * Все 22 book-ID в порядке отображения.
 */
export const BOOK_SECTION_IDS = [
  "mission", "goals", "priorities", "contents", "product",
  "markets", "marketing", "resources", "finance", "forecast",
  "payments", "pest", "competitors", "advantages", "structure",
  "team", "risks", "roadmap", "kpi", "investment", "conclusion", "appendix",
] as const;

export type BookSectionId = typeof BOOK_SECTION_IDS[number];

/**
 * Алиасы: book-разделы без собственного intake-ID показывают
 * контент другого book-раздела.
 *
 * goals/contents — показывают mission (executive_summary)
 * structure      — показывает team
 * pest           — показывает risks
 */
export const BOOK_SECTION_ALIAS: Record<string, string> = {
  goals:     "mission",
  contents:  "mission",
  structure: "team",
  pest:      "risks",
};
