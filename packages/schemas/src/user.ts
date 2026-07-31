import { z } from "zod";
import { IsoDateTime } from "./money.js";

export const UserProfile = z.object({
  uid: z.string().min(1),
  email: z.string().email(),
  createdAt: IsoDateTime,
  businessId: z.string().min(1),
  emailVerified: z.boolean(),
  displayName: z.string().nullable(),
}).strict();
export type UserProfile = z.infer<typeof UserProfile>;
