import { z } from "zod";
import { Inn } from "../money.js";

export const Counterparty = z
  .object({
    inn: Inn,
    name: z.string().min(1),
    role: z.enum(["supplier", "buyer"]),
    share: z.number().min(0).max(1).nullable(), // доля в обороте
  })
  .strict();
export type Counterparty = z.infer<typeof Counterparty>;
