import type { BusinessEvent } from "@crm/schemas";
import type {
  TaxProfile,
  TaxPeriod,
  Kudir,
  KudirRow,
  UsnDeclaration,
  InsuranceContribs,
} from "@crm/schemas";

/**
 * Налоговые расчёты. Чистые функции. Только события лога.
 *
 * КОНСТАНТЫ 2026 — ПРОВЕРИТЬ ПЕРЕД РЕЛИЗОМ по НК РФ.
 * Источник: ст. 430 НК (взносы), ст. 346.20 (ставки УСН).
 * Агент НЕ меняет константы без ссылки на норму.
 */
const CONTRIBS_FIXED_2026 = 5784200 as const;      // копейки — УТОЧНИТЬ
const CONTRIBS_THRESHOLD = 30000000 as const;      // 300 000 ₽ в копейках
const CONTRIBS_OVER_PCT = 0.01 as const;
const USN_INCOME_LIMIT = 45000000000 as const;     // УТОЧНИТЬ лимит 2026
const MIN_TAX_PCT = 0.01 as const;

type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; detail: string; missing?: string[] } };

/** Квартал даты ISO. */
function quarterOf(date: string): 1 | 2 | 3 | 4 {
  const m = Number(date.slice(5, 7));
  return (Math.ceil(m / 3)) as 1 | 2 | 3 | 4;
}

function inYear(date: string, year: number): boolean {
  return date.slice(0, 4) === String(year);
}

/** Доходные события периода. УСН: кассовый метод — по дате поступления. */
function incomesOf(events: readonly BusinessEvent[], year: number) {
  return events.filter(
    (e): e is Extract<BusinessEvent, { type: "payment_in" }> =>
      e.type === "payment_in" && inYear(e.valueDate, year),
  );
}

function outgoingsOf(events: readonly BusinessEvent[], year: number) {
  return events.filter(
    (e): e is Extract<BusinessEvent, { type: "payment_out" }> =>
      e.type === "payment_out" && inYear(e.valueDate, year),
  );
}

/**
 * Проверка непрерывности выписки: месяц года без единого события
 * при наличии соседних — подозрение на разрыв данных.
 */
export function detectGaps(
  events: readonly BusinessEvent[],
  year: number,
): string[] {
  const monthsWithData = new Set<number>();
  for (const e of events) {
    const d = "valueDate" in e ? e.valueDate : e.ts.slice(0, 10);
    if (inYear(d, year)) monthsWithData.add(Number(d.slice(5, 7)));
  }
  if (monthsWithData.size === 0) return ["нет данных за год"];
  const min = Math.min(...monthsWithData);
  const max = Math.max(...monthsWithData);
  const gaps: string[] = [];
  for (let m = min; m <= max; m++) {
    if (!monthsWithData.has(m)) gaps.push(`разрыв в выписке: месяц ${m}`);
  }
  return gaps;
}

/** КУДиР из лога. Каждая строка несёт eventId — трейл до первички. */
export function computeKudir(
  events: readonly BusinessEvent[],
  profile: TaxProfile,
  period: TaxPeriod,
  now: string,
): Result<Kudir> {
  const year = period.year;
  const incomes = incomesOf(events, year);
  if (incomes.length === 0 && outgoingsOf(events, year).length === 0) {
    return {
      ok: false,
      error: {
        code: "insufficient_data",
        detail: "нет событий за период",
        missing: ["банковская выписка за " + year],
      },
    };
  }
  const withExpense = profile.regime === "usn15";
  const rows: KudirRow[] = [];
  let no = 1;
  const all = [...incomes, ...(withExpense ? outgoingsOf(events, year) : [])]
    .sort((a, b) => a.valueDate.localeCompare(b.valueDate));
  let totalIncome = 0;
  let totalExpense = 0;
  for (const e of all) {
    const isIn = e.type === "payment_in";
    if (isIn) totalIncome += e.amount;
    else totalExpense += e.amount;
    rows.push({
      rowNo: no++,
      date: e.valueDate,
      docRef: `выписка, ${e.valueDate}`,
      content: e.purpose,
      income: isIn ? e.amount : null,
      expense: isIn ? null : e.amount,
      eventId: e.eventId,
    });
  }
  return {
    ok: true,
    value: {
      profileInn: profile.inn,
      period,
      rows,
      totalIncome,
      totalExpense: withExpense ? totalExpense : null,
      generatedAt: now,
      status: "draft",
    },
  };
}

