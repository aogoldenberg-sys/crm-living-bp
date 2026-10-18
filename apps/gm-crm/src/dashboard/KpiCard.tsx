interface KpiCardProps {
  title: string;
  value: string;
  sub?: string;
  detail?: string;
  color: "caramel" | "burgundy" | "teal" | "ivory" | "gold" | "charcoal" | "teal-dark";
  /** Маленькие бары-спарклайн (1–6 значений 0–1) */
  spark?: number[];
}

/** Мини бар-спарклайн */
function Spark({ values }: { values: number[] }) {
  const max = Math.max(...values, 0.01);
  return (
    <div className="kpi-spark" aria-hidden="true">
      {values.map((v, i) => (
        <div
          key={i}
          className="kpi-spark-bar"
          style={{ height: `${Math.round((v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

export function KpiCard({ title, value, sub, detail, color, spark }: KpiCardProps) {
  return (
    <div className={`kpi-card kpi-card--${color}`}>
      <div className="kpi-card-top">
        <span className="kpi-card-title">{title}</span>
        {detail && <span className="kpi-card-detail">{detail}</span>}
      </div>
      {spark ? (
        <div className="kpi-card-spark-row">
          <span className="kpi-card-value">{value}</span>
          <Spark values={spark} />
        </div>
      ) : (
        <span className="kpi-card-value">{value}</span>
      )}
      {sub && <span className="kpi-card-sub">{sub}</span>}
    </div>
  );
}
