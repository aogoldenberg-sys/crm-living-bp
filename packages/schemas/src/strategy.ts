import { z } from "zod";

/** A business lever that can be pulled within this strategy */
export const StrategyLever = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string(),
  /** Causal node IDs this lever affects (refs to causal graph) */
  causal_node_ids: z.array(z.string()),
}).strict();

/** Condition that indicates the strategy is succeeding */
export const WinCondition = z.object({
  id: z.string().min(1),
  description: z.string(),
  /** Simple metric check: metric name + threshold (e.g. "ltvCacRatio >= 3") */
  metric_check: z.string().optional(),
}).strict();

/** Pattern that indicates the strategy is failing */
export const FailurePattern = z.object({
  id: z.string().min(1),
  description: z.string(),
  /** Warning signal to watch for */
  warning_signal: z.string().optional(),
}).strict();

/** A complete strategy definition */
export const Strategy = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  /** Niche tags — used for matching to business type */
  niche_tags: z.array(z.string()),
  /** Reference to causal graph template id */
  causal_template: z.string().optional(),
  levers: z.array(StrategyLever),
  win_conditions: z.array(WinCondition),
  failure_patterns: z.array(FailurePattern),
}).strict();

/** A selected strategy result with rationale */
export const SelectedStrategy = z.object({
  strategy: Strategy,
  /** Why this strategy was selected */
  rationale: z.string(),
  /** Score 0..1 — how well it fits */
  fitScore: z.number().min(0).max(1),
  /** IMPORTANT: always "initial" — this is a starting point, not a proven strategy */
  confidence: z.literal("initial"),
  /** Human-readable note to show in UI */
  calibrationNote: z.string(),
}).strict();

export type StrategyLever = z.infer<typeof StrategyLever>;
export type WinCondition = z.infer<typeof WinCondition>;
export type FailurePattern = z.infer<typeof FailurePattern>;
export type Strategy = z.infer<typeof Strategy>;
export type SelectedStrategy = z.infer<typeof SelectedStrategy>;
