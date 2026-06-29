import { z } from "zod";

// A1 observer | A2 operator | A3 advisor | A4 strategist
export const AutonomyLevel = z.enum(["A1", "A2", "A3", "A4"]);
export type AutonomyLevel = z.infer<typeof AutonomyLevel>;

// Legally significant action types — ceiling A3, never auto-applied
export const LegalActionType = z.enum([
  "contract_sign",
  "payment_execute",
  "regulatory_filing",
]);
export type LegalActionType = z.infer<typeof LegalActionType>;

// What the owner configures
export const AutonomyLimits = z
  .object({
    level: AutonomyLevel,
    maxBudgetShiftKopecks: z.number().int().nonnegative(), // 0 = no budget shifts allowed
    allowedActions: z.array(z.string()), // action type strings allowed at this level
    requireConfirmationFor: z.array(z.string()), // action types always needing human OK
  })
  .strict();
export type AutonomyLimits = z.infer<typeof AutonomyLimits>;

// Action being evaluated
export const ActionRequest = z
  .object({
    actionId: z.string().uuid(),
    actionType: z.string(), // e.g. "update_deal", "add_expense", "adjust_plan"
    requiredLevel: AutonomyLevel, // minimum level needed for this action
    budgetShiftKopecks: z.number().int().nonnegative().optional(), // if action involves money
    isLegallySignificant: z.boolean(),
  })
  .strict();
export type ActionRequest = z.infer<typeof ActionRequest>;

// Gate verdict
export const GateVerdict = z.enum(["execute", "ask_human", "insufficient_data"]);
export type GateVerdict = z.infer<typeof GateVerdict>;

// Gate result
export const GateResult = z
  .object({
    verdict: GateVerdict,
    reason: z.string(), // human-readable explanation
    missingData: z.array(z.string()).optional(), // when verdict=insufficient_data
  })
  .strict();
export type GateResult = z.infer<typeof GateResult>;

// Journal entry (append-only, immutable)
export const JournalEntry = z
  .object({
    entryId: z.string().uuid(),
    actionId: z.string().uuid(),
    configuredLevel: AutonomyLevel,
    requiredLevel: AutonomyLevel,
    decidedAt: z.string().datetime(),
    inputs: z
      .object({
        action: ActionRequest,
        limits: AutonomyLimits,
        completeness: z.number().min(0).max(1), // from risk/decide
      })
      .strict(),
    verdict: GateVerdict,
    reason: z.string(),
    applied: z.boolean(), // false = ask_human or insufficient_data
  })
  .strict();
export type JournalEntry = z.infer<typeof JournalEntry>;
