import { z } from "zod";
import { AssumptionSet } from "./assumptions.js";

/**
 * Бизнес-план версии 1 — создаётся явным действием человека через acceptIntake.
 *
 * parentVersion: всегда null для v1; v2+ — отдельный механизм (§5.3).
 * sourceIntakeId: трассировка — из какого intake создан.
 * assumptions: скопированы из intake.assessment.assumptionsExtracted.
 */
export const BusinessPlanV1 = z
  .object({
    planId: z.string().uuid(),
    businessId: z.string().min(1),
    version: z.literal(1),
    status: z.enum(["active", "archived"]),
    parentVersion: z.null(),
    sourceIntakeId: z.string().uuid(),
    createdAt: z.string().datetime(),
    assumptions: AssumptionSet,
  })
  .strict();

export type BusinessPlanV1 = z.infer<typeof BusinessPlanV1>;
