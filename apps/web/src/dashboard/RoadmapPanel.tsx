/**
 * RoadmapPanel — дорожная карта с ИД-логикой (A1/A2/A3).
 *
 * Центр дашборда когда нет фактических сделок.
 * Строится детерминированно из intake-оценки, без Claude.
 */

import { useMemo } from "react";
import { buildRoadmap } from "@crm/core";
import type { Roadmap, RoadmapItem } from "@crm/core";
import type { PlanIntake } from "./useIntake";

// ── Автономия-бейджи ──────────────────────────────────────────────────────────

const AUTONOMY_LABEL: Record<string, string> = {
  A1: "к сведению",
  A2: "авто",
  A3: "ждёт решения",
};

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

function AutonomyBadge({ autonomy }: { autonomy: string }) {
  return (
    <span className={`rm-badge rm-badge--${autonomy.toLowerCase()}`}>
      {AUTONOMY_LABEL[autonomy] ?? autonomy}
    </span>
  );
}

// ── Один пункт карты ──────────────────────────────────────────────────────────

function RoadmapRow({ item, active }: { item: RoadmapItem; active: boolean }) {
  return (
    <div className={`rm-row${active ? " rm-row--active" : ""} rm-row--${item.priority}`}>
      <div className="rm-row-left">
        <span className={`rm-dot rm-dot--${item.priority}`} />
      </div>
      <div className="rm-row-body">
        <div className="rm-row-title">{item.title}</div>
        {item.description && (
          <div className="rm-row-desc">{item.description}</div>
        )}
        <div className="rm-row-action">{item.action}</div>
      </div>
      <div className="rm-row-right">
        <AutonomyBadge autonomy={item.autonomy} />
      </div>
    </div>
  );
}

// ── Панель ────────────────────────────────────────────────────────────────────

interface Props {
  intake: PlanIntake | null | undefined;
  businessId: string;
  /** true если API-кредиты Claude пополнены (включает A3) */
  creditsAvailable?: boolean;
}

export function RoadmapPanel({ intake, businessId, creditsAvailable = false }: Props) {
  const roadmap: Roadmap | null = useMemo(() => {
    if (!intake) return null;
    return buildRoadmap({
      businessId,
      assessment: {
        concerns: intake.assessment.concerns,
        gaps: intake.assessment.gaps,
      },
      confidence: 0.86, // TODO: взять из intake.confidence когда поле появится
      milestones: [],   // milestones извлекаются Claude — пока пусто честно
      creditsAvailable,
    });
  }, [intake, businessId, creditsAvailable]);

  if (!roadmap) {
    return (
      <div className="rm-empty">
        <p className="rm-empty-title">Дорожная карта недоступна</p>
        <p className="rm-empty-sub">
          Загрузите бизнес-план и запустите оценку — карта появится автоматически.
        </p>
      </div>
    );
  }

  const refinement = roadmap.items
    .filter((i: RoadmapItem) => i.phase === "refinement")
    .sort((a: RoadmapItem, b: RoadmapItem) => PRIORITY_ORDER[a.priority]! - PRIORITY_ORDER[b.priority]!);

  const execution = roadmap.items.filter((i: RoadmapItem) => i.phase === "execution");
  const firstPending = refinement.find((i: RoadmapItem) => i.status === "pending") ?? refinement[0];

  return (
    <div className="rm-panel">
      {/* Текущий шаг — крупно */}
      {firstPending && (
        <div className="rm-current-step">
          <span className="rm-current-label">Сейчас</span>
          <span className="rm-current-title">{firstPending.title}</span>
          <AutonomyBadge autonomy={firstPending.autonomy} />
        </div>
      )}

      {/* Фаза ДОРАБОТКА */}
      {refinement.length > 0 && (
        <section className="rm-phase">
          <h3 className="rm-phase-title">
            Доработка плана
            <span className="rm-phase-count">{refinement.length}</span>
          </h3>
          <div className="rm-rows">
            {refinement.map((item: RoadmapItem) => (
              <RoadmapRow
                key={item.id}
                item={item}
                active={item.id === firstPending?.id}
              />
            ))}
          </div>
        </section>
      )}

      {/* Фаза РЕАЛИЗАЦИЯ */}
      <section className="rm-phase">
        <h3 className="rm-phase-title">
          Реализация
          {execution.length > 0 && (
            <span className="rm-phase-count">{execution.length}</span>
          )}
        </h3>
        {execution.length > 0 ? (
          <div className="rm-rows">
            {execution.map((item: RoadmapItem) => (
              <RoadmapRow key={item.id} item={item} active={false} />
            ))}
          </div>
        ) : (
          <p className="rm-exec-empty">{roadmap.executionEmptyReason}</p>
        )}
      </section>
    </div>
  );
}
