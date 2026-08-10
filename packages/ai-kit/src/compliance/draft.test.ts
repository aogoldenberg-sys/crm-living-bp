import { describe, it, expect, vi } from "vitest";
import { draftResponse } from "./draft.js";
import type { AnthropicClient } from "../client.js";
import type { DraftInput } from "./draft.js";

function makeClient(response: string): AnthropicClient {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: response }],
      }),
    },
    beta: { promptCaching: { messages: { create: vi.fn() } } },
  };
}

const prosecutorInput: DraftInput = {
  authority: "prosecutor",
  incomingRef: { number: "7-12-2026", date: "2026-06-01" },
  companyName: 'ООО "Тест"',
  companyInn: "7701234567",
  rawRequestTexts: [],
  provided: [{ docKind: "contract", label: "Договор №1", attachmentNo: 1 }],
  missing: [],
  restoredDuplicates: [],
};

describe("draftResponse — legal basis injection", () => {
  it("prosecutor → промпт содержит «О прокуратуре» и НЕ содержит «НК РФ»", async () => {
    const letterText = "[ПРОЕКТ — требует проверки юристом]\nПисьмо прокурору.";
    const client = makeClient(letterText);

    await draftResponse(client, prosecutorInput);

    const call = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const userMsg = call[0].messages[0].content as string;

    expect(userMsg).toContain("2202-1");
    expect(userMsg).not.toContain("НК РФ");
    expect(userMsg).toContain("17.7 КоАП");
  });

  it("fns_kameral → промпт содержит «НК РФ»", async () => {
    const letterText = "[ПРОЕКТ — требует проверки юристом]\nПисьмо в ФНС.";
    const client = makeClient(letterText);

    const fnsInput: DraftInput = {
      ...prosecutorInput,
      authority: "fns_kameral",
    };
    await draftResponse(client, fnsInput);

    const call = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const userMsg = call[0].messages[0].content as string;

    expect(userMsg).toContain("НК РФ");
    expect(userMsg).not.toContain("2202-1");
  });
});