/** Взносы ИП за себя: фикс + 1% сверх порога. */
export function computeContribs(
  events: readonly BusinessEvent[],
  year: number,
): InsuranceContribs {
  const income = incomesOf(events, year).reduce((s, e) => s + e.amount, 0);
  const overBase = Math.max(0, income - CONTRIBS_THRESHOLD);
  const overAmount = Math.floor(overBase * CONTRIBS_OVER_PCT);
  // Уплаченные взносы — payment_out с назначением про страховые взносы.
  const paid = outgoingsOf(events, year)
    .filter((e) => /страхов|взнос|фикс.*платеж|ОПС|ОМС/i.test(e.purpose))
    .reduce((s, e) => s + e.amount, 0);
  return {
    year,
    fixedAmount: CONTRIBS_FIXED_2026,
    overThresholdPct: CONTRIBS_OVER_PCT,
    overThresholdBase: overBase,
    overThresholdAmount: overAmount,
    total: CONTRIBS_FIXED_2026 + overAmount,
    paidInPeriod: paid,
  };
}

/**
 * УСН 6%: налог = доход × ставка − вычет взносов.
 * Вычет: без работников до 100%, с работниками до 50%.
 * Всё нарастающим итогом по кварталам.
 */
export function computeUsn6(
  events: readonly BusinessEvent[],
  profile: TaxProfile,
  year: number,
  makeId: () => string,
  now: string,
): Result<UsnDeclaration> {
  if (profile.regime !== "usn6") {
    return { ok: false, error: { code: "wrong_regime", detail: profile.regime } };
  }
  const gaps = detectGaps(events, year);
  const incomes = incomesOf(events, year);
  if (incomes.length === 0) {
    return {
      ok: false,
      error: {
        code: "insufficient_data",
        detail: "нет поступлений за год",
        missing: ["выписка за " + year, "или подтвердите нулевой период"],
      },
    };
  }

  const qIncome: [number, number, number, number] = [0, 0, 0, 0];
  for (const e of incomes) {
    const qi = quarterOf(e.valueDate) - 1;
    qIncome[qi] = (qIncome[qi] ?? 0) + e.amount;
  }
  // нарастающим итогом
  const [qi0 = 0, qi1 = 0, qi2 = 0, qi3 = 0] = qIncome;
  const cum: [number, number, number, number] = [
    qi0,
    qi0 + qi1,
    qi0 + qi1 + qi2,
    qi0 + qi1 + qi2 + qi3,
  ];
  if (cum[3] > USN_INCOME_LIMIT) {
    return {
      ok: false,
      error: { code: "limit_exceeded", detail: "доход превысил лимит УСН" },
    };
  }

  const contribs = computeContribs(events, year);
  const deductCap = profile.employees ? 0.5 : 1.0;
  const rate = profile.taxRatePct / 100;

  const tax: [number, number, number, number] = [0, 0, 0, 0];
  const deducted: [number, number, number, number] = [0, 0, 0, 0];
  for (let q = 0; q < 4; q++) {
    const gross = Math.floor((cum[q] ?? 0) * rate);
    // Взносы к вычету: уплаченные в периоде, в пределах cap.
    const maxDeduct = Math.floor(gross * deductCap);
    const d = Math.min(contribs.paidInPeriod, maxDeduct);
    deducted[q] = d;
    const prevPaid = q === 0 ? 0 : tax.slice(0, q).reduce((s, v) => s + (v ?? 0), 0);
    tax[q] = Math.max(0, gross - d - prevPaid);
  }

  const confidence = gaps.length === 0 ? 0.95 : Math.max(0.3, 0.95 - gaps.length * 0.15);

  return {
    ok: true,
    value: {
      declarationId: makeId(),
      profileInn: profile.inn,
      period: { year, quarter: null },
      regime: "usn6",
      incomeByQuarter: cum,
      expenseByQuarter: null,
      contribsDeducted: deducted,
      taxByQuarter: tax,
      minTax: null,
      taxToPay: tax.reduce((s, v) => s + v, 0),
      evidence: incomes.map((e) => e.eventId),
      confidence,
      warnings: gaps,
      generatedAt: now,
      status: "draft",
    },
  };
}

