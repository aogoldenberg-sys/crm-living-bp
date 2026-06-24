import type { BusinessEvent } from "@crm/schemas";

export type BusinessStage =
  | "startup"   // план без факта, 0-3 мес истории
  | "growth"    // выручка растёт >10% MoM за 2+ месяца
  | "maturity"  // стабильная выручка, небольшой рост/плоская
  | "decline";  // выручка падает >10% MoM за 2+ месяца

export interface LifecycleInput {
  /** Business events (payments, deals). May be empty. */
  events: BusinessEvent[];
  /** True if a business plan document has been uploaded */
  hasPlan: boolean;
  /** ISO date string — "current" reference date for computing age */
  referenceDate: string;
}

export interface StagePriority {
  id: string;
  label: string;
  description: string;
}

export interface LifecycleResult {
  stage: BusinessStage;
  /** Human-readable label in Russian */
  label: string;
  /** Why this stage was determined */
  rationale: string;
  /** Relevant priorities for this stage */
  priorities: StagePriority[];
  /** Months of event history (0 if no events) */
  historyMonths: number;
}
