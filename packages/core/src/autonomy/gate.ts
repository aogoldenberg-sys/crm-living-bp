import type { ActionRequest, AutonomyLimits, GateResult } from "@crm/schemas";
import type { DecisionOutput } from "../risk/index.js";

// Level ordering: A1 < A2 < A3 < A4
const LEVEL_ORDER: Record<string, number> = { A1: 1, A2: 2, A3: 3, A4: 4 };

/**
 * canExecute — the gate function.
 * Pure: no I/O, no side effects.
 *
 * Rules (in priority order):
 * 1. completeness < 0.9 → insufficient_data
 * 2. Legally significant + configured level < A3 → ask_human
 * 3. Legally significant at any level → ask_human (legal actions are never auto-applied)
 * 4. Action's requiredLevel > configured level → ask_human
 * 5. Action type not in allowedActions → ask_human
 * 6. Budget shift exceeds limit → ask_human
 * 7. Action in requireConfirmationFor → ask_human
 * 8. All gates pass → execute
 */
export function canExecute(
  action: ActionRequest,
  limits: AutonomyLimits,
  riskDecision: DecisionOutput,
): GateResult {
  // Rule 1: completeness gate
  if (riskDecision.completeness < 0.9) {
    const missing = riskDecision.trail
      .filter((s) => s.verdict === "insufficient_data")
      .map((s) => s.rule);
    return {
      verdict: "insufficient_data",
      reason: `Недостаточно данных для автономного решения (completeness=${riskDecision.completeness.toFixed(2)})`,
      missingData: missing.length > 0 ? missing : ["completeness < 0.9"],
    };
  }

  // Rule 2+3: legally significant actions — always ask_human (ceiling A3 = can advise, not auto-execute)
  if (action.isLegallySignificant) {
    return {
      verdict: "ask_human",
      reason: "Юридически значимые действия требуют подтверждения человека (потолок A3)",
    };
  }

  // Rule 4: configured level must be >= required level
  if ((LEVEL_ORDER[limits.level] ?? 0) < (LEVEL_ORDER[action.requiredLevel] ?? 0)) {
    return {
      verdict: "ask_human",
      reason: `Действие требует уровня ${action.requiredLevel}, настроен ${limits.level}`,
    };
  }

  // Rule 5: action type must be in allowedActions
  if (!limits.allowedActions.includes(action.actionType)) {
    return {
      verdict: "ask_human",
      reason: `Тип действия «${action.actionType}» не разрешён для уровня ${limits.level}`,
    };
  }

  // Rule 6: budget shift limit (A2 only — A3/A4 are advisory, not auto-executing budget changes)
  if (limits.level === "A2" && action.budgetShiftKopecks !== undefined) {
    if (action.budgetShiftKopecks > limits.maxBudgetShiftKopecks) {
      return {
        verdict: "ask_human",
        reason: `Изменение бюджета ${action.budgetShiftKopecks} коп. превышает лимит ${limits.maxBudgetShiftKopecks} коп.`,
      };
    }
  }

  // Rule 7: explicit confirmation required
  if (limits.requireConfirmationFor.includes(action.actionType)) {
    return {
      verdict: "ask_human",
      reason: `Действие «${action.actionType}» требует явного подтверждения`,
    };
  }

  return { verdict: "execute", reason: "Все условия выполнены" };
}
