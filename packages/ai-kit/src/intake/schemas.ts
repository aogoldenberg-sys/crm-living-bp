import { z } from "zod";
import { AssumptionSet, Strength, Concern, VerifiabilityItem } from "@crm/schemas";

export const ExtractedPlanSchema = z
  .object({
    businessId: z.string().min(1),
    rawSections: z.record(
      z.object({
        text: z.string(),
        confidence: z.number().min(0).max(1),
      }),
    ),
    assumptions: AssumptionSet,
  })
  .strict();

export type ExtractedPlanSchema = z.infer<typeof ExtractedPlanSchema>;

export const AssessmentOutputSchema = z
  .object({
    strengths: z.array(Strength),
    concerns: z.array(Concern),
    verifiability: z.array(VerifiabilityItem),
  })
  .strict();

export type AssessmentOutputSchema = z.infer<typeof AssessmentOutputSchema>;
