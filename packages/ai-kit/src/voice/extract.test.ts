import { describe, it, expect, vi, beforeEach } from "vitest";
import { mapIntentToAction } from "@crm/core";
import type { VoiceExtractResult } from "@crm/schemas";

// ─── MOCK @anthropic-ai/sdk ─────────────────────────────────────────────────
// We mock the module so that `new Anthropic()` returns a controlled instance.
// The mock is hoisted by vitest — the factory runs before imports resolve.

const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

// Import AFTER mock is declared (vitest hoists vi.mock, so this is fine)
const { extractVoiceIntent } = await import("./extract.js");

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeApiResponse(payload: object) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
  };
}

// ─── extractVoiceIntent ──────────────────────────────────────────────────────

describe("extractVoiceIntent", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("positive: clear add_expense — high confidence", async () => {
    mockCreate.mockResolvedValueOnce(
      makeApiResponse({
        intent: "add_expense",
        diff: { category: "Аренда", amount: 50000 },
        confidence: 0.95,
        needsClarification: false,
      }),
    );

    const result = await extractVoiceIntent("Запиши аренду 50 тысяч", "test-key");

    expect(result.intent).toBe("add_expense");
    expect(result.confidence).toBe(0.95);
    expect(result.needsClarification).toBe(false);
    expect(result.rawTranscript).toBe("Запиши аренду 50 тысяч");
    expect(result.diff).toMatchObject({ category: "Аренда", amount: 50000 });
  });

  it("positive: update_deal — full diff", async () => {
    mockCreate.mockResolvedValueOnce(
      makeApiResponse({
        intent: "update_deal",
        diff: { dealId: "deal-42", amount: 1500000, stage: "negotiation" },
        confidence: 0.92,
        needsClarification: false,
      }),
    );

    const result = await extractVoiceIntent(
      "По сделке 42 поставь сумму 1.5 миллиона, стадия переговоры",
      "test-key",
    );

    expect(result.intent).toBe("update_deal");
    expect(result.needsClarification).toBe(false);
    expect(result.diff).toMatchObject({ dealId: "deal-42", amount: 1500000 });
  });

  it("negative: low confidence (0.6) → needsClarification forced true", async () => {
    mockCreate.mockResolvedValueOnce(
      makeApiResponse({
        intent: "add_expense",
        diff: { category: "Прочее", amount: 800 },
        confidence: 0.6,
        needsClarification: false, // Claude didn't set it, but we must force it
        clarificationQuestion: "800 тысяч или 800 рублей?",
      }),
    );

    const result = await extractVoiceIntent("Запиши 800", "test-key");

    expect(result.confidence).toBe(0.6);
    expect(result.needsClarification).toBe(true);
    expect(result.clarificationQuestion).toBeTruthy();
  });

  it("negative: low confidence without clarificationQuestion → fallback string", async () => {
    mockCreate.mockResolvedValueOnce(
      makeApiResponse({
        intent: "add_expense",
        diff: { category: "Прочее", amount: 100 },
        confidence: 0.5,
        needsClarification: false,
        // no clarificationQuestion in response
      }),
    );

    const result = await extractVoiceIntent("что-то непонятное", "test-key");

    expect(result.needsClarification).toBe(true);
    expect(result.clarificationQuestion).toBe("Уточните, пожалуйста.");
  });

  it("negative: Claude wraps JSON in ```json``` fences — strips correctly", async () => {
    const payload = {
      intent: "market_insight",
      diff: { text: "Конкурент снизил цены на 20%" },
      confidence: 0.9,
      needsClarification: false,
    };
    mockCreate.mockResolvedValueOnce({
      content: [{ type: "text", text: "```json\n" + JSON.stringify(payload) + "\n```" }],
    });

    const result = await extractVoiceIntent("конкурент снизил цены", "test-key");

    expect(result.intent).toBe("market_insight");
    expect(result.needsClarification).toBe(false);
  });

  it("negative: adjust_plan — confidence>=0.8, passes through", async () => {
    mockCreate.mockResolvedValueOnce(
      makeApiResponse({
        intent: "adjust_plan",
        diff: { description: "Перенести MVP на конец квартала", targetDate: "2026-09-30" },
        confidence: 0.88,
        needsClarification: false,
      }),
    );

    const result = await extractVoiceIntent(
      "Перенеси MVP на конец квартала",
      "test-key",
    );

    expect(result.intent).toBe("adjust_plan");
    expect(result.needsClarification).toBe(false);

    // mapIntentToAction should produce requiresConfirmation: true
    const action = mapIntentToAction(result);
    expect(action).not.toBeNull();
    if (action && action.type === "plan_adjustment") {
      expect(action.requiresConfirmation).toBe(true);
    }
  });
});

