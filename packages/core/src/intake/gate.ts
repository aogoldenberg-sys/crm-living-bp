import type { MappedSection } from "@crm/schemas";
import type { Verdict, TrailStep } from "../risk/index.js";
import { decide } from "../risk/index.js";

/**
 * Прогоняет набор секций через confidence gate.
 *
 * inputsRequired = все 22 sectionId
 * inputsPresent  = sectionId где present = true
 * confidence     = среднее MappedSection.confidence по присутствующим секциям
 *                  (0 если ни одна секция не присутствует)
 *
 * §20.4: disclaimer БЕЗУСЛОВНЫЙ — на intake факт-данных нет по определению,
 *        оценка всегда качественная, вне зависимости от полноты документа.
 *
 * §20.6: intake = A3 (советник). Потолок вердикта — "ask_human".
 *        Полный документ ≠ право действовать: подтвердить нечем.
 *        "act" недостижим: accept→v1 — действие человека, не системы.
 */
export function gateIntake(
  sections: MappedSection[],
  _businessId: string
): {
  verdict: Exclude<Verdict, "act">;
  confidence: number;
  disclaimer: string;
  trail: TrailStep[];
} {
  const inputsRequired = sections.map((s) => s.sectionId);
  const presentSections = sections.filter((s) => s.present);
  const inputsPresent = presentSections.map((s) => s.sectionId);

  const confidence =
    presentSections.length === 0
      ? 0
      : presentSections.reduce((sum, s) => sum + s.confidence, 0) /
        presentSections.length;

  const result = decide({ inputsRequired, inputsPresent, confidence });

  // §20.6: капаем на ask_human — intake никогда не даёт право действовать
  const verdict: Exclude<Verdict, "act"> =
    result.verdict === "act" ? "ask_human" : result.verdict;

  // §20.4: disclaimer всегда присутствует
  const disclaimer =
    "Оценка предварительная: факт-данных пока нет. Требуется подтверждение аналитиком.";

  return {
    verdict,
    confidence: result.confidence,
    disclaimer,
    trail: result.trail,
  };
}
