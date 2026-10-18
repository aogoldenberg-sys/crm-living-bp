import { z } from "zod";
import { Kopecks, IsoDateTime } from "../money.js";

/** Товар каталога Густорико. */
export const Product = z.object({
  productId: z.string().min(1),
  name: z.string().min(1),
  barcode: z.string().nullable(),
  category: z.string().min(1),
  group: z.string().min(1),
  manufacturer: z.string().min(1),
  /** НДС %: 0, 10, 22. */
  vatRate: z.number().int().nonnegative(),
  /** Отпускная цена клиенту в копейках. */
  sellPrice: Kopecks,
  /** URL фото (Google Drive thumbnail). */
  photoUrl: z.string().nullable(),
  updatedAt: IsoDateTime,
}).strict();

export type Product = z.infer<typeof Product>;
