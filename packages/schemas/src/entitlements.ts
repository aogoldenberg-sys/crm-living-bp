import { z } from "zod";
import { IsoDate, IsoDateTime } from "./money.js";

// ── Тарифы подписки (линия 2) ────────────────────────────────────────────────
export const PlanTier = z.enum(["free", "pulse", "operator", "director", "enterprise"]);
export type PlanTier = z.infer<typeof PlanTier>;

// ── Разовые продукты (линия 1) ───────────────────────────────────────────────
export const OneOffProduct = z.enum(["diag", "live_plan", "scenario", "subsidy", "grant_pro"]);
export type OneOffProduct = z.infer<typeof OneOffProduct>;

export const OneOffPurchase = z.object({
  product: OneOffProduct,
  planId: z.string().min(1),
  purchasedAt: IsoDateTime,
}).strict();
export type OneOffPurchase = z.infer<typeof OneOffPurchase>;

export const UsageCounters = z.object({
  complianceCases: z.number().int().nonnegative(),
  taxReports: z.number().int().nonnegative(),
  planAssessRuns: z.number().int().nonnegative(),
}).strict();
export type UsageCounters = z.infer<typeof UsageCounters>;

/**
 * Устаревшая бинарная схема — оставлена для совместимости со старыми Firestore-документами.
 * Новый код использует tier + purchases.
 */
export const EntitlementPlan = z.enum(["free", "paid"]);
export type EntitlementPlan = z.infer<typeof EntitlementPlan>;

/**
 * Хранится в Firestore: tenants/{businessId}/_meta/entitlements.
 * Поля с .default() — опциональны при парсинге старых документов.
 */
export const Entitlements = z.object({
  businessId: z.string().min(1),
  // Legacy — backward compat
  plan: EntitlementPlan,
  paidUntil: IsoDate.nullable(),
  freeComplianceUsed: z.boolean(),
  freeReportUsed: z.boolean(),
  updatedAt: IsoDateTime,
  // New fields
  tier: PlanTier.default("free"),
  trialEndsAt: IsoDateTime.nullable().default(null),
  purchases: z.array(OneOffPurchase).default([]),
  usage: UsageCounters.default({ complianceCases: 0, taxReports: 0, planAssessRuns: 0 }),
}).strict();
export type Entitlements = z.infer<typeof Entitlements>;
