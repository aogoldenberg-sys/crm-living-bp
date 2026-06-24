import { z } from "zod";

/** One step within a Process definition */
export const ProcessStep = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  sla_hours: z.number().positive(),
  responsible_role: z.string().min(1),
  /** Optional: description of what quality check applies at this step */
  quality_check: z.string().optional(),
}).strict();

/** A Process definition (the template) */
export const Process = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  steps: z.array(ProcessStep).min(1),
}).strict();

/** A SLA breach record */
export const SLABreach = z.object({
  stepId: z.string(),
  startedAt: z.string().datetime(),
  breachedAt: z.string().datetime(),
  hoursOverdue: z.number().nonnegative(),
}).strict();

/** A running instance of a Process */
export const ProcessInstance = z.object({
  id: z.string().min(1),
  process_id: z.string().min(1),
  /** Index into Process.steps (0-based) */
  current_step_index: z.number().int().nonnegative(),
  started_at: z.string().datetime(),
  /** When current step started (reset on each advance) */
  current_step_started_at: z.string().datetime(),
  /** Accumulated breaches */
  breaches: z.array(SLABreach),
  status: z.enum(["active", "completed", "cancelled"]),
}).strict();

export type ProcessStep = z.infer<typeof ProcessStep>;
export type Process = z.infer<typeof Process>;
export type SLABreach = z.infer<typeof SLABreach>;
export type ProcessInstance = z.infer<typeof ProcessInstance>;
