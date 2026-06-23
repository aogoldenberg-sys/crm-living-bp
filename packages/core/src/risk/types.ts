/**
 * Типы модуля risk — confidence gate.
 *
 * Verdict: итоговое решение автомата.
 * TrailStep: одна запись аудит-трейла (inputs → rule → verdict).
 * DecisionInput: то что подаётся в decide().
 * DecisionOutput: то что возвращает decide().
 */

export type Verdict = "act" | "ask_human" | "insufficient_data";

export interface TrailStep {
  /** Имена входов, которые участвовали в этом шаге. */
  inputs: string[];
  /** Правило, которое сработало. */
  rule: string;
  /** Вердикт, выданный этим правилом. */
  verdict: Verdict;
}

export interface DecisionInput {
  /** Полный список полей, необходимых для принятия решения. */
  inputsRequired: string[];
  /** Фактически присутствующие поля (непустые, валидные). */
  inputsPresent: string[];
  /**
   * Уверенность модели/алгоритма в своих входных данных.
   * Число от 0 до 1.
   */
  confidence: number;
  /**
   * Порог уверенности: если confidence < confidenceThreshold → ask_human.
   * По умолчанию 0.8.
   */
  confidenceThreshold?: number;
}

export interface DecisionOutput {
  inputsRequired: string[];
  inputsPresent: string[];
  /** Доля присутствующих входов из необходимых: inputsPresent.length / inputsRequired.length. */
  completeness: number;
  confidence: number;
  verdict: Verdict;
  /**
   * Недостающие поля из inputsRequired.
   * Может быть непуст и при verdict="act" — если completeness >= 0.9,
   * но не все required-поля присутствуют (до 10% разрыва по порогу).
   */
  gaps: string[];
  /** Аудит-трейл: каждый шаг — одно сработавшее правило. */
  trail: TrailStep[];
}
