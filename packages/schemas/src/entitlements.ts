import { z } from "zod";
import { IsoDate, IsoDateTime } from "./money.js";

/**
 * G13 freemium: первый комплаенс-кейс и первый отчёт — бесплатно.
 * Хранится в Firestore: tenants/{businessId}/_meta/entitlements
 */
export const EntitlementPlan = z.enum(["free", "paid"]);
export type EntitlementPlan = z.infer<typeof EntitlementPlan>;

export const Entitlements = z.object({
  businessId: z.string().min(1),
  plan: EntitlementPlan,
  /** null = бесплатный тариф или не задан */
  paidUntil: IsoDate.nullable(),
  /** true = бесплатный первый кейс уже использован */
  freeComplianceUsed: z.boolean(),
  /** true = бесплатный первый отчёт уже использован */
  freeReportUsed: z.boolean(),
  updatedAt: IsoDateTime,
}).strict();
export type Entitlements = z.infer<typeof Entitlements>;