// ─── mapIntentToAction — pure function tests (no mocking needed) ─────────────

describe("mapIntentToAction", () => {
  const baseResult: Omit<VoiceExtractResult, "intent" | "diff"> = {
    confidence: 0.95,
    needsClarification: false,
    rawTranscript: "тестовый транскрипт",
  };

  it("update_deal → DealPatch", () => {
    const result: VoiceExtractResult = {
      ...baseResult,
      intent: "update_deal",
      diff: { dealId: "deal-1", amount: 100000, stage: "won" },
    };
    const action = mapIntentToAction(result);
    expect(action).toEqual({
      type: "deal_patch",
      dealId: "deal-1",
      amount: 100000,
      paymentDelay: undefined,
      stage: "won",
    });
  });

  it("add_expense → ExpenseEvent", () => {
    const result: VoiceExtractResult = {
      ...baseResult,
      intent: "add_expense",
      diff: { category: "Реклама", amount: 25000, description: "Яндекс Директ" },
    };
    const action = mapIntentToAction(result);
    expect(action).toEqual({
      type: "expense_event",
      category: "Реклама",
      amount: 25000,
      date: undefined,
      description: "Яндекс Директ",
    });
  });

  it("market_insight → MarketNode", () => {
    const result: VoiceExtractResult = {
      ...baseResult,
      intent: "market_insight",
      diff: { text: "Конкурент вышел на рынок", sector: "auto" },
    };
    const action = mapIntentToAction(result);
    expect(action).toEqual({
      type: "market_node",
      text: "Конкурент вышел на рынок",
      source: undefined,
      sector: "auto",
    });
  });

  it("adjust_plan → PlanAdjustment with requiresConfirmation: true", () => {
    const result: VoiceExtractResult = {
      ...baseResult,
      intent: "adjust_plan",
      diff: { description: "Перенести дедлайн", targetDate: "2026-09-01" },
    };
    const action = mapIntentToAction(result);
    expect(action).not.toBeNull();
    expect(action?.type).toBe("plan_adjustment");
    if (action && action.type === "plan_adjustment") {
      expect(action.requiresConfirmation).toBe(true);
      expect(action.description).toBe("Перенести дедлайн");
      expect(action.targetDate).toBe("2026-09-01");
    }
  });

  it("needsClarification=true → returns null", () => {
    const result: VoiceExtractResult = {
      ...baseResult,
      intent: "add_expense",
      diff: { category: "Аренда", amount: 50000 },
      needsClarification: true,
      confidence: 0.6,
      clarificationQuestion: "Уточните сумму",
    };
    expect(mapIntentToAction(result)).toBeNull();
  });

  it("confidence < 0.8 → returns null even if needsClarification=false", () => {
    const result: VoiceExtractResult = {
      ...baseResult,
      intent: "add_expense",
      diff: { category: "Прочее", amount: 1000 },
      confidence: 0.75,
      needsClarification: false,
    };
    expect(mapIntentToAction(result)).toBeNull();
  });

  it("confidence exactly 0.8 → does NOT return null", () => {
    const result: VoiceExtractResult = {
      ...baseResult,
      intent: "market_insight",
      diff: { text: "Тренд на рост" },
      confidence: 0.8,
      needsClarification: false,
    };
    const action = mapIntentToAction(result);
    expect(action).not.toBeNull();
    expect(action?.type).toBe("market_node");
  });
});
