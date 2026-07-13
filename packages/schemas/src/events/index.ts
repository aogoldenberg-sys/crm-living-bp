import { z } from "zod";
import { PaymentIn, PaymentOut, PaymentCorrection } from "./payment.js";
import { DealStageChanged } from "./deal.js";
import { LeadCaptured } from "./lead.js";
import { CallLogged } from "./call.js";
import { BalanceAnchor } from "./balance_anchor.js";

export { PaymentIn, PaymentOut, PaymentCorrection } from "./payment.js";
export type { PaymentIn as PaymentInType, PaymentOut as PaymentOutType, PaymentCorrection as PaymentCorrectionType } from "./payment.js";
export { DealStageChanged } from "./deal.js";
export { LeadCaptured } from "./lead.js";
export { CallLogged } from "./call.js";
export { BalanceAnchor } from "./balance_anchor.js";
export type { BalanceAnchor as BalanceAnchorType } from "./balance_anchor.js";
export { ExternalSignal, DemandTrendPoint, CounterpartyRiskSignal } from "./monitor.js";
export type { ExternalSignal as ExternalSignalType, DemandTrendPoint as DemandTrendPointType, CounterpartyRiskSignal as CounterpartyRiskSignalType } from "./monitor.js";

/**
 * Все бизнес-события системы в одном дискриминированном юнионе.
 * discriminatedUnion быстрее z.union — Zod находит схему за O(1) по полю type,
 * а не перебирает все варианты. Критично при парсинге потока событий.
 */
export const BusinessEvent = z.discriminatedUnion("type", [
  PaymentIn,
  PaymentOut,
  PaymentCorrection,
  DealStageChanged,
  LeadCaptured,
  CallLogged,
  BalanceAnchor,
]);

export type BusinessEvent = z.infer<typeof BusinessEvent>;
