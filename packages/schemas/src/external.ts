import { z } from "zod";

export const ExternalSignalType = z.enum([
  "competitor_price",
  "trend",
  "news",
  "regulation",
]);
export type ExternalSignalType = z.infer<typeof ExternalSignalType>;

export const ExternalSignal = z
  .object({
    type: ExternalSignalType,
    source: z.string().min(1),
    payload: z.record(z.unknown()),
    ts: z.string().datetime(),
  })
  .strict();
export type ExternalSignal = z.infer<typeof ExternalSignal>;
