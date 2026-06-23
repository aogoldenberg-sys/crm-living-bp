import { useState } from "react";
import { useAuth } from "../auth/useAuth";
import { useFunnelConfig } from "./useFunnelConfig";
import { useFunnelMetrics } from "./useFunnelMetrics";
import { usePipeline } from "./usePipeline";
import { postEvents } from "./ingestClient";
import type { Deal, FunnelStage, StageMetrics } from "./types";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Форматирует копейки в рубли: 1_000_000 → "10 000 ₽" */
function formatRub(kopecks: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(kopecks / 100);
}

/** Форматирует конверсию. null → "—" */
function fmtConv(v: number | null): string {
  if (v === null) return "—";
  return `${Math.round(v * 100)}%`;
}

// ── DealCard ─────────────────────────────────────────────────────────────────

interface DealCardProps {
  deal: Deal;
  normDays: number;
  isTerminal: boolean;
  stages: FunnelStage[];
  onMove: (deal: Deal, toStage: string) => Promise<void>;
  moving: boolean;
  ownerId: string; // текущего пользователя
}

function DealCard({ deal, normDays, isTerminal, stages, onMove, moving, ownerId }: DealCardProps) {
  const isStuck = !isTerminal && deal.daysInStage > normDays;
  const isMine = deal.ownerId === ownerId;

  const [expanded, setExpanded] = useState(false);

  const currentIdx = stages.findIndex((s) => s.id === deal.currentStage);
  const prevStage = currentIdx > 0 ? stages[currentIdx - 1] : null;
  const nextStage = currentIdx < stages.length - 1 ? stages[currentIdx + 1] : null;

  return (
    <div
      className={`deal-card${isStuck ? " deal-stuck" : ""}${isMine ? " deal-mine" : ""}`}
      onClick={() => setExpanded((e) => !e)}
      role="button"
      aria-expanded={expanded}
    >
      <div className="deal-card-row">
        <span className="deal-amount">{formatRub(deal.amount)}</span>
        {isStuck && <span className="chip chip-red">Застряла</span>}
      </div>
      <div className="deal-days">
        {deal.daysInStage} дн. {isTerminal ? "" : `/ норма ${normDays} дн.`}
      </div>

      {expanded && (
        <div className="deal-actions" onClick={(e) => e.stopPropagation()}>
          <div className="deal-meta">
            <span className="deal-meta-label">Контрагент</span>
            <span>—</span>
          </div>
          <div className="deal-meta">
            <span className="deal-meta-label">Вер-ть</span>
            <span>{Math.round(deal.probability * 100)}%</span>
          </div>
          {deal.expectedCloseDate && (
            <div className="deal-meta">
              <span className="deal-meta-label">Закрытие</span>
              <span>{deal.expectedCloseDate}</span>
            </div>
          )}
          <div className="deal-move-btns">
            {prevStage && (
              <button
                className="btn-move btn-move-left"
                disabled={moving}
                onClick={() => void onMove(deal, prevStage.id)}
              >
                ← {prevStage.name}
              </button>
            )}
            {nextStage && !isTerminal && (
              <button
                className="btn-move btn-move-right"
                disabled={moving}
                onClick={() => void onMove(deal, nextStage.id)}
              >
                {nextStage.name} →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── StageColumn ───────────────────────────────────────────────────────────────

interface StageColumnProps {
  stage: FunnelStage;
  metrics: StageMetrics | undefined;
  deals: Deal[];
  stages: FunnelStage[];
  onMove: (deal: Deal, toStage: string) => Promise<void>;
  movingId: string | null;
  ownerId: string;
  filterMine: boolean;
}

function StageColumn({ stage, metrics, deals, stages, onMove, movingId, ownerId, filterMine }: StageColumnProps) {
  const visible = filterMine ? deals.filter((d) => d.ownerId === ownerId) : deals;

  const convBad =
    !stage.terminal &&
    metrics &&
    metrics.factConversion < metrics.normConversion * 0.8;

  return (
    <div className="pipeline-column">
      <div className="pipeline-col-header">
        <span className="pipeline-col-name">{stage.name}</span>
        <span className="pipeline-col-count">{visible.length}</span>
      </div>

      {metrics && !stage.terminal && (
        <div className={`pipeline-col-conv${convBad ? " conv-bad" : ""}`}>
          <span title="Snapshot-конверсия">
            Конв: <b>{fmtConv(metrics.factConversion)}</b>
          </span>
          {metrics.cohortConversion !== null && (
            <span title="Когортная конверсия за 30 дней">
              {" "}/ когорта: <b>{fmtConv(metrics.cohortConversion)}</b>
            </span>
          )}
          <span className="conv-norm"> норма {fmtConv(metrics.normConversion)}</span>
        </div>
      )}

      <div className="pipeline-cards">
        {visible.length === 0 ? (
          <p className="pipeline-empty">Нет сделок</p>
        ) : (
          visible.map((deal) => (
            <DealCard
              key={deal.dealId}
              deal={deal}
              normDays={stage.normDays}
              isTerminal={stage.terminal}
              stages={stages}
              onMove={onMove}
              moving={movingId === deal.dealId}
              ownerId={ownerId}
            />
          ))
        )}
      </div>

      {metrics && !stage.terminal && metrics.weightedPipeline > 0 && (
        <div className="pipeline-col-pipeline">
          Взвешено: {formatRub(metrics.weightedPipeline)}
        </div>
      )}
    </div>
  );
}

// ── PipelinePanel ─────────────────────────────────────────────────────────────

interface PipelinePanelProps {
  /** Если true — показывать только свои сделки (для роли менеджер). */
  filterMine?: boolean;
}

export function PipelinePanel({ filterMine = false }: PipelinePanelProps) {
  const { businessId, user } = useAuth();
  const bid = businessId ?? "";

  const { data: funnel } = useFunnelConfig(bid);
  const { data: metrics } = useFunnelMetrics(bid);
  const { data: dealsMap } = usePipeline(bid);

  const [movingId, setMovingId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  // ownerId берём из uid токена (совпадает с ownerId сделок для текущего тенанта)
  const ownerId = user?.uid ?? "";

  async function handleMove(deal: Deal, toStage: string) {
    if (!businessId) return;
    setMovingId(deal.dealId);
    setMoveError(null);
    try {
      await postEvents([
        {
          type: "deal_stage_changed",
          eventId: crypto.randomUUID(),
          ts: new Date().toISOString(),
          dealId: deal.dealId,
          leadId: crypto.randomUUID(),
          fromStage: deal.currentStage,
          toStage,
          funnelId: deal.funnelId,
          estimatedAmount: deal.amount,
          probability: deal.probability,
          expectedCloseDate: deal.expectedCloseDate,
          expectedPaymentDate: deal.expectedPaymentDate,
          clientId: deal.clientId,
          ownerId: deal.ownerId,
          counterpartyInn: null,
          counterpartyName: "—",
          managerId: deal.ownerId,
          source: "manual",
          businessId,
        },
      ]);
      // Проекция обновится через compute cron; onSnapshot поймает когда придёт.
    } catch (e) {
      setMoveError(e instanceof Error ? e.message : String(e));
    } finally {
      setMovingId(null);
    }
  }

  // ── Loading / empty states ────────────────────────────────────────────────

  if (funnel === undefined) {
    return (
      <div className="panel pipeline-panel">
        <p className="panel-title">Воронка продаж</p>
        <p className="loading">Загрузка…</p>
      </div>
    );
  }

  if (funnel === null) {
    return (
      <div className="panel pipeline-panel">
        <p className="panel-title">Воронка продаж</p>
        <p className="loading">Воронка не настроена</p>
      </div>
    );
  }

  const deals = dealsMap ?? new Map<string, Deal>();
  const totalStuck = metrics?.stages.reduce((n, s) => n + s.stuck.length, 0) ?? 0;
  const hasDeals = deals.size > 0;

  return (
    <div className="panel pipeline-panel">
      <div className="pipeline-header">
        <p className="panel-title">Воронка продаж — {funnel.name}</p>
        <div className="pipeline-summary">
          <span>{hasDeals ? `${deals.size} сделок` : "нет сделок"}</span>
          {totalStuck > 0 && (
            <span className="chip chip-red">{totalStuck} застряли</span>
          )}
          {metrics && (
            <span className="pipeline-total">
              Взвешено: {formatRub(metrics.totalWeightedPipeline)}
            </span>
          )}
        </div>
      </div>

      {moveError && (
        <div className="error-banner">
          Ошибка перемещения: {moveError}
        </div>
      )}

      {!hasDeals && (
        <div className="pipeline-zero-state">
          Сделок пока нет. Они появятся после первого события в воронке.
        </div>
      )}

      <div className="pipeline-board">
        {funnel.stages.map((stage) => {
          const stageDeals = [...deals.values()].filter(
            (d) => d.currentStage === stage.id,
          );
          const stageMetrics = metrics?.stages.find(
            (s) => s.stageId === stage.id,
          );
          return (
            <StageColumn
              key={stage.id}
              stage={stage}
              metrics={stageMetrics}
              deals={stageDeals}
              stages={funnel.stages}
              onMove={handleMove}
              movingId={movingId}
              ownerId={ownerId}
              filterMine={filterMine}
            />
          );
        })}
      </div>
    </div>
  );
}
