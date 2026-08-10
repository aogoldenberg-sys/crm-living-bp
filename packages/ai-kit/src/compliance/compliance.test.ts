import { describe, it, expect, vi } from "vitest";
import { extractRequest } from "./extract.js";
import { draftResponse } from "./draft.js";
import { selectOpenItems, parseClarifyAnswers, buildDraftInput } from "./clarify.js";
import { buildRegistry } from "./registry.js";
import { buildClientPosition } from "./position.js";
import { runPipeline } from "./pipeline.js";
import type { AnthropicClient } from "../client.js";
import type { DraftInput } from "./draft.js";
import type { ChecklistEntry, RequestItem } from "@crm/schemas";

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

/** Клиент с поддержкой beta.promptCaching.messages.create */
function makeCachingClient(response: string): AnthropicClient {
  const mock = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: response }],
  });
  return {
    messages: { create: vi.fn() },
    beta: { promptCaching: { messages: { create: mock } } },
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
  authority: "fns_kameral" as const,
  incomingRef: { number: "12-34/567", date: "2025-05-01" },
  companyName: 'ООО "Ромашка"',
  companyInn: "7701234567",
  rawRequestTexts: [],
  provided: [{ docKind: "payment_order", label: "Платёжное поручение №1 от 15.01.2025", attachmentNo: 1 }],
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

// ─── FIXTURES: checklist entries ─────────────────────────────────────────────

const ITEM_ID = "550e8400-e29b-41d4-a716-446655440001";
const ITEM_ID_2 = "550e8400-e29b-41d4-a716-446655440002";

const openItem: RequestItem = {
  itemId: ITEM_ID,
  rawText: "Предоставьте договор с ООО Ромашка",
  docKinds: ["contract"],
  periodFrom: null,
  periodTo: null,
  counterpartyInn: null,
  counterpartyName: "ООО Ромашка",
  extractConfidence: 0.9,
};

const closedItem: RequestItem = {
  ...openItem,
  itemId: ITEM_ID_2,
  docKinds: ["payment_order"],
};

const entryOpen: ChecklistEntry = {
  entryId: "entry-1",
  requestItemId: ITEM_ID,
  docKind: "contract",
  label: "Договор · ООО Ромашка · весь период",
  availability: "missing_no_event",
  fileRef: null,
  evidence: [],
  confirmedByOwner: false,
};

const entryClosed: ChecklistEntry = {
  entryId: "entry-2",
  requestItemId: ITEM_ID_2,
  docKind: "payment_order",
  label: "Платёжное поручение · весь период",
  availability: "have_file",
  fileRef: "gs://bucket/pp.pdf",
  evidence: [],
  confirmedByOwner: false,
};

const validMeta = {
  authority: "fns_kameral" as const,
  incomingRef: { number: "12-34/567", date: "2025-05-01" },
  companyName: 'ООО "Ромашка"',
  companyInn: "7701234567",
};

// ─── selectOpenItems ──────────────────────────────────────────────────────────

describe("selectOpenItems", () => {
  it("7. только missing_no_event-записи порождают открытые позиции", () => {
    const result = selectOpenItems([openItem, closedItem], [entryOpen, entryClosed]);
    expect(result).toHaveLength(1);
    expect(result[0]?.itemId).toBe(ITEM_ID);
  });

  it("8. нет missing_no_event → пустой массив", () => {
    const result = selectOpenItems([closedItem], [entryClosed]);
    expect(result).toHaveLength(0);
  });
});

// ─── parseClarifyAnswers ──────────────────────────────────────────────────────

describe("parseClarifyAnswers", () => {
  it("9. openItems пустой → ok([]) без вызова Claude", async () => {
    const client = makeCachingClient("[]");
    const result = await parseClarifyAnswers(client, [], "любой текст");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
    // beta не вызывался
    const mock = ((client.beta as unknown) as { promptCaching: { messages: { create: ReturnType<typeof vi.fn> } } }).promptCaching.messages.create;
    expect(mock).not.toHaveBeenCalled();
  });

  it("10. валидный JSON → ok(ClarifyAnswer[])", async () => {
    const answers = JSON.stringify([
      { itemId: ITEM_ID, status: "have_paper", note: "в папке" },
    ]);
    const client = makeCachingClient(answers);
    const result = await parseClarifyAnswers(client, [openItem], "договор есть на бумаге");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value[0]?.status).toBe("have_paper");
      expect(result.value[0]?.note).toBe("в папке");
    }
  });

  it("11. невалидный JSON → err(STORAGE_ERROR)", async () => {
    const client = makeCachingClient("not json {{");
    const result = await parseClarifyAnswers(client, [openItem], "текст");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("STORAGE_ERROR");
  });
});

// ─── buildDraftInput ──────────────────────────────────────────────────────────

describe("buildDraftInput", () => {
  it("12. have_file → provided; missing_no_event без ответа → missing", () => {
    const result = buildDraftInput(
      [openItem, closedItem],
      [entryOpen, entryClosed],
      [],
      validMeta,
    );
    expect(result.provided).toHaveLength(1);
    expect(result.provided[0]?.docKind).toBe("payment_order");
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]?.docKind).toBe("contract");
  });
});

// ─── buildRegistry ────────────────────────────────────────────────────────────

describe("buildRegistry", () => {
  it("13. have_file → provided; missing_no_event + answer have_paper → pending_scan; missing answer → исключён", () => {
    const entryMissing: ChecklistEntry = {
      entryId: "entry-missing",
      requestItemId: "550e8400-e29b-41d4-a716-446655440003",
      docKind: "act",
      label: "Акт",
      availability: "missing_no_event",
      fileRef: null,
      evidence: [],
      confirmedByOwner: false,
    };
    const registry = buildRegistry(
      [entryOpen, entryClosed, entryMissing],
      [
        { itemId: ITEM_ID, status: "have_paper", note: null },
        { itemId: "550e8400-e29b-41d4-a716-446655440003", status: "missing", note: null },
      ],
    );
    const open = registry.find(r => r.entryId === "entry-1");
    const closed = registry.find(r => r.entryId === "entry-2");
    const absent = registry.find(r => r.entryId === "entry-missing");
    expect(open?.resolution).toBe("pending_scan");
    expect(closed?.resolution).toBe("provided");
    expect(absent).toBeUndefined(); // missing → не в реестр
  });
});

// ─── buildClientPosition ─────────────────────────────────────────────────────

describe("buildClientPosition", () => {
  it("14. пустой список → ok('')", async () => {
    const client = makeCachingClient("что-то");
    const result = await buildClientPosition(client, []);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe("");
  });
});

// ─── runPipeline ──────────────────────────────────────────────────────────────

describe("runPipeline", () => {
  it("15. если нет open-items — draftResponse вызван с корректным DraftInput", async () => {
    const letterText = "[ПРОЕКТ — требует проверки юристом]\nПисьмо.";
    const client = {
      ...makeCachingClient(letterText),
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: letterText }],
        }),
      },
    } as unknown as AnthropicClient;

    const result = await runPipeline(
      client,
      [closedItem],
      [entryClosed],
      [],
      validMeta,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.draftLetter.startsWith("[ПРОЕКТ")).toBe(true);
      expect(result.value.openItemCount).toBe(0);
      expect(result.value.registry).toHaveLength(1);
      expect(typeof result.value.clientPosition).toBe("string"); // "" — нет missing
    }
  });
});
