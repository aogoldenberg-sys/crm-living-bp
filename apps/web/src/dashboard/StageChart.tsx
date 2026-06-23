import type { StageMetrics } from "../funnel/types";

interface StageChartProps {
  stages: StageMetrics[];
}

export function StageChart({ stages }: StageChartProps) {
  const visible = stages.slice(0, 6);
  const maxCount = Math.max(...visible.map((s) => s.count), 1);

  return (
    <div className="stage-chart-card">
      <div className="stage-chart-header">
        <span className="stage-chart-title">Этапы</span>
        <span className="stage-chart-total">{stages.reduce((s, x) => s + x.count, 0)} сд.</span>
      </div>
      <div className="stage-chart-bars">
        {visible.map((s) => (
          <div key={s.stageId} className="stage-chart-col">
            <div className="stage-chart-track">
              <div
                className={`stage-chart-fill${s.stuck.length > 0 ? " stage-chart-fill--stuck" : ""}`}
                style={{ height: `${Math.max((s.count / maxCount) * 100, 8)}%` }}
              />
            </div>
            <span className="stage-chart-num">{s.count}</span>
          </div>
        ))}
      </div>
      <div className="stage-chart-labels">
        {visible.map((s) => (
          <span key={s.stageId} className="stage-chart-label" title={s.stageName}>
            {s.stageName.slice(0, 3)}
          </span>
        ))}
      </div>
    </div>
  );
}
