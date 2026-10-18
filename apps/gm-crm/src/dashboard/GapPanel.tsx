import type { CashForecast } from "./useForecast";

interface Props {
  forecast: CashForecast | null | undefined;
}

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  const diff = target.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(dateStr));
}

function formatRubles(kopecks: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(kopecks / 100);
}

export function GapPanel({ forecast }: Props) {
  if (forecast === undefined) {
    return (
      <div className="panel">
        <p className="panel-title">Кассовый разрыв</p>
        <p className="loading">Загрузка...</p>
      </div>
    );
  }
  if (forecast === null) {
    return (
      <div className="panel">
        <p className="panel-title">Кассовый разрыв</p>
        <p className="loading">Нет данных о прогнозе</p>
      </div>
    );
  }

  const { gapDate, gapAmount } = forecast;

  if (gapDate === null) {
    return (
      <div className="panel">
        <p className="panel-title">Кассовый разрыв</p>
        <p className="gap-value gap-green">Нет</p>
        <p className="gap-label" style={{ color: "var(--green)" }}>
          Кассового разрыва нет (горизонт 90 дней)
        </p>
      </div>
    );
  }

  const days = daysUntil(gapDate);
  const colorClass = days <= 30 ? "gap-red" : "gap-yellow";

  return (
    <div className="panel">
      <p className="panel-title">Кассовый разрыв</p>
      <p className={`gap-value ${colorClass}`}>{days} дн.</p>
      <p className="gap-label">
        {formatDate(gapDate)}
        {gapAmount !== null && gapAmount !== undefined && (
          <> &mdash; дефицит {formatRubles(gapAmount)}</>
        )}
      </p>
      {days <= 30 && (
        <p
          style={{
            marginTop: 12,
            color: "var(--red)",
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          Критично: менее 30 дней до разрыва
        </p>
      )}
    </div>
  );
}
