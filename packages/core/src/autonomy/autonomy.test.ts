import { describe, it, expect } from "vitest";
import { canExecute } from "./gate.js";
import { appendEntry } from "./journal.js";
import type { ActionRequest, AutonomyLimits } from "@crm/schemas";
import type { DecisionOutput } from "../risk/index.js";

// Helper to build a mock DecisionOutput matching the real DecisionOutput shape
function mockRisk(completeness: number): DecisionOutput {
  const isLow = completeness < 0.9;
  return {
    inputsRequired: isLow ? ["missing_cashflow"] : [],
    inputsPresent: [],
    completeness,
    confidence: 0.95,
    verdict: isLow ? "insufficient_data" : "act",
    gaps: isLow ? ["missing_cashflow"] : [],
    trail: isLow
      ? [
          {
            inputs: [],
            rule: "completeness < 0.9 — missing: [missing_cashflow]",
            verdict: "insufficient_data" as const,
          },
        ]
      : [
          {
            inputs: [],
            rule: "completeness >= 0.9, confidence >= 0.8",
            verdict: "act" as const,
          },
        ],
  };
}

const baseLimits: AutonomyLimits = {
  level: "A2",
  maxBudgetShiftKopecks: 100_000_00, // 100k rub
  allowedActions: ["add_expense", "update_deal"],
  requireConfirmationFor: [],
};

const baseAction: ActionRequest = {
  actionId: "00000000-0000-4000-8000-000000000001",
  actionType: "add_expense",
  requiredLevel: "A2",
  budgetShiftKopecks: 50_000_00,
  isLegallySignificant: false,
};

describe("canExecute", () => {
  it("A2 within limits → execute", () => {
    const result = canExecute(baseAction, baseLimits, mockRisk(0.95));
    expect(result.verdict).toBe("execute");
  });

  it("A2 exceeds budget limit → ask_human", () => {
    const action = { ...baseAction, budgetShiftKopecks: 200_000_00 };
    const result = canExecute(action, baseLimits, mockRisk(0.95));
    expect(result.verdict).toBe("ask_human");
    expect(result.reason).toMatch(/лимит/i);
  });

  it("A3 ceiling for legally significant action → ask_human", () => {
    const legalAction = { ...baseAction, isLegallySignificant: true };
    const limitsA3 = {
      ...baseLimits,
      level: "A3" as const,
      allowedActions: ["add_expense", "update_deal", "contract_sign"],
    };
    const result = canExecute(legalAction, limitsA3, mockRisk(0.95));
    expect(result.verdict).toBe("ask_human");
    expect(result.reason).toMatch(/юридически/i);
  });

  it("low completeness → insufficient_data", () => {
    const result = canExecute(baseAction, baseLimits, mockRisk(0.7));
    expect(result.verdict).toBe("insufficient_data");
    expect(result.missingData).toBeDefined();
  });

  it("action type not in allowedActions → ask_human", () => {
    const action = { ...baseAction, actionType: "adjust_plan" };
    const result = canExecute(action, baseLimits, mockRisk(0.95));
    expect(result.verdict).toBe("ask_human");
  });

  it("configured level below required level → ask_human", () => {
    const action = { ...baseAction, requiredLevel: "A3" as const };
    const result = canExecute(action, baseLimits, mockRisk(0.95)); // baseLimits.level = A2
    expect(result.verdict).toBe("ask_human");
  });
});

describe("appendEntry", () => {
  it("creates a valid JournalEntry with applied=true for execute", () => {
    const entry = appendEntry(baseAction, baseLimits, mockRisk(0.95), "execute", "OK");
    expect(entry.applied).toBe(true);
    expect(entry.verdict).toBe("execute");
    expect(entry.entryId).toMatch(/^[0-9a-f-]{36}$/);
    expect(entry.inputs.completeness).toBe(0.95);
  });

  it("creates entry with applied=false for ask_human", () => {
    const entry = appendEntry(baseAction, baseLimits, mockRisk(0.95), "ask_human", "needs confirm");
    expect(entry.applied).toBe(false);
  });
});
