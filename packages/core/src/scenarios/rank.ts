import type { ScenarioResult } from "@crm/schemas";

function score(r: ScenarioResult): number {
  const complexityBonus = r.complexity === "low" ? 0.2 : r.complexity === "medium" ? 0.1 : 0;
  return r.gapAvoidedProbability * 0.5 + r.projectedForecast.confidence * 0.3 + complexityBonus;
}

/** Сортирует сценарии по убыванию score. Не мутирует входной массив. */
export function rankScenarios(results: ScenarioResult[]): ScenarioResult[] {
  return [...results].sort((a, b) => score(b) - score(a));
}
