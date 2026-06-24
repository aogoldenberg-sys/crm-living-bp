import type { SelectedStrategy, Strategy } from "@crm/schemas";
import { STRATEGY_LIBRARY } from "./library.js";

export interface SelectionInput {
  /** Niche hints from the plan — text to match against niche_tags */
  nicheTags: string[];
  assessment?: {
    strengths: string[];
    concerns: Array<{ description: string; severity: "red" | "yellow" }>;
    gaps: Array<{ missingSection: string }>;
  };
}

/**
 * Deterministically select the best-fit initial strategy from the library.
 * NO Claude. NO simulation (§5 boundary — that waits for fact data).
 *
 * Scoring:
 * 1. Tag match: for each niche_tag in strategy that appears in input.nicheTags
 *    (case-insensitive substring match) → +0.2 per match, capped at 0.6
 * 2. Assessment signals:
 *    - Many concerns with severity="red" → lean toward niche_domination or cost_leadership (+0.1)
 *    - Strengths mentioning "уникал", "инновац", "new" → lean toward blue_ocean or differentiation (+0.1)
 *    - Gaps mentioning "b2b", "корпорат", "enterprise" in nicheTags → lean toward land_and_expand (+0.1)
 * 3. Default fallback: if no tags match → differentiation (most universal)
 *
 * Always returns SelectedStrategy with confidence="initial" and calibrationNote.
 */
export function selectInitialStrategy(input: SelectionInput): SelectedStrategy {
  const scores = new Map<string, number>();

  // Initialize all scores to 0
  for (const strategy of STRATEGY_LIBRARY) {
    scores.set(strategy.id, 0);
  }

  // Step 1: Tag matching — +0.2 per match, capped at 0.6
  for (const strategy of STRATEGY_LIBRARY) {
    let tagScore = 0;
    for (const tag of strategy.niche_tags) {
      const matched = input.nicheTags.some(
        (n) =>
          n.toLowerCase().includes(tag.toLowerCase()) ||
          tag.toLowerCase().includes(n.toLowerCase()),
      );
      if (matched) {
        tagScore += 0.2;
      }
    }
    scores.set(strategy.id, Math.min(tagScore, 0.6));
  }

  // Step 2: Assessment bonuses
  if (input.assessment) {
    const { strengths, concerns } = input.assessment;

    // Many red concerns → lean toward defensive strategies
    const redCount = concerns.filter((c) => c.severity === "red").length;
    if (redCount >= 2) {
      const nicheDom = scores.get("niche_domination") ?? 0;
      scores.set("niche_domination", nicheDom + 0.1);
      const costLead = scores.get("cost_leadership") ?? 0;
      scores.set("cost_leadership", costLead + 0.1);
    }

    // Strengths mentioning innovation signals → lean toward blue_ocean or differentiation
    const innovationSignal = strengths.some(
      (s) =>
        s.toLowerCase().includes("уникал") ||
        s.toLowerCase().includes("инновац") ||
        s.toLowerCase().includes("new"),
    );
    if (innovationSignal) {
      const blueOcean = scores.get("blue_ocean") ?? 0;
      scores.set("blue_ocean", blueOcean + 0.1);
      const diff = scores.get("differentiation") ?? 0;
      scores.set("differentiation", diff + 0.1);
    }

    // nicheTags mentioning b2b/enterprise → lean toward land_and_expand
    const b2bSignal = input.nicheTags.some(
      (n) =>
        n.toLowerCase().includes("b2b") ||
        n.toLowerCase().includes("корпорат") ||
        n.toLowerCase().includes("enterprise"),
    );
    if (b2bSignal) {
      const lae = scores.get("land_and_expand") ?? 0;
      scores.set("land_and_expand", lae + 0.1);
    }
  }

  // Step 3: Select highest scoring strategy (first in library wins ties)
  const firstStrategy = STRATEGY_LIBRARY[0];
  if (!firstStrategy) {
    throw new Error("STRATEGY_LIBRARY is empty");
  }

  let bestStrategy: Strategy = firstStrategy;
  let bestScore = scores.get(firstStrategy.id) ?? 0;

  // Check if any strategy has a non-zero score
  let anyMatch = false;
  for (const strategy of STRATEGY_LIBRARY) {
    const score = scores.get(strategy.id) ?? 0;
    if (score > bestScore) {
      bestStrategy = strategy;
      bestScore = score;
    }
    if (score > 0) {
      anyMatch = true;
    }
  }

  // Fallback: if no tags match at all → differentiation (most universal)
  if (!anyMatch) {
    const fallback = STRATEGY_LIBRARY.find((s) => s.id === "differentiation");
    bestStrategy = fallback ?? firstStrategy;
    bestScore = 0;
  }

  // Cap fitScore at 1.0
  const fitScore = Math.min(bestScore, 1.0);

  return {
    strategy: bestStrategy,
    rationale: `Стратегия «${bestStrategy.name}» выбрана на основе профиля ниши: [${input.nicheTags.join(", ")}]. Соответствие тегам: ${(fitScore * 100).toFixed(0)}%.`,
    fitScore,
    confidence: "initial",
    calibrationNote:
      "Начальная стратегия подобрана по профилю плана. Уточнится после накопления фактических данных.",
  };
}
