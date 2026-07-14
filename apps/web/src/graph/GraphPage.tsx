import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase.js";
import { useAuth } from "../auth/useAuth.js";
import { CausalGraph } from "./CausalGraph.js";
import type { GraphNode, GraphEdge } from "./CausalGraph.js";

const LEGEND: Array<{ color: string; label: string }> = [
  { color: "#22c55e", label: "Выручка"  },
  { color: "#ef4444", label: "Расходы"  },
  { color: "#f97316", label: "Риск"     },
  { color: "#6366f1", label: "Прочее"   },
];

interface CausalGraphDoc {
  nodes?: Array<{ id: string; label: string; type?: string }>;
  edges?: Array<{ source: string; target: string; label?: string }>;
}

export function GraphPage() {
  const { businessId } = useAuth();
  const [nodes, setNodes] = useState<GraphNode[] | null>(null);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) { setLoading(false); return; }
    const ref = doc(db, "tenants", businessId, "_meta", "causal_graph");
    getDoc(ref)
      .then(snap => {
        if (snap.exists()) {
          const data = snap.data() as CausalGraphDoc;
          setNodes((data.nodes ?? []).map(n => ({ id: n.id, label: n.label, type: n.type })));
          setEdges((data.edges ?? []).map(e => ({ source: e.source, target: e.target, label: e.label })));
        } else {
          setNodes([]);
        }
      })
      .catch(() => setNodes([]))
      .finally(() => setLoading(false));
  }, [businessId]);

  if (loading) {
    return <div style={{ padding: 32, color: "#8B7355", fontSize: 13 }}>Загрузка графа…</div>;
  }

  if (!nodes || nodes.length === 0) {
    return (
      <div style={{ padding: "48px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🔗</div>
        <h3 style={{ margin: "0 0 8px", fontSize: 16, color: "#1A1814" }}>Граф соберётся после накопления фактов</h3>
        <p style={{ margin: 0, fontSize: 13, color: "#8B7355" }}>
          Внесите события через голосовой ввод или загрузку документов — система построит причинно-следственную карту автоматически.
        </p>
      </div>
    );
  }

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
        <CausalGraph nodes={nodes} edges={edges} width={600} height={380} />
      </div>
    </div>
  );
}
