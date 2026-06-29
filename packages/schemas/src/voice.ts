import { z } from "zod";

export const VoiceIntentType = z.enum([
  "update_deal",
  "add_expense",
  "market_insight",
  "adjust_plan",
]);
export type VoiceIntentType = z.infer<typeof VoiceIntentType>;

// Diff per intent — keep it typed and specific
export const UpdateDealDiff = z.object({
  dealId: z.string(),
  amount: z.number().positive().optional(),
  paymentDelay: z.number().int().nonnegative().optional(),
  stage: z.string().optional(),
}).strict();

export const AddExpenseDiff = z.object({
  category: z.string().min(1),
  amount: z.number().positive(),
  date: z.string().optional(), // ISO date
  description: z.string().optional(),
}).strict();

export const MarketInsightDiff = z.object({
  text: z.string().min(1),
  source: z.string().optional(),
  sector: z.string().optional(),
}).strict();

export const AdjustPlanDiff = z.object({
  milestoneId: z.string().optional(),
  description: z.string().min(1),
  targetDate: z.string().optional(), // ISO date
}).strict();

export const IntentDiff = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("update_deal"), diff: UpdateDealDiff }).strict(),
  z.object({ intent: z.literal("add_expense"), diff: AddExpenseDiff }).strict(),
  z.object({ intent: z.literal("market_insight"), diff: MarketInsightDiff }).strict(),
  z.object({ intent: z.literal("adjust_plan"), diff: AdjustPlanDiff }).strict(),
]);
export type IntentDiff = z.infer<typeof IntentDiff>;

export const VoiceExtractResult = z.object({
  intent: VoiceIntentType,
  diff: z.union([UpdateDealDiff, AddExpenseDiff, MarketInsightDiff, AdjustPlanDiff]),
  confidence: z.number().min(0).max(1),
  needsClarification: z.boolean(),
  clarificationQuestion: z.string().optional(), // set when needsClarification=true
  rawTranscript: z.string(),
}).strict();
export type VoiceExtractResult = z.infer<typeof VoiceExtractResult>;
