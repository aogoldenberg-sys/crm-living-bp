import type { Process, ProcessInstance, SLABreach } from "@crm/schemas";

export interface AdvanceResult {
  instance: ProcessInstance;
  /** true if process just completed (was on last step) */
  completed: boolean;
}

/**
 * Advance a ProcessInstance to the next step.
 * Pure function — returns new instance, never mutates.
 * If instance is already on the last step, marks status="completed".
 *
 * @param instance  current instance state
 * @param process   the Process definition
 * @param now       ISO datetime string for the transition timestamp
 */
export function advanceInstance(
  instance: ProcessInstance,
  process: Process,
  now: string,
): AdvanceResult {
  if (instance.status !== "active") {
    return { instance, completed: false };
  }

  if (instance.current_step_index >= process.steps.length - 1) {
    return {
      instance: { ...instance, status: "completed" },
      completed: true,
    };
  }

  return {
    instance: {
      ...instance,
      current_step_index: instance.current_step_index + 1,
      current_step_started_at: now,
    },
    completed: false,
  };
}

/**
 * Detect SLA breaches for the current step.
 * Returns breach record if current step has exceeded its sla_hours, null otherwise.
 * Does NOT mutate the instance — caller decides whether to append the breach.
 *
 * @param instance  current instance state
 * @param process   the Process definition
 * @param now       ISO datetime string for "current time"
 */
export function detectBreach(
  instance: ProcessInstance,
  process: Process,
  now: string,
): SLABreach | null {
  const step = process.steps[instance.current_step_index];
  if (!step) {
    return null;
  }

  const elapsedMs =
    new Date(now).getTime() -
    new Date(instance.current_step_started_at).getTime();
  const elapsedHours = elapsedMs / 3_600_000;

  if (elapsedHours > step.sla_hours) {
    return {
      stepId: step.id,
      startedAt: instance.current_step_started_at,
      breachedAt: now,
      hoursOverdue: elapsedHours - step.sla_hours,
    };
  }

  return null;
}

/**
 * Apply any new breach (if detected) to instance.breaches.
 * Returns new instance with breach appended, or same instance if no breach.
 * Deduplicated: does not add a breach for the same stepId twice.
 */
export function applyBreachCheck(
  instance: ProcessInstance,
  process: Process,
  now: string,
): ProcessInstance {
  const breach = detectBreach(instance, process, now);
  if (!breach) {
    return instance;
  }

  if (instance.breaches.some((b) => b.stepId === breach.stepId)) {
    return instance;
  }

  return {
    ...instance,
    breaches: [...instance.breaches, breach],
  };
}
