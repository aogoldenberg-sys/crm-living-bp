import type { AssumptionSet } from "@crm/schemas";
import type { ExtractedPlan } from "./types.js";

/**
 * Извлекает предположения из сырого плана.
 * assumptions уже является AssumptionSet — возвращаем напрямую.
 */
export function extractAssumptions(extracted: ExtractedPlan): AssumptionSet {
  return extracted.assumptions;
}
