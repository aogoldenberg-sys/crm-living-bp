import { z } from "zod";
import { IsoDateTime } from "../money.js";

// РЕШЕНИЕ: упрощённый enum (bank/fns/mvd/other) вместо RequestingAuthority из compliance.ts.
// compliance.ts — разбор входящего требования и checklist; здесь — карточка хранения запроса.
// Разные use-case, разные DTO. Дублирования нет.
export const AuthorityKind = z.enum(["bank", "fns", "mvd", "other"]);
export type AuthorityKind = z.infer<typeof AuthorityKind>;

export const AuthorityRequest = z
  .object({
    requestId: z.string().uuid(),
    businessId: z.string().min(1),
    authority: AuthorityKind,
    requestDocRef: z.string().min(1),      // ссылка на загруженный документ запроса
    responseDraftRef: z.string().nullable(), // null до создания черновика
    receivedAt: IsoDateTime,
    status: z.enum(["received", "draft_ready", "sent"]),
  })
  .strict();
export type AuthorityRequest = z.infer<typeof AuthorityRequest>;
