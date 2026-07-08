import { z } from "zod";
import { IsoDateTime, Inn } from "../money.js";

export const SourceDocKind = z.enum([
  "bank_statement",
  "cash_report",
  "fin_report",
  "staff_schedule",
  "doc_registry",
  "turnover_sheet",
  "fixed_asset_card",
  "authority_request",
  "business_plan",
  "other",
]);
export type SourceDocKind = z.infer<typeof SourceDocKind>;

// РЕШЕНИЕ: переименовано в DocMappedSection — MappedSection уже экспортируется из plan/intake.ts
export const DocMappedSection = z
  .object({
    sectionId: z.string().min(1),
    pageRange: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]),
    confidence: z.number().min(0).max(1),
  })
  .strict();
export type DocMappedSection = z.infer<typeof DocMappedSection>;

export const SourceDocument = z
  .object({
    docId: z.string().uuid(),
    businessId: z.string().min(1), // сервер выставляет, не клиент
    kind: SourceDocKind,
    fileRef: z.string().min(1),
    uploadedAt: IsoDateTime,
    pages: z.number().int().positive(),
    mappedSections: z.array(DocMappedSection),
    status: z.enum(["uploaded", "parsed", "mapped", "failed"]),
    sha256: z.string().length(64).optional(), // dedup
  })
  .strict();
export type SourceDocument = z.infer<typeof SourceDocument>;
