import { describe, it, expect, vi } from "vitest";
import { extractRequest } from "./extract.js";
import { draftResponse } from "./draft.js";
import type { AnthropicClient } from "../client.js";
import type { DraftInput } from "./draft.js";

// ─── MOCK FACTORY ────────────────────────────────────────────────────────────

function makeClient(response: string): AnthropicClient {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: response }],
      }),
    },
  } as unknown as AnthropicClient;
}

// ─── FIXTURES ────────────────────────────────────────────────────────────────

const validRequestItem = {
  itemId: "550e8400-e29b-41d4-a716-446655440000",
  rawText: "Предоставьте платёжные поручения за период 01.01.2025–31.03.2025",
  docKinds: ["payment_order"],
  periodFrom: "2025-01-01",
  periodTo: "2025-03-31",
  counterpartyInn: null,
  counterpartyName: null,
  extractConfidence: 0.9,
};

const validItemsJson = JSON.stringify([validRequestItem]);

const validDraftInput: DraftInput = {
  authority: "fns_kameral",
  incomingRef: { number: "12-34/567", date: "2025-05-01" },
  companyName: 'ООО "Ромашка"',
  companyInn: "7701234567",
  provided: [{ docKind: "payment_order", label: "Платёжное поручение №1 от 15.01.2025" }],
  missing: [],
  restoredDuplicates: [],
};

// ─── extractRequest ───────────────────────────────────────────────────────────

describe("extractRequest", () => {
  it("1. валидный JSON → ok, массив RequestItem распарсен", async () => {
    const client = makeClient(validItemsJson);
    const result = await extractRequest(client, "Текст требования", false);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.itemId).toBe("550e8400-e29b-41d4-a716-446655440000");
      expect(result.value[0]?.docKinds).toContain("payment_order");
    }
  });

  it("2. битый JSON → ретрай → успех (create вызван дважды)", async () => {
    const client = {
      messages: {
        create: vi
          .fn()
          .mockResolvedValueOnce({ content: [{ type: "text", text: "invalid json {{" }] })
          .mockResolvedValueOnce({ content: [{ type: "text", text: validItemsJson }] }),
      },
    } as unknown as AnthropicClient;

    const result = await extractRequest(client, "Текст требования", false);

    expect(result.ok).toBe(true);
    expect(client.messages.create).toHaveBeenCalledTimes(2);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
    }
  });

  it("3. два раза битый JSON → err(STORAGE_ERROR)", async () => {
    const client = {
      messages: {
        create: vi
          .fn()
          .mockResolvedValueOnce({ content: [{ type: "text", text: "not json" }] })
          .mockResolvedValueOnce({ content: [{ type: "text", text: "also not json" }] }),
      },
    } as unknown as AnthropicClient;

    const result = await extractRequest(client, "Текст требования", false);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("STORAGE_ERROR");
    }
  });

  it("6. ZodError (valid JSON но неверная схема) → err(STORAGE_ERROR)", async () => {
    const badSchemaJson = JSON.stringify([
      {
        itemId: "not-a-uuid",          // нарушает z.string().uuid()
        rawText: "",                   // нарушает .min(1)
        docKinds: [],                  // нарушает .min(1)
        periodFrom: null,
        periodTo: null,
        counterpartyInn: null,
        counterpartyName: null,
        extractConfidence: 2.0,        // нарушает .max(1)
      },
    ]);
    const client = makeClient(badSchemaJson);
    const result = await extractRequest(client, "Текст требования", false);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("STORAGE_ERROR");
      expect(result.error.message).toMatch(/валидацию/);
    }
  });
});

// ─── draftResponse ────────────────────────────────────────────────────────────

describe("draftResponse", () => {
  it("4. письмо начинается с [ПРОЕКТ → ok, строка возвращена", async () => {
    const letterText =
      "[ПРОЕКТ — требует проверки юристом]\n\nВ ИФНС №1\n\nНа Ваше требование №12-34/567...";
    const client = makeClient(letterText);
    const result = await draftResponse(client, validDraftInput);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(letterText);
      expect(result.value.startsWith("[ПРОЕКТ")).toBe(true);
    }
  });

  it("5. письмо без маркера → err(STORAGE_ERROR)", async () => {
    const client = makeClient("В ИФНС №1\n\nНа Ваше требование...");
    const result = await draftResponse(client, validDraftInput);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("STORAGE_ERROR");
      expect(result.error.message).toMatch(/маркер \[ПРОЕКТ/);
    }
  });
});
