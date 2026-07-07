import { z } from "zod";
import { IsoDateTime, Kopecks } from "../money.js";

// Оборотно-сальдовая ведомость по счёту
export const TurnoverSheet = z
  .object({
    cardId: z.string().uuid(),
    businessId: z.string().min(1),
    accountCode: z.string().min(1),         // "60", "62", "51" и т.д.
    periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    openingDebit: Kopecks,
    openingCredit: Kopecks,
    turnoverDebit: Kopecks,
    turnoverCredit: Kopecks,
    closingDebit: Kopecks,
    closingCredit: Kopecks,
    uploadedAt: IsoDateTime,
    sourceDocId: z.string().uuid(),
  })
  .strict();
export type TurnoverSheet = z.infer<typeof TurnoverSheet>;

// Карточка основного средства
export const FixedAssetCard = z
  .object({
    assetId: z.string().uuid(),
    businessId: z.string().min(1),
    name: z.string().min(1),
    inventoryNumber: z.string().min(1),
    initialCostKopecks: Kopecks,
    residualCostKopecks: Kopecks,
    usefulLifeMonths: z.number().int().positive(),
    commissionedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    uploadedAt: IsoDateTime,
    sourceDocId: z.string().uuid(),
  })
  .strict();
export type FixedAssetCard = z.infer<typeof FixedAssetCard>;
