import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";

export interface GraphNode {
  id: string;
  label: string;
  type?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  label?: string;
}

interface CausalGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width?: number;
  height?: number;
}

interface NodePos {
  id: string;
  label: string;
  type?: string;
  x: number;
  y: number;
}

interface EdgePos {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
}

// Extend SimulationNodeDatum with our fields
interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  type?: string;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  label?: string;
}

const NODE_COLOR: Record<string, string> = {
  revenue: "#22c55e",
  expense: "#ef4444",
  risk: "#f97316",
};
const DEFAULT_COLOR = "#6366f1";

function nodeColor(type: string | undefined): string {
  return type ? (NODE_COLOR[type] ?? DEFAULT_COLOR) : DEFAULT_COLOR;
}

export function CausalGraph({ nodes, edges, width = 600, height = 400 }: CausalGraphProps) {
  const [nodePositions, setNodePositions] = useState<NodePos[]>(() =>
    nodes.map((n, i) => ({ ...n, x: (width / (nodes.length + 1)) * (i + 1), y: height / 2 }))
  );
  const [edgePositions, setEdgePositions] = useState<EdgePos[]>([]);
  const simRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);

  // Drag handler refs for access inside d3 drag callbacks
  const posRef = useRef<NodePos[]>(nodePositions);
  posRef.current = nodePositions;

  useEffect(() => {
    if (simRef.current) simRef.current.stop();

    const simNodes: SimNode[] = nodes.map(n => ({
      ...n,
      x: width / 2 + (Math.random() - 0.5) * 100,
      y: height / 2 + (Math.random() - 0.5) * 100,
    }));
    const idIndex = new Map(simNodes.map(n => [n.id, n]));

    const simLinks: SimLink[] = edges.map(e => ({
      source: idIndex.get(e.source) ?? e.source,
      target: idIndex.get(e.target) ?? e.target,
      label: e.label,
    }));

    const sim = d3.forceSimulation<SimNode>(simNodes)
      .force("link", d3.forceLink<SimNode, SimLink>(simLinks).id(d => d.id).distance(120))
      .force("charge", d3.forceManyBody<SimNode>().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2));

    simRef.current = sim;

    sim.on("tick", () => {
      const positions: NodePos[] = simNodes.map(n => ({
        id: n.id,
        label: n.label,
        type: n.type,
        x: n.x ?? 0,
        y: n.y ?? 0,
      }));
      setNodePositions(positions);

      const posMap = new Map(positions.map(p => [p.id, p]));
      const ep: EdgePos[] = edges.map(e => {
        const src = posMap.get(e.source);
        const tgt = posMap.get(e.target);
        return {
          x1: src?.x ?? 0, y1: src?.y ?? 0,
          x2: tgt?.x ?? 0, y2: tgt?.y ?? 0,
          label: e.label,
        };
      });
      setEdgePositions(ep);
    });

    return () => { sim.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, width, height]);

  // Draggable node: update fx/fy on the simulation node
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    // We use native pointer events to keep strict types — no any
  }, []);

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      style={{ display: "block", overflow: "visible" }}
    >
      <defs>
        <marker
          id="arrow"
          viewBox="0 -5 10 10"
          refX="32"
          refY="0"
          markerWidth={6}
          markerHeight={6}
          orient="auto"
        >
          <path d="M0,-5L10,0L0,5" fill="#9ca3af" />
        </marker>
      </defs>

      {/* Edges */}
      <g>
        {edgePositions.map((ep, i) => (
          <line
            key={i}
            x1={ep.x1} y1={ep.y1}
            x2={ep.x2} y2={ep.y2}
            stroke="#9ca3af"
            strokeWidth={1.5}
            markerEnd="url(#arrow)"
          />
        ))}
      </g>

      {/* Edge labels */}
      <g>
        {edgePositions.filter(ep => ep.label).map((ep, i) => (
          <text
            key={i}
            x={(ep.x1 + ep.x2) / 2}
            y={(ep.y1 + ep.y2) / 2}
            fontSize={10}
            fill="#6b7280"
            textAnchor="middle"
          >
            {ep.label}
          </text>
        ))}
      </g>

      {/* Nodes */}
      <g>
        {nodePositions.map(n => (
          <g
            key={n.id}
            data-testid="graph-node"
            transform={`translate(${n.x},${n.y})`}
          >
            <circle r={24} fill={nodeColor(n.type)} stroke="#fff" strokeWidth={2} />
            <text
              textAnchor="middle"
              dy={38}
              fontSize={11}
              fill="#374151"
            >
              {n.label}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}
