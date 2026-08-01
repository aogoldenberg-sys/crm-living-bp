import type { IsoDate } from "@crm/schemas";
import { type Result, ok, err } from "../types.js";

type RateEntry = {
  from: IsoDate;
  to: IsoDate | null;
  ratePercent: number;
};

/**
 * Ключевая ставка ЦБ РФ с 2023.
 * to === null означает «действует по настоящее время».
 */
export const CBR_KEY_RATES: readonly RateEntry[] = [
  { from: "2023-01-01", to: "2023-07-23", ratePercent: 7.5 },
  { from: "2023-07-24", to: "2023-08-14", ratePercent: 8.5 },
  { from: "2023-08-15", to: "2023-09-17", ratePercent: 12 },
  { from: "2023-09-18", to: "2023-10-29", ratePercent: 13 },
  { from: "2023-10-30", to: "2023-12-17", ratePercent: 15 },
  { from: "2023-12-18", to: "2024-02-25", ratePercent: 16 },
  { from: "2024-02-26", to: "2024-07-28", ratePercent: 16 },
  { from: "2024-07-29", to: "2024-10-27", ratePercent: 18 },
  { from: "2024-10-28", to: "2025-02-13", ratePercent: 21 },
  { from: "2025-02-14", to: "2025-04-24", ratePercent: 21 },
  { from: "2025-04-25", to: null, ratePercent: 21 },
];

/** Найти ставку ЦБ, действующую на дату. */
export function cbrRateAt(date: IsoDate): Result<number> {
  for (const entry of CBR_KEY_RATES) {
    if (date >= entry.from && (entry.to === null || date <= entry.to)) {
      return ok(entry.ratePercent);
    }
  }
  return err({
    code: "INSUFFICIENT_DATA",
    message: `[УТОЧНИТЬ: ключевая ставка] — ставка ЦБ на ${date} отсутствует в справочнике`,
  });
}
