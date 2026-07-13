import { CausalGraph } from "./CausalGraph.js";
import type { GraphNode, GraphEdge } from "./CausalGraph.js";

const DEMO_NODES: GraphNode[] = [
  { id: "traffic",  label: "Трафик",  type: "external" },
  { id: "leads",    label: "Лиды",    type: "metric"   },
  { id: "revenue",  label: "Выручка", type: "revenue"  },
  { id: "profit",   label: "Прибыль", type: "outcome"  },
  { id: "expenses", label: "Затраты", type: "expense"  },
];

const DEMO_EDGES: GraphEdge[] = [
  { source: "traffic",  target: "leads",   label: "+1" },
  { source: "leads",    target: "revenue"              },
  { source: "revenue",  target: "profit"               },
  { source: "expenses", target: "profit",  label: "-1" },
];

const LEGEND: Array<{ color: string; label: string }> = [
  { color: "#22c55e", label: "Выручка"    },
  { color: "#ef4444", label: "Расходы"    },
  { color: "#f97316", label: "Риск"       },
  { color: "#6366f1", label: "Прочее"     },
];

export function GraphPage() {
  return (
    <div style={{ padding: "24px 0" }}>
      <h2 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 700, color: "#1A1814" }}>
        Причинно-следственная карта
      </h2>
      <p style={{ margin: "0 0 20px", fontSize: 13, color: "#8B7355" }}>
        Граф связей между факторами бизнеса
      </p>

      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        {LEGEND.map(l => (
          <span key={l.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#374151" }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: l.color, flexShrink: 0 }} />
            {l.label}
          </span>
        ))}
      </div>

      <div style={{ background: "rgba(255,255,255,0.6)", borderRadius: 12, padding: 16, border: "1px solid rgba(0,0,0,0.08)" }}>
        <CausalGraph nodes={DEMO_NODES} edges={DEMO_EDGES} width={600} height={380} />
      </div>
    </div>
  );
}
