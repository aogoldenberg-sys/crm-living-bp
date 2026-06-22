import type { IsoDateTime } from "@crm/schemas";

export interface DemandPeriod {
  from: IsoDateTime;
  to: IsoDateTime;
}

/**
 * Агрегированные сигналы спроса за период.
 * Вычисляется детерминированно из лога событий — без внешних запросов.
 *
 * §8: живые рекомендации НЕ включены — только метрики.
 * Рекомендации подключаются отдельно после ≥4 недель факт-данных.
 */
export interface DemandSignals {
  period: DemandPeriod;

  /** Кол-во лидов (LeadCaptured) за период. */
  leads: number;

  /**
   * Квалификационный коэффициент: доля лидов, по которым открыта сделка
   * (leadId встречается в DealStageChanged за всё время, не только за период).
   * 0 если лидов нет.
   */
  qualifiedRate: number;

  /**
   * Win-rate: доля сделок, дошедших до won-стадии, среди всех сделок,
   * вошедших в воронку за период. null если wonStageIds не переданы.
   */
  winRate: number | null;

  /**
   * Средняя сумма закрытых сделок (won) за период, в копейках.
   * 0 если won-сделок нет или wonStageIds не переданы.
   */
  avgCheckFact: number;

  /**
   * Тренд-score: -1..+1, EMA-взвешенное изменение спроса.
   * 0 = нейтрально или нет базовой линии.
   * >0 = рост спроса, <0 = падение.
   */
  trendScore: number;
}
