import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { CausalGraph } from "./CausalGraph.js";

// Chainable proxy — every d3 method returns itself so .force().force().on() chains work
const chain: Record<string, unknown> = {};
const proxy = new Proxy(chain, {
  get(_t, _prop) { return () => proxy; },
});

vi.mock("d3", () => ({
  forceSimulation: () => proxy,
  forceManyBody: () => proxy,
  forceLink: () => proxy,
  forceCenter: () => proxy,
  select: () => proxy,
  drag: () => proxy,
}));

describe("CausalGraph", () => {
  it("renders without crashing with empty data", () => {
    const { container } = render(<CausalGraph nodes={[]} edges={[]} />);
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("renders correct number of node groups", () => {
    const nodes = [
      { id: "a", label: "Alpha", type: "revenue" },
      { id: "b", label: "Beta",  type: "expense" },
    ];
    const { container } = render(<CausalGraph nodes={nodes} edges={[]} />);
    const nodeGroups = container.querySelectorAll("[data-testid='graph-node']");
    expect(nodeGroups.length).toBe(nodes.length);
  });
});
