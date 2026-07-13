import { z } from "zod";
import { Inn } from "./money.js";

/**
 * Профиль мониторинга тенанта — хранится в Firestore:
 * tenants/{businessId}/_meta/monitoring_profile
 */
export const MonitoringProfile = z.object({
  businessId: z.string().min(1),
  /** Ключевые слова для фильтрации RSS и Wordstat */
  keywords: z.array(z.string().min(1)),
  /** ИНН контрагентов для проверки через DaData/kad.arbitr */
  counterpartyInns: z.array(Inn),
  /** Теги ниши для будущей сегментации сигналов */
  nicheTags: z.array(z.string().min(1)),
}).strict();
export type MonitoringProfile = z.infer<typeof MonitoringProfile>;
