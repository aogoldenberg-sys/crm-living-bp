import { z } from "zod";

export const NodeType = z.enum(["external", "process", "metric", "outcome"]);
export type NodeType = z.infer<typeof NodeType>;

export const Trend = z.enum(["up", "down", "stable", "unknown"]);
export type Trend = z.infer<typeof Trend>;

export const CausalNode = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: NodeType,
  /** Reference to business plan section (e.g. "finance.revenue"), optional */
  section_ref: z.string().optional(),
  /** Current numeric value of this node (e.g. marginPercent=0.25), optional */
  current_value: z.number().optional(),
  trend: Trend.optional(),
}).strict();

export const EdgeDirection = z.union([z.literal(1), z.literal(-1)]);
export type EdgeDirection = z.infer<typeof EdgeDirection>;

export const EdgeOrigin = z.enum(["template", "ai_hypothesis", "confirmed"]);
export type EdgeOrigin = z.infer<typeof EdgeOrigin>;

export const CausalEdge = z.object({
  from: z.string().min(1),  // node id
  to: z.string().min(1),    // node id
  /** +1 = positive correlation (from↑ → to↑), -1 = negative (from↑ → to↓) */
  direction: EdgeDirection,
  /** 0..1, confidence/strength of the relationship */
  strength: z.number().min(0).max(1),
  /** Expected delay in days between cause and observable effect */
  lag_days: z.number().nonnegative().int(),
  /** Event IDs that provide evidence for this edge */
  evidence: z.array(z.string()),
  origin: EdgeOrigin,
}).strict();

export const CausalGraph = z.object({
  nodes: z.array(CausalNode),
  edges: z.array(CausalEdge),
}).strict();

export type CausalNode = z.infer<typeof CausalNode>;
export type CausalEdge = z.infer<typeof CausalEdge>;
export type CausalGraph = z.infer<typeof CausalGraph>;
