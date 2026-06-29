import type { ActionRequest, AutonomyLimits, JournalEntry, GateVerdict } from "@crm/schemas";
import type { DecisionOutput } from "../risk/index.js";

function newUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  // Fallback for Node.js without Web Crypto
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * appendEntry — creates a new journal entry.
 * Does NOT mutate any array. Returns new JournalEntry.
 * Caller is responsible for persisting the entry.
 */
export function appendEntry(
  action: ActionRequest,
  limits: AutonomyLimits,
  riskDecision: DecisionOutput,
  verdict: GateVerdict,
  reason: string,
): JournalEntry {
  return {
    entryId: newUuid() as `${string}-${string}-${string}-${string}-${string}`,
    actionId: action.actionId,
    configuredLevel: limits.level,
    requiredLevel: action.requiredLevel,
    decidedAt: new Date().toISOString(),
    inputs: {
      action,
      limits,
      completeness: riskDecision.completeness,
    },
    verdict,
    reason,
    applied: verdict === "execute",
  };
}
