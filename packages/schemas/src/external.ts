import { z } from "zod";

export const ExternalPushSignalType = z.enum([
  "competitor_price",
  "trend",
  "news",
  "regulation",
]);
export type ExternalPushSignalType = z.infer<typeof ExternalPushSignalType>;

/** Сигнал, пришедший через POST /external (push от внешних систем). */
export const ExternalPushSignal = z
  .object({
    type: ExternalPushSignalType,
    source: z.string().min(1),
    payload: z.record(z.unknown()),
    ts: z.string().datetime(),
  })
  .strict();
export type ExternalPushSignal = z.infer<typeof ExternalPushSignal>;
