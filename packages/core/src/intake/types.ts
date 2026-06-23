import type { AssumptionSet } from "@crm/schemas";

/**
 * Сырая структура после парсинга документа (до маппинга на секции).
 * Ключи rawSections — произвольные названия секций из документа.
 */
export interface ExtractedPlan {
  businessId: string;
  rawSections: Record<string, { text: string; confidence: number }>;
  assumptions: AssumptionSet;
}
