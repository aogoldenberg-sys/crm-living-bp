import type { Entitlements, PlanTier } from "@crm/schemas";
import { type Result, ok, err } from "../types.js";

const TRIAL_DAYS = 14;

/**
 * Запускает триал на 14 дней. Повторный триал запрещён.
 * Чистая функция — возвращает новый Entitlements, не пишет в БД.
 */
export function startTrial(
  ent: Entitlements,
  tier: PlanTier,
  now: string,
): Result<Entitlements> {
  if (ent.trialEndsAt !== null) {
    return err({ code: "ALREADY_ACCEPTED", message: "Триал уже был активирован ранее" });
  }

  const end = new Date(now);
  end.setUTCDate(end.getUTCDate() + TRIAL_DAYS);
  const trialEndsAt = end.toISOString() as `${string}T${string}Z`;

  return ok({
    ...ent,
    tier,
    trialEndsAt,
    updatedAt: now as `${string}T${string}Z`,
  });
}
