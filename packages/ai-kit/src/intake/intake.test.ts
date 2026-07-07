import { describe, it, expect } from "vitest";
import { extractPlan } from "./extract.js";
import { assessPlan } from "./assess.js";
import type { AnthropicClient } from "../client.js";
import type { ExtractedPlan } from "@crm/core";

/**
 * MockAnthropicClient — не live-вызов.
 * Возвращает заданный текст через messages.create, имитируя сигнатуру Anthropic SDK.
 */
function makeMockClient(responseText: string): AnthropicClient {
  return {
    messages: {
      create: async (_params: unknown) => ({
        id: "msg_mock",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: responseText }],
        model: "claude-haiku-4-5-20251001",
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    },
  } as unknown as AnthropicClient;
}

const validExtractedJson = JSON.stringify({
  businessId: "will-be-overridden",
  rawSections: {
    executive_summary: { text: "Краткое описание стартапа", confidence: 0.9 },
    problem: { text: "Описание проблемы", confidence: 0.85 },
  },
  assumptions: {
    avg_check: {
      key: "avg_check",
      value: { point: 500000 },
      unit: "₽",
      origin: "ai_extracted",
      confidence: 0.8,
      sourceSection: "pricing",
      verifiability: { verifiableBy: null, afterEvent: null },
    },
    conversion_rate: {
      key: "conversion_rate",
      value: { point: 0.1 },
      unit: "%",
      origin: "ai_extracted",
      confidence: 0.7,
      sourceSection: "unit_economics",
      verifiability: { verifiableBy: null, afterEvent: null },
    },
  },
});

const validAssessJson = JSON.stringify({
  strengths: [
    { point: "Чёткая проблема", sectionRef: "problem", evidence: "Хорошо описана" },
    { point: "Сильная команда", sectionRef: "team", evidence: "Опыт в отрасли" },
  ],
  concerns: [
    { point: "Высокий churnRate", severity: "red", sectionRef: "unit_economics", rationale: "Не подтверждён данными" },
  ],
  verifiability: [
    { assumption: "avgCheck", howValidated: "Опрос клиентов", dataSourceNeeded: "CRM-данные" },
  ],
});

const sampleExtracted: ExtractedPlan = {
  businessId: "biz-123",
  rawSections: {
    executive_summary: { text: "Краткое описание", confidence: 0.9 },
  },
  assumptions: {
    avg_check: {
      key: "avg_check",
      value: { point: 500000 },
      unit: "₽",
      origin: "ai_extracted",
      confidence: 0.8,
      sourceSection: "pricing",
      verifiability: { verifiableBy: null, afterEvent: null },
    },
  },
};

// ─── ПОЗИТИВНЫЕ ────────────────────────────────────────────────────────────

describe("extractPlan — позитивные", () => {
  it("валидный JSON от Claude → ExtractedPlanSchema.parse() проходит → ok()", async () => {
    const client = makeMockClient(validExtractedJson);
    const result = await extractPlan(client, "biz-123", "Текст документа");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.businessId).toBe("biz-123");
      expect(result.value.rawSections["executive_summary"]?.text).toBe("Краткое описание стартапа");
    }
  });

  it("businessId из аргумента подставляется в ExtractedPlan (не берётся из ответа Claude)", async () => {
    const client = makeMockClient(validExtractedJson);
    // Claude возвращает businessId = "will-be-overridden", но мы передаём "actual-biz-id"
    const result = await extractPlan(client, "actual-biz-id", "Текст документа");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.businessId).toBe("actual-biz-id");
    }
  });
});

describe("assessPlan — позитивные", () => {
  it("валидный JSON → ok() с strengths/concerns/verifiability", async () => {
    const client = makeMockClient(validAssessJson);
    const result = await assessPlan(client, sampleExtracted);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.strengths).toHaveLength(2);
      expect(result.value.concerns).toHaveLength(1);
      expect(result.value.verifiability).toHaveLength(1);
    }
  });
});

// ─── НЕГАТИВНЫЕ ────────────────────────────────────────────────────────────

describe("extractPlan — негативные", () => {
  it("кривой JSON от Claude → err()", async () => {
    const client = makeMockClient("это не JSON {{{ сломанный");
    const result = await extractPlan(client, "biz-123", "Текст документа");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("STORAGE_ERROR");
    }
  });

  it("JSON без обязательных полей → err()", async () => {
    const client = makeMockClient(JSON.stringify({ foo: "bar" }));
    const result = await extractPlan(client, "biz-123", "Текст документа");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("STORAGE_ERROR");
    }
  });

  it("confidence > 1 в rawSections → err() (Zod ловит)", async () => {
    const badJson = JSON.stringify({
      businessId: "biz-123",
      rawSections: {
        executive_summary: { text: "Описание", confidence: 1.5 }, // > 1, невалидно
      },
      assumptions: {},
    });
    const client = makeMockClient(badJson);
    const result = await extractPlan(client, "biz-123", "Текст документа");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("STORAGE_ERROR");
    }
  });

  it("лишние поля в объекте (strict) → err()", async () => {
    const strictViolation = JSON.stringify({
      businessId: "biz-123",
      rawSections: {},
      assumptions: {},
      unexpectedField: "лишнее", // .strict() должен поймать
    });
    const client = makeMockClient(strictViolation);
    const result = await extractPlan(client, "biz-123", "Текст документа");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("STORAGE_ERROR");
    }
  });
});

describe("assessPlan — негативные", () => {
  it("кривой JSON в assessPlan → err()", async () => {
    const client = makeMockClient("не JSON вовсе!!!");
    const result = await assessPlan(client, sampleExtracted);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("STORAGE_ERROR");
    }
  });

  it("severity не 'red'|'yellow' → assessPlan err()", async () => {
    const badSeverityJson = JSON.stringify({
      strengths: [{ point: "Хорошо", sectionRef: "problem", evidence: "Очевидно" }],
      concerns: [
        { point: "Плохо", severity: "orange", sectionRef: "risks", rationale: "Риск" }, // невалидное severity
      ],
      verifiability: [],
    });
    const client = makeMockClient(badSeverityJson);
    const result = await assessPlan(client, sampleExtracted);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("STORAGE_ERROR");
    }
  });

  it("лишние поля в assessPlan ответе (strict) → err()", async () => {
    const strictViolation = JSON.stringify({
      strengths: [],
      concerns: [],
      verifiability: [],
      gaps: [], // не входит в AssessmentOutputSchema
    });
    const client = makeMockClient(strictViolation);
    const result = await assessPlan(client, sampleExtracted);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("STORAGE_ERROR");
    }
  });
});
