/**
 * decide() — confidence gate.
 *
 * Правила (в порядке приоритета):
 *   1. completeness < 0.9 → insufficient_data + gaps
 *   2. confidence < confidenceThreshold → ask_human
 *   3. оба условия выполнены → act
 *
 * Каждое сработавшее правило пишет шаг в trail.
 * Чистая функция: нет побочных эффектов, нет внешних зависимостей.
 */

import type { DecisionInput, DecisionOutput, TrailStep, Verdict } from "./types.js";

const COMPLETENESS_THRESHOLD = 0.9;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.8;

export function decide(input: DecisionInput): DecisionOutput {
  const { inputsRequired, inputsPresent, confidence } = input;
  const confidenceThreshold = input.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;

  // Guard: оба значения должны быть в [0, 1].
  if (confidence < 0 || confidence > 1 || confidenceThreshold < 0 || confidenceThreshold > 1) {
    return {
      inputsRequired,
      inputsPresent,
      completeness: 0,
      confidence,
      verdict: "insufficient_data",
      gaps: inputsRequired,
      trail: [
        {
          inputs: inputsPresent,
          rule: `confidence or confidenceThreshold out of [0,1] range: confidence=${confidence}, threshold=${confidenceThreshold}`,
          verdict: "insufficient_data",
        },
      ],
    };
  }

  // Считаем только те required-поля, которые реально присутствуют (set-membership).
  // Дубли и мусор в inputsPresent не накручивают completeness.
  const presentRequired = inputsRequired.filter((f) => inputsPresent.includes(f));
  const completeness =
    inputsRequired.length === 0 ? 1 : presentRequired.length / inputsRequired.length;

  const gaps = inputsRequired.filter((f) => !inputsPresent.includes(f));

  const trail: TrailStep[] = [];
  let verdict: Verdict;

  if (completeness < COMPLETENESS_THRESHOLD) {
    const step: TrailStep = {
      inputs: inputsPresent,
      rule: `completeness ${completeness.toFixed(3)} < ${COMPLETENESS_THRESHOLD} — missing: [${gaps.join(", ")}]`,
      verdict: "insufficient_data",
    };
    trail.push(step);
    verdict = "insufficient_data";
  } else if (confidence < confidenceThreshold) {
    const step: TrailStep = {
      inputs: inputsPresent,
      rule: `confidence ${confidence.toFixed(3)} < threshold ${confidenceThreshold}`,
      verdict: "ask_human",
    };
    trail.push(step);
    verdict = "ask_human";
  } else {
    const step: TrailStep = {
      inputs: inputsPresent,
      rule: `completeness ${completeness.toFixed(3)} >= ${COMPLETENESS_THRESHOLD}, confidence ${confidence.toFixed(3)} >= ${confidenceThreshold}`,
      verdict: "act",
    };
    trail.push(step);
    verdict = "act";
  }

  return {
    inputsRequired,
    inputsPresent,
    completeness,
    confidence,
    verdict,
    gaps,
    trail,
  };
}
