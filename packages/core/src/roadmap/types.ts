/**
 * Типы дорожной карты с уровнями автономии ИД.
 *
 * A1 показывает  — бейдж «к сведению», без кнопки
 * A2 реализует   — делает в лимитах, пишет в журнал решений
 * A3 предлагает  — кнопки «Принять»/«Отклонить», ждёт человека
 *
 * Юридически значимые действия (смена стратегии, версия плана) —
 * потолок A3. Закреплено типом: verdict не выше ask_human.
 */

export type Autonomy = "A1" | "A2" | "A3";
export type Priority = "high" | "medium" | "low";
export type ItemPhase = "refinement" | "execution";
export type ItemStatus = "pending" | "proposed" | "accepted" | "done";

export type SourceRef =
  | { type: "concern"; index: number }
  | { type: "gap"; index: number }
  | { type: "milestone"; id: string };

/** Один пункт дорожной карты. */
export interface RoadmapItem {
  id: string;
  phase: ItemPhase;
  title: string;
  description: string;
  priority: Priority;
  /**
   * Уровень автономии ИД:
   *   A1 = показывает (бейдж, без кнопок)
   *   A2 = реализует в лимитах (пишет в журнал)
   *   A3 = предлагает (ждёт «Принять»/«Отклонить»)
   */
  autonomy: Autonomy;
  /** Что система сделала или сделает с этим пунктом. */
  action: string;
  /** Откуда пришёл этот пункт (concern/gap/milestone). */
  sourceRef: SourceRef;
  /**
   * Минимальный completeness (coverage/confidence) для A2/A3 (§14 confidence-gate).
   * Если completeness < completenessRequired → autonomy принудительно A1.
   */
  completenessRequired: number;
  status: ItemStatus;
}

export interface Roadmap {
  businessId: string;
  generatedAt: string;
  /** Полнота покрытия из intake.confidence (0..1). */
  completeness: number;
  /** Все пункты: сначала refinement (по приоритету), потом execution. */
  items: RoadmapItem[];
  /** true если фаза реализации пуста (milestones не извлечены). */
  executionPhaseEmpty: boolean;
  /** Объяснение почему фаза реализации пуста. */
  executionEmptyReason: string;
}
