import type { Deal, Funnel, DealStageChanged } from "@crm/schemas";
import type { IsoDateTime } from "@crm/schemas";

export interface StageMetrics {
  stageId: string;
  stageName: string;
  /** Терминальная стадия: stuck всегда пуст, factConversion = 0 (нет стадий дальше). */
  terminal: boolean;
  /** Сделки, сейчас находящиеся на этой стадии. */
  count: number;
  /**
   * Snapshot-конверсия: доля сделок, прошедших дальше (от всех вошедших по текущему снимку).
   * 0 для терминальных стадий — конверсия «наружу» не имеет смысла.
   */
  factConversion: number;
  /** Нормативная конверсия из настройки воронки. 0 для терминальных. */
  normConversion: number;
  /**
   * Когортная конверсия: из сделок, вошедших в стадию за период cohortPeriod,
   * доля дошедших до следующей стадии. null если данных нет или стадия терминальная.
   */
  cohortConversion: number | null;
  /** Среднее кол-во дней на стадии для сделок, сейчас здесь находящихся. */
  avgDays: number;
  /** Норматив дней для этой стадии. */
  normDays: number;
  /**
   * dealId сделок, которые превысили normDays (застряли).
   * Всегда пуст для терминальных стадий.
   */
  stuck: string[];
  /** Суммарный взвешенный pipeline (amount × probability) для сделок на стадии, в копейках. */
  weightedPipeline: number;
}

export interface FunnelMetrics {
  funnelId: string;
  stages: StageMetrics[];
  /** Итоговый взвешенный pipeline по всей воронке. */
  totalWeightedPipeline: number;
}

export interface CohortOptions {
  events: DealStageChanged[];
  /** Начало периода (включительно). */
  from: IsoDateTime;
  /** Конец периода (включительно). */
  to: IsoDateTime;
}

/**
 * Считает метрики воронки по текущей проекции сделок.
 *
 * Snapshot-конверсия стадии S_i:
 *   factConversion = кол-во сделок на стадиях S_{i+1}..S_N
 *                  / кол-во сделок на стадиях S_i..S_N
 *
 * Терминальные стадии (terminal = true, например won/lost):
 *   - stuck всегда [] — не «застревают» в финальной точке
 *   - factConversion = 0 — нет следующих стадий, конверсия бессмысленна
 *   - normConversion = 0 — не сравниваем с нормой
 *
 * Когортная конверсия (при наличии cohortOptions):
 *   Для каждой нетерминальной стадии считаем сделки, вошедшие
 *   в неё за [from, to]. Из них — доля перешедших дальше.
 *
 * @param deals         Map из reduceDeals — текущее состояние всех сделок
 * @param funnel        Воронка с упорядоченными стадиями и нормативами
 * @param cohortOptions Опционально: raw события + период для когортной конверсии
 */
export function funnelMetrics(
  deals: Map<string, Deal>,
  funnel: Funnel,
  cohortOptions?: CohortOptions,
): FunnelMetrics {
  const stageIds = funnel.stages.map((s) => s.id);

  // Только сделки этой воронки
  const dealsInFunnel = [...deals.values()].filter(
    (d) => d.funnelId === funnel.funnelId,
  );

  const stageMetrics: StageMetrics[] = funnel.stages.map((stage, idx) => {
    const isTerminal = stage.terminal;

    // Сделки на этой стадии прямо сейчас
    const atStage = dealsInFunnel.filter((d) => d.currentStage === stage.id);

    // ── Snapshot-конверсия ──────────────────────────────────────────────
    let factConversion = 0;
    if (!isTerminal) {
      const enteredCount = dealsInFunnel.filter((d) => {
        const dealIdx = stageIds.indexOf(d.currentStage);
        return dealIdx >= idx;
      }).length;
      const convertedCount = dealsInFunnel.filter((d) => {
        const dealIdx = stageIds.indexOf(d.currentStage);
        return dealIdx > idx;
      }).length;
      factConversion = enteredCount > 0 ? convertedCount / enteredCount : 0;
    }

    // ── Когортная конверсия ─────────────────────────────────────────────
    let cohortConversion: number | null = null;
    if (!isTerminal && cohortOptions) {
      const { events, from, to } = cohortOptions;
      // Сделки, впервые вошедшие в стадию за период
      const enteredInPeriod = new Set<string>();
      for (const ev of events) {
        if (ev.toStage === stage.id && ev.ts >= from && ev.ts <= to) {
          enteredInPeriod.add(ev.dealId);
        }
      }
      if (enteredInPeriod.size > 0) {
        const convertedCount = [...enteredInPeriod].filter((dealId) => {
          const deal = deals.get(dealId);
          if (!deal) return false;
          return stageIds.indexOf(deal.currentStage) > idx;
        }).length;
        cohortConversion = convertedCount / enteredInPeriod.size;
      }
    }

    // ── Метрики времени и застрявших ────────────────────────────────────
    const avgDays =
      atStage.length > 0
        ? atStage.reduce((sum, d) => sum + d.daysInStage, 0) / atStage.length
        : 0;

    // Терминальные стадии: stuck не считается
    const stuck = isTerminal
      ? []
      : atStage.filter((d) => d.daysInStage > stage.normDays).map((d) => d.dealId);

    const weightedPipeline = atStage.reduce(
      (sum, d) => sum + d.amount * d.probability,
      0,
    );

    return {
      stageId: stage.id,
      stageName: stage.name,
      terminal: isTerminal,
      count: atStage.length,
      factConversion,
      normConversion: isTerminal ? 0 : stage.normConversion,
      cohortConversion,
      avgDays,
      normDays: stage.normDays,
      stuck,
      weightedPipeline,
    };
  });

  const totalWeightedPipeline = stageMetrics.reduce(
    (sum, s) => sum + s.weightedPipeline,
    0,
  );

  return {
    funnelId: funnel.funnelId,
    stages: stageMetrics,
    totalWeightedPipeline,
  };
}