/**
 * УСН 15%: налог = (доход − расход) × ставка, но не меньше 1% от дохода (минимальный налог).
 * Вычет взносов: включаются в расходы (не прямой вычет из налога).
 * Всё нарастающим итогом по кварталам.
 */
export function computeUsn15(
  events: readonly BusinessEvent[],
  profile: TaxProfile,
  year: number,
  makeId: () => string,
  now: string,
): Result<UsnDeclaration> {
  if (profile.regime !== "usn15") {
    return { ok: false, error: { code: "wrong_regime", detail: profile.regime } };
  }
  const gaps = detectGaps(events, year);
  const incomes = incomesOf(events, year);
  const outgoings = outgoingsOf(events, year);
  if (incomes.length === 0 && outgoings.length === 0) {
    return {
      ok: false,
      error: {
        code: "insufficient_data",
        detail: "нет событий за год",
        missing: ["выписка за " + year, "или подтвердите нулевой период"],
      },
    };
  }

  // Доход и расход по кварталам (не нарастающим — для промежуточного расчёта)
  const qIncome: [number, number, number, number] = [0, 0, 0, 0];
  const qExpense: [number, number, number, number] = [0, 0, 0, 0];
  for (const e of incomes) {
    const qi = quarterOf(e.valueDate) - 1;
    qIncome[qi] = (qIncome[qi] ?? 0) + e.amount;
  }
  for (const e of outgoings) {
    const qi = quarterOf(e.valueDate) - 1;
    qExpense[qi] = (qExpense[qi] ?? 0) + e.amount;
  }

  // Нарастающим итогом
  const [i0 = 0, i1 = 0, i2 = 0, i3 = 0] = qIncome;
  const cumIncome: [number, number, number, number] = [
    i0, i0 + i1, i0 + i1 + i2, i0 + i1 + i2 + i3,
  ];
  const [e0 = 0, e1 = 0, e2 = 0, e3 = 0] = qExpense;
  const cumExpense: [number, number, number, number] = [
    e0, e0 + e1, e0 + e1 + e2, e0 + e1 + e2 + e3,
  ];

  if (cumIncome[3] > USN_INCOME_LIMIT) {
    return {
      ok: false,
      error: { code: "limit_exceeded", detail: "доход превысил лимит УСН" },
    };
  }

  const rate = profile.taxRatePct / 100;

  // Авансовые платежи по кварталам (нарастающим − уже уплаченное)
  const tax: [number, number, number, number] = [0, 0, 0, 0];
  // При usn15 взносы — расходы, не прямой вычет. Вычет не применяем отдельно.
  const deducted: [number, number, number, number] = [0, 0, 0, 0];
  for (let q = 0; q < 4; q++) {
    const base = Math.max(0, (cumIncome[q] ?? 0) - (cumExpense[q] ?? 0));
    const gross = Math.floor(base * rate);
    const prevPaid = q === 0 ? 0 : tax.slice(0, q).reduce((s, v) => s + (v ?? 0), 0);
    tax[q] = Math.max(0, gross - prevPaid);
  }

  // Минимальный налог: 1% от годового дохода (НК РФ ст. 346.18 п.6)
  const minTax = Math.floor((cumIncome[3] ?? 0) * MIN_TAX_PCT);
  const calcTax = tax.reduce((s, v) => s + v, 0);
  // Если расчётный налог < минимального — платить минимальный
  const taxToPay = calcTax < minTax && cumIncome[3] > 0 ? minTax : calcTax;

  const confidence = gaps.length === 0 ? 0.95 : Math.max(0.3, 0.95 - gaps.length * 0.15);
  const warnings = [...gaps];
  if (taxToPay === minTax && calcTax < minTax) {
    warnings.push("применён минимальный налог 1% от дохода (НК РФ ст. 346.18 п.6)");
  }

  const evidence = [
    ...incomes.map((e) => e.eventId),
    ...outgoings.map((e) => e.eventId),
  ];

  return {
    ok: true,
    value: {
      declarationId: makeId(),
      profileInn: profile.inn,
      period: { year, quarter: null },
      regime: "usn15",
      incomeByQuarter: cumIncome,
      expenseByQuarter: cumExpense,
      contribsDeducted: deducted,
      taxByQuarter: tax,
      minTax,
      taxToPay,
      evidence,
      confidence,
      warnings,
      generatedAt: now,
      status: "draft",
    },
  };
}
