import { z } from "zod";
import { IsoDateTime, Inn } from "../money.js";

export const UploadedSource = z
  .object({
    sourceId: z.string().uuid(),
    kind: z.enum(["bank_csv", "bank_pdf", "crm_export", "photo", "voice", "contract"]),
    fileRef: z.string().min(1),
    extractedAt: IsoDateTime,
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type UploadedSource = z.infer<typeof UploadedSource>;

export const LayerStatus = z
  .object({
    completeness: z.number().min(0).max(1),
    sources: z.array(z.string().uuid()),
    missingItems: z.array(z.string()),
  })
  .strict();

export type LayerStatus = z.infer<typeof LayerStatus>;

export const HealthCheck = z
  .object({
    runway_days: z.number().int().nullable(),
    burn_rate_kopecks: z.number().int().nullable(),
    top_counterparties: z.array(
      z
        .object({
          inn: Inn.nullable(),
          name: z.string(),
          totalKopecks: z.number().int(),
          shareOfRevenue: z.number().min(0).max(1),
        })
        .strict(),
    ),
    concentration_risk: z.number().min(0).max(1).nullable(),
    red_flags: z.array(z.string()),
  })
  .strict();

export type HealthCheck = z.infer<typeof HealthCheck>;

export const BusinessRevision = z
  .object({
    revisionId: z.string().uuid(),
    businessId: z.string().min(1),
    createdAt: IsoDateTime,
    mode: z.enum(["document", "reverse", "hybrid"]),
    uploadedSources: z.array(UploadedSource),
    layers: z
      .object({
        cash: LayerStatus,
        sales: LayerStatus,
        obligations: LayerStatus,
        owner_voice: LayerStatus,
      })
      .strict(),
    healthCheck: HealthCheck,
  })
  .strict();

export type BusinessRevision = z.infer<typeof BusinessRevision>;
