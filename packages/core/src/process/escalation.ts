import type { ProcessInstance, SLABreach, ProcessStep } from "@crm/schemas";

export type EscalationLevel =
  | "none"        // within SLA
  | "assignee"    // notify the responsible person (just breached)
  | "supervisor"  // notify supervisor (2× SLA elapsed)
  | "owner";      // escalate to business owner (3× SLA elapsed)

export interface EscalationState {
  level: EscalationLevel;
  /** Hours overdue at current level */
  hoursOverdue: number;
  /** Human-readable message */
  message: string;
  /** The role that should be notified */
  notifyRole: string;
}

/**
 * Determine escalation level for a single SLA breach.
 * Pure function. No side effects. No notifications sent.
 *
 * Levels:
 *   none:       hoursOverdue <= 0
 *   assignee:   0 < hoursOverdue <= sla_hours      (1× overdue)
 *   supervisor: sla_hours < hoursOverdue <= 2×sla  (2× overdue)
 *   owner:      hoursOverdue > 2×sla_hours          (3× or more)
 *
 * @param breach    the SLA breach record
 * @param step      the process step that was breached (for sla_hours + responsible_role)
 * @param now       ISO datetime string for current time
 */
export function escalationLevel(
  breach: SLABreach,
  step: ProcessStep,
  now: string,
): EscalationState {
  const elapsedSinceBreachHours =
    (new Date(now).getTime() - new Date(breach.breachedAt).getTime()) /
    3_600_000;

  const total = breach.hoursOverdue + elapsedSinceBreachHours;

  if (total <= 0) {
    return {
      level: "none",
      hoursOverdue: total,
      message: "",
      notifyRole: step.responsible_role,
    };
  }

  if (total <= step.sla_hours) {
    return {
      level: "assignee",
      hoursOverdue: total,
      message: `SLA нарушен: ${step.name} — ${Math.round(total)} ч просрочки`,
      notifyRole: step.responsible_role,
    };
  }

  if (total <= 2 * step.sla_hours) {
    return {
      level: "supervisor",
      hoursOverdue: total,
      message: `Эскалация: ${step.name} — ${Math.round(total)} ч просрочки`,
      notifyRole: "supervisor",
    };
  }

  return {
    level: "owner",
    hoursOverdue: total,
    message: `Критично: ${step.name} — ${Math.round(total)} ч, требует внимания владельца`,
    notifyRole: "owner",
  };
}

/**
 * Compute escalation states for ALL breaches in an instance.
 * Returns only breaches that are at "assignee" level or above.
 * Filters out "none" (within SLA).
 */
export function computeEscalations(
  instance: ProcessInstance,
  steps: ProcessStep[],
  now: string,
): EscalationState[] {
  const results: EscalationState[] = [];

  for (const breach of instance.breaches) {
    const step = steps.find((s) => s.id === breach.stepId);
    if (!step) {
      continue;
    }
    const state = escalationLevel(breach, step, now);
    if (state.level !== "none") {
      results.push(state);
    }
  }

  return results;
}
