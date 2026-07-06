import { z } from "zod";
import { AssumptionSet } from "./assumptions.js";

/**
 * Один из 22 разделов плана, найденный в документе.
 */
export const MappedSection = z
  .object({
    sectionId: z.string(),
    present: z.boolean(),
    contentSummary: z.string(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type MappedSection = z.infer<typeof MappedSection>;

/**
 * Сила плана — позитивный момент с привязкой к разделу.
 */
export const Strength = z
  .object({
    point: z.string(),
    sectionRef: z.string(),
    evidence: z.string(),
  })
  .strict();

export type Strength = z.infer<typeof Strength>;

/**
 * Опасение — проблемный момент с уровнем серьёзности.
 */
export const Concern = z
  .object({
    point: z.string(),
    severity: z.enum(["red", "yellow"]),
    sectionRef: z.string(),
    rationale: z.string(),
  })
  .strict();

export type Concern = z.infer<typeof Concern>;

/**
 * Пробел — отсутствующий раздел с пояснением важности.
 */
export const Gap = z
  .object({
    missingSection: z.string(),
    whyMatters: z.string(),
  })
  .strict();

export type Gap = z.infer<typeof Gap>;

/**
 * Элемент верифицируемости предположения.
 */
export const VerifiabilityItem = z
  .object({
    assumption: z.string(),
    howValidated: z.string(),
    dataSourceNeeded: z.string(),
  })
  .strict();

export type VerifiabilityItem = z.infer<typeof VerifiabilityItem>;

/**
 * Оценка плана: сильные стороны, опасения, пробелы, предположения, верифицируемость.
 * В срезе 1 strengths/concerns/verifiability — пустые массивы; наполняет Claude в срезе 2.
 */
export const Assessment = z
  .object({
    strengths: z.array(Strength),
    concerns: z.array(Concern),
    gaps: z.array(Gap),
    assumptionsExtracted: AssumptionSet,
    verifiability: z.array(VerifiabilityItem),
  })
  .strict();

export type Assessment = z.infer<typeof Assessment>;

/**
 * Полный результат intake-анализа бизнес-плана.
 */
export const PlanIntake = z
  .object({
    intakeId: z.string().uuid(),
    businessId: z.string(),
    extractedAt: z.string().datetime(),
    mappedSections: z.array(MappedSection),
    assessment: Assessment,
    confidence: z.number().min(0).max(1),
    disclaimer: z.string(),
    status: z.enum(["draft", "accepted_as_v1"]),
    /** Режим ревизии. Default "document" для обратной совместимости. */
    mode: z.enum(["document", "reverse", "hybrid"]).default("document"),
  })
  .strict();

export type PlanIntake = z.infer<typeof PlanIntake>;
