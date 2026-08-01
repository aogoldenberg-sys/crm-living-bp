import type { IsoDate } from "@crm/schemas";
import { type Result, ok } from "../types.js";
import { cbrRateAt } from "./cbrRates.js";

export type DebtEntry = {
  amountKopecks: number;
  dueDate: IsoDate;
  paidDate: IsoDate | null;
};

export type Art236Input = {
  debts: DebtEntry[];
  calcDate: IsoDate;
  contractRate?: number;
};

export type Art236LineResult = {
  amountKopecks: number;
  dueDate: IsoDate;
  endDate: IsoDate;
  days: number;
  ratePercent: number;
  compensationKopecks: number;
};

export type Art236Result = {
  lines: Art236LineResult[];
  totalKopecks: number;
};

/** Число дней между двумя ISO-датами включительно. */
function daysBetween(from: IsoDate, to: IsoDate): number {
  const ms = Date.parse(to) - Date.parse(from);
  return Math.floor(ms / 86_400_000) + 1;
}

/** Следующий день после ISO-даты. */
function nextDay(date: IsoDate): IsoDate {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10) as IsoDate;
}

/**
 * Расчёт компенсации за задержку зарплаты по ст. 236 ТК РФ.
 * Формула: сумма * (ставка / 150) * дни просрочки.
 * Период: со дня СЛЕДУЮЩЕГО за дуе-датой по день расчёта ВКЛЮЧИТЕЛЬНО.
 */
export function computeArt236(input: Art236Input): Result<Art236Result> {
  const lines: Art236LineResult[] = [];

  for (const debt of input.debts) {
    if (debt.amountKopecks <= 0) continue;

    const endDate = debt.paidDate ?? input.calcDate;
    const startDate = nextDay(debt.dueDate);

    if (startDate > endDate) continue;

    // Ставка на начало периода — если меняется, разбиваем на отрезки
    const rateResult = cbrRateAt(startDate);
    if (!rateResult.ok) return rateResult;

    const cbrRate = rateResult.value;
    // 1/150 — минимум, contractRate выше — применяется он
    const effectiveRate = input.contractRate && input.contractRate > cbrRate
      ? input.contractRate
      : cbrRate;

    const days = daysBetween(startDate, endDate);
    const compensationKopecks = Math.round(
      debt.amountKopecks * (effectiveRate / 100 / 150) * days,
    );

    lines.push({
      amountKopecks: debt.amountKopecks,
      dueDate: debt.dueDate,
      endDate,
      days,
      ratePercent: effectiveRate,
      compensationKopecks,
    });
  }

  const totalKopecks = lines.reduce((s, l) => s + l.compensationKopecks, 0);
  return ok({ lines, totalKopecks });
}
