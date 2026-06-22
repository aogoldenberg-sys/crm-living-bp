/**
 * buildRoadmap — чистая функция, без побочных эффектов, без Claude.
 *
 * ФАЗА ДОРАБОТКА:
 *   concern (red/yellow) → «Закрыть риск: …», priority high/medium
 *   gap (отсутствующий раздел) → «Добавить раздел: …», priority low
 *
 * ФАЗА РЕАЛИЗАЦИЯ:
 *   milestones из business_plans.roadmap (если переданы)
 *   нет milestones → executionPhaseEmpty = true, честный пустой стейт
 *
 * Autonomy (§ ИД-логика):
 *   По умолчанию A1 («показывает»).
 *   A3 («предлагает») только при creditsAvailable=true И confidence≥0.9 (§14 gate).
 *   Execution-milestones → A2 («реализует»): детерминированный трекинг, без Claude.
 *
 * НЕ выдумывает milestones. Только из переданных данных.
 */

import type { Roadmap, RoadmapItem, Priority } from "./types.js";

// ── Input types ──────────────────────────────────────────────────────────────

export interface ConcernInput {
  description: string;
  severity: "red" | "yellow";
  rationale?: string;
}

export interface GapInput {
  missingSection: string;
  description?: string;
}

export interface MilestoneInput {
  id: string;
  title: string;
  date?: string;
  status?: string;
  critical?: boolean;
}

export interface BuildRoadmapInput {
  businessId: string;
  assessment: {
    concerns: ConcernInput[];
    gaps: GapInput[];
  };
  /** Из intake.confidence (0..1) — полнота покрытия плана. */
  confidence: number;
  /** Milestones из business_plans.roadmap (если есть). */
  milestones?: MilestoneInput[];
  /**
   * true = Claude-API доступен и можно генерировать draft.
   * false (по умолчанию) = кредиты исчерпаны, все пункты остаются A1.
   */
  creditsAvailable?: boolean;
}

// ── Pure function ────────────────────────────────────────────────────────────

export function buildRoadmap(input: BuildRoadmapInput): Roadmap {
  const {
    businessId,
    assessment,
    confidence,
    milestones,
    creditsAvailable = false,
  } = input;

  const items: RoadmapItem[] = [];

  // ── Фаза ДОРАБОТКА: concerns (высокий/средний приоритет) ─────────────────

  const PRIORITY_ORDER: Priority[] = ["high", "medium", "low"];

  const concernItems: RoadmapItem[] = assessment.concerns.map((concern, i) => {
    const priority: Priority = concern.severity === "red" ? "high" : "medium";
    // draft требует Claude → A3 при кредитах и confidence≥0.9 (§14)
    const canAct = creditsAvailable && confidence >= 0.9;
    const autonomy = canAct ? "A3" : "A1";
    const action = creditsAvailable
      ? "Предложу правку раздела плана — ожидает вашего «Принять»"
      : "Предложу правку раздела после пополнения API-кредитов";

    return {
      id: `refinement-concern-${i}`,
      phase: "refinement" as const,
      title: `Закрыть риск: ${concern.description}`,
      description: concern.rationale ?? concern.description,
      priority,
      autonomy,
      action,
      sourceRef: { type: "concern" as const, index: i },
      completenessRequired: 0.9,
      status: "pending" as const,
    };
  });

  // Сортируем concerns по приоритету: red (high) первыми
  concernItems.sort(
    (a, b) =>
      PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority),
  );

  items.push(...concernItems);

  // ── Фаза ДОРАБОТКА: gaps (низкий приоритет) ──────────────────────────────

  for (const [i, gap] of assessment.gaps.entries()) {
    const canAct = creditsAvailable && confidence >= 0.9;
    const autonomy = canAct ? "A3" : "A1";
    const action = creditsAvailable
      ? "Предложу черновик раздела — ожидает вашего «Принять»"
      : "Предложу черновик раздела после пополнения API-кредитов";

    items.push({
      id: `refinement-gap-${i}`,
      phase: "refinement" as const,
      title: `Добавить раздел: ${gap.missingSection}`,
      description: gap.description ?? `Раздел «${gap.missingSection}» отсутствует в плане`,
      priority: "low",
      autonomy,
      action,
      sourceRef: { type: "gap" as const, index: i },
      completenessRequired: 0.9,
      status: "pending" as const,
    });
  }

  // ── Фаза РЕАЛИЗАЦИЯ: milestones ───────────────────────────────────────────

  const hasMilestones = milestones && milestones.length > 0;

  if (hasMilestones) {
    for (const ms of milestones) {
      items.push({
        id: `execution-${ms.id}`,
        phase: "execution" as const,
        title: ms.title,
        description: ms.date ? `Срок: ${ms.date}` : "",
        priority: ms.critical ? "high" : "medium",
        autonomy: "A2", // детерминированный трекинг, не требует Claude
        action: "Фиксирую статус в журнале решений при изменении",
        sourceRef: { type: "milestone" as const, id: ms.id },
        completenessRequired: 0,
        status: ms.status === "done" ? "done" : "pending",
      });
    }
  }

  return {
    businessId,
    generatedAt: new Date().toISOString(),
    completeness: confidence,
    items,
    executionPhaseEmpty: !hasMilestones,
    executionEmptyReason: hasMilestones
      ? ""
      : "Шаги реализации появятся после доработки плана и первых фактов",
  };
}
