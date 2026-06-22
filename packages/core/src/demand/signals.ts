import type { LeadCaptured, CallLogged, DealStageChanged } from "@crm/schemas";
import type { DemandPeriod, DemandSignals } from "./types.js";

/** Зажимает значение в [-1, 1]. */
function clamp(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

/**
 * Нормализованное изменение: (current - baseline) / max(ε, baseline).
 * Возвращает 0 если baseline = 0 (нет точки отсчёта).
 */
function relChange(current: number, baseline: number): number {
  if (baseline <= 0) return 0;
  return (current - baseline) / baseline;
}

/**
 * Вычисляет сигналы спроса за заданный период из append-only лога событий.
 *
 * Детерминировано: одинаковые входы → одинаковые выходы.
 * Чистая функция: не делает I/O, не мутирует входные данные.
 *
 * §8: живые рекомендации намеренно отсутствуют — только метрики.
 *
 * @param leadEvents   Все LeadCaptured события (не только за период)
 * @param _callEvents  Зарезервировано для §8 (reply_rate, качество звонков)
 * @param dealEvents   Все DealStageChanged события (не только за период)
 * @param period       Окно агрегации
 * @param opts.wonStageIds  ID терминальных «won»-стадий; без них winRate = null
 * @param opts.baseline     Предыдущий период для расчёта trendScore
 */
export function computeDemandSignals(
  leadEvents: LeadCaptured[],
  _callEvents: CallLogged[],
  dealEvents: DealStageChanged[],
  period: DemandPeriod,
  opts?: {
    wonStageIds?: string[];
    baseline?: DemandSignals;
  },
): DemandSignals {
  const { from, to } = period;
  const wonStageIds = opts?.wonStageIds ?? null;
  const baseline = opts?.baseline ?? null;

  // ── Лиды за период ────────────────────────────────────────────────────────
  const leadsInPeriod = leadEvents.filter(
    (e) => e.ts >= from && e.ts <= to,
  );
  const leads = leadsInPeriod.length;

  // ── Квалификационный коэффициент ──────────────────────────────────────────
  // Лид считается квалифицированным если по его leadId открыта хотя бы одна сделка
  // (DealStageChanged с fromStage = "" — вход в воронку).
  const qualifiedLeadIds = new Set(
    dealEvents
      .filter((e) => e.fromStage === "")
      .map((e) => e.leadId),
  );
  const qualifiedInPeriod = leadsInPeriod.filter((l) =>
    qualifiedLeadIds.has(l.leadId),
  ).length;
  const qualifiedRate = leads > 0 ? qualifiedInPeriod / leads : 0;

  // ── Win-rate + avgCheckFact ───────────────────────────────────────────────
  let winRate: number | null = null;
  let avgCheckFact = 0;

  if (wonStageIds !== null && wonStageIds.length > 0) {
    // Сделки, вошедшие в воронку за период (fromStage = "")
    const dealsEnteredInPeriod = new Set(
      dealEvents
        .filter((e) => e.fromStage === "" && e.ts >= from && e.ts <= to)
        .map((e) => e.dealId),
    );

    // Сделки, дошедшие до won-стадии (за всё время, не только период)
    const wonDeals = dealEvents.filter(
      (e) =>
        wonStageIds.includes(e.toStage) &&
        dealsEnteredInPeriod.has(e.dealId),
    );

    winRate =
      dealsEnteredInPeriod.size > 0
        ? wonDeals.length / dealsEnteredInPeriod.size
        : 0;

    // avgCheckFact — средняя сумма по won-сделкам с известным estimatedAmount
    const wonAmounts = wonDeals
      .map((e) => e.estimatedAmount)
      .filter((a): a is number => a !== null && a > 0);
    avgCheckFact =
      wonAmounts.length > 0
        ? Math.round(wonAmounts.reduce((s, a) => s + a, 0) / wonAmounts.length)
        : 0;
  }

  // ── trendScore (EMA по периодам) ─────────────────────────────────────────
  // Взвешиваем три сигнала: leads (40%), qualifiedRate (40%), winRate (20%).
  // Если winRate = null — перераспределяем вес на leads/qualifiedRate.
  let trendScore = 0;
  if (baseline !== null) {
    if (winRate !== null && baseline.winRate !== null) {
      trendScore = clamp(
        relChange(leads, baseline.leads) * 0.4 +
          relChange(qualifiedRate, baseline.qualifiedRate) * 0.4 +
          relChange(winRate, baseline.winRate) * 0.2,
      );
    } else {
      trendScore = clamp(
        relChange(leads, baseline.leads) * 0.5 +
          relChange(qualifiedRate, baseline.qualifiedRate) * 0.5,
      );
    }
  }

  return {
    period,
    leads,
    qualifiedRate,
    winRate,
    avgCheckFact,
    trendScore,
  };
}
