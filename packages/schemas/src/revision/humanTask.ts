import { z } from "zod";
import { IsoDateTime } from "../money.js";
import { SourceDocKind } from "./sourceDoc.js";

export const HumanTask = z
  .object({
    taskId: z.string().uuid(),
    businessId: z.string().min(1),
    reason: z.string().min(1),
    sectionRef: z.string().min(1),         // sectionId книги
    requiredDoc: SourceDocKind.nullable(),  // null если документ не нужен
    status: z.enum(["open", "done"]),
    createdBy: z.literal("system"),
    createdAt: IsoDateTime,
  })
  .strict();
export type HumanTask = z.infer<typeof HumanTask>;
