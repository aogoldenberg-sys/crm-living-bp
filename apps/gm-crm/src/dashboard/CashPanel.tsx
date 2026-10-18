import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { CashForecast } from "./useForecast";

interface Props {
  forecast: CashForecast | null | undefined;
}

function kopecksToRubles(kopecks: number): number {
  return kopecks / 100;
}

function formatRubles(value: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(value);
}

export function CashPanel({ forecast }: Props) {
  if (forecast === undefined) {
    return (
      <div className="panel">
        <p className="panel-title">Прогноз денежного потока</p>
        <p className="loading">Загрузка...</p>
      </div>
    );
  }
  if (forecast === null) {
    return (
      <div className="panel">
        <p className="panel-title">Прогноз денежного потока</p>
        <p className="loading">Прогноз не рассчитан</p>
      </div>
    );
  }

  const data = forecast.dailyBalances.slice(0, 90).map((d) => ({
    date: d.date,
    p10: kopecksToRubles(d.p10),
    p50: kopecksToRubles(d.p50),
    p90: kopecksToRubles(d.p90),
  }));

  return (
    <div className="panel">
      <p className="panel-title">
        Прогноз денежного потока
        <span style={{ marginLeft: 8, color: "var(--text-muted)", fontWeight: 400 }}>
          (достоверность {Math.round(forecast.confidence * 100)}%)
        </span>
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10, fill: "var(--text-muted)" }}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}к`}
            tick={{ fontSize: 10, fill: "var(--text-muted)" }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            formatter={(value: number) => formatRubles(value)}
            contentStyle={{
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              color: "var(--text)",
              fontSize: 12,
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, color: "var(--text-muted)" }}
          />
          <Line
            type="monotone"
            dataKey="p10"
            name="P10 (пессимизм)"
            stroke="#e74c3c"
            strokeWidth={1.5}
            strokeDasharray="4 2"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="p50"
            name="P50 (базовый)"
            stroke="#3498db"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="p90"
            name="P90 (оптимизм)"
            stroke="#2ecc71"
            strokeWidth={1.5}
            strokeDasharray="4 2"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
