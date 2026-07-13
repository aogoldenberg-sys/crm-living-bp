import { z } from "zod";
import { IsoDate, IsoDateTime, Kopecks } from "./money.js";

export const ScenarioResult = z.object({
  scenarioId: z.string().uuid(),
  runId: z.string().uuid(),
  levers: z.array(z.string().min(1)),
  projectedForecast: z.object({
    gapDate: IsoDate.nullable(),
    gapAmount: Kopecks.nullable(),
    confidence: z.number().min(0).max(1),
  }).strict(),
  gapAvoidedProbability: z.number().min(0).max(1),
  impactOnGoal: z.number(),
  complexity: z.enum(["low", "medium", "high"]),
  drivers: z.array(z.string().min(1)).max(3),
}).strict();

export type ScenarioResult = z.infer<typeof ScenarioResult>;

export const PlanDiff = z.object({
  field: z.string().min(1),
  before: z.string(),
  after: z.string(),
  humanReadable: z.string(),
}).strict();

export type PlanDiff = z.infer<typeof PlanDiff>;

export const ScenarioDecision = z.object({
  scenarioId: z.string().uuid(),
  runId: z.string().uuid(),
  decidedBy: z.string().min(1),
  decidedAt: IsoDateTime,
  accepted: z.boolean(),
  newPlanId: z.string().nullable(),
}).strict();

export type ScenarioDecision = z.infer<typeof ScenarioDecision>;
