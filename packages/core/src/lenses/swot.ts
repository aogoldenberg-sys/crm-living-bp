import type { SwotInput, SwotStructure, SwotItem } from "./types.js";
import type { CausalGraph } from "@crm/schemas";
import { deriveSWOT } from "../causal/index.js";

// ── Thresholds ────────────────────────────────────────────────────────────────

const MARGIN_STRENGTH_THRESHOLD = 0.20;
const MARGIN_WEAKNESS_THRESHOLD = 0.05;
const GROWTH_STRENGTH_THRESHOLD = 0.10;
const LTV_CAC_STRENGTH_THRESHOLD = 3;
const CONCENTRATION_WEAKNESS_THRESHOLD = 0.60;
const VELOCITY_WEAKNESS_THRESHOLD = 90;
const PAYBACK_WEAKNESS_THRESHOLD = 24;

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Compute SWOT structure from available signal metrics.
 *
 * Returns null (confidence gate) when ALL input fields are undefined/null —
 * the lens is silent when there is no data to reason from.
 *
 * Opportunities and threats are always empty arrays (stubs for §11).
 */
export function computeSwotStructure(
  input: SwotInput,
  graph?: CausalGraph,
): SwotStructure | null {
  // Confidence gate: nothing to work with
  const hasData =
    input.revenueGrowthRate !== undefined ||
    input.marginPercent !== undefined ||
    input.topClientConcentration !== undefined ||
    input.dealVelocityDays !== undefined ||
    input.ltvCacRatio !== undefined ||
    (input.paybackMonths !== undefined && input.paybackMonths !== null);

  if (!hasData) return null;

  const strengths: SwotItem[] = [];
  const weaknesses: SwotItem[] = [];

  // ── Strengths ─────────────────────────────────────────────────────────────

  if (
    input.marginPercent !== undefined &&
    input.marginPercent > MARGIN_STRENGTH_THRESHOLD
  ) {
    strengths.push({
      signal: "Маржа выше порога",
      detail: `Маржа ${Math.round(input.marginPercent * 100)}% — выше ${MARGIN_STRENGTH_THRESHOLD * 100}%`,
      source: "marginPercent",
    });
  }

  if (
    input.revenueGrowthRate !== undefined &&
    input.revenueGrowthRate > GROWTH_STRENGTH_THRESHOLD
  ) {
    strengths.push({
      signal: "Рост выручки",
      detail: `MoM рост ${Math.round(input.revenueGrowthRate * 100)}%`,
      source: "revenueGrowthRate",
    });
  }

  if (
    input.ltvCacRatio !== undefined &&
    input.ltvCacRatio > LTV_CAC_STRENGTH_THRESHOLD
  ) {
    strengths.push({
      signal: "LTV/CAC > 3x",
      detail: `LTV/CAC = ${input.ltvCacRatio.toFixed(1)}x`,
      source: "ltvCacRatio",
    });
  }

  // ── Weaknesses ───────────────────────────────────────────────────────────

  if (
    input.marginPercent !== undefined &&
    input.marginPercent < MARGIN_WEAKNESS_THRESHOLD
  ) {
    weaknesses.push({
      signal: "Низкая маржа",
      detail: `Маржа ${Math.round(input.marginPercent * 100)}% — ниже ${MARGIN_WEAKNESS_THRESHOLD * 100}%`,
      source: "marginPercent",
    });
  }

  if (
    input.topClientConcentration !== undefined &&
    input.topClientConcentration > CONCENTRATION_WEAKNESS_THRESHOLD
  ) {
    weaknesses.push({
      signal: "Высокая концентрация (топ-3 клиента > 60%)",
      detail: `Топ-3 клиента: ${Math.round(input.topClientConcentration * 100)}% выручки`,
      source: "topClientConcentration",
    });
  }

  if (
    input.dealVelocityDays !== undefined &&
    input.dealVelocityDays > VELOCITY_WEAKNESS_THRESHOLD
  ) {
    weaknesses.push({
      signal: "Долгий цикл сделки (>90 дн)",
      detail: `Средний цикл: ${Math.round(input.dealVelocityDays)} дней`,
      source: "dealVelocityDays",
    });
  }

  if (
    input.paybackMonths !== undefined &&
    input.paybackMonths !== null &&
    input.paybackMonths > PAYBACK_WEAKNESS_THRESHOLD
  ) {
    weaknesses.push({
      signal: "Долгий payback (>24 мес)",
      detail: `Payback: ${Math.round(input.paybackMonths)} мес.`,
      source: "paybackMonths",
    });
  }

  if (graph) {
    const graphSwot = deriveSWOT(graph);
    return {
      strengths,
      weaknesses,
      opportunities: graphSwot.opportunities,
      threats: graphSwot.threats,
    };
  }

  return {
    strengths,
    weaknesses,
    opportunities: [], // stub — §11
    threats: [],       // stub — §11
  };
}
