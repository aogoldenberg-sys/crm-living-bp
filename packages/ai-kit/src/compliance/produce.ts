import type { AnthropicClient } from "../client.js";
import { type Result, ok, err } from "@crm/core";
import type { Advisory, AdvisoryQA } from "./advise.js";

export type ProducedDoc = { title: string; content: string };

const PRODUCE_SYSTEM = `Ты — юридический помощник. Составляешь документы на русском языке.

## Правила
- Используй только факты из documentText, advisory и clientAnswers. Не придумывай.
- Незаполненные реквизиты (ФИО директора, ИНН и т.п.) обозначь [ЗАПОЛНИТЬ].
- Если в clientAnswers есть текст вложенного документа — используй его данные.
- Для каждого заголовка из selectedTitles составь полный текст документа.

## Формат ответа — ТОЛЬКО валидный JSON без markdown:
{
  "documents": [
    { "title": "точный заголовок из selectedTitles", "content": "полный текст документа" },
    ...
  ]
}`;

export async function produceDocuments(
  client: AnthropicClient,
  documentText: string,
  advisory: Advisory,
  clientAnswers: AdvisoryQA[],
  selectedTitles: string[],
): Promise<Result<ProducedDoc[]>> {
  if (selectedTitles.length === 0) return ok([]);

  const input = {
    selectedTitles,
    documentText,
    advisorySummary: {
      essence: advisory.essence,
      legalGround: advisory.legalGround,
      options: advisory.options,
      verdict: (advisory as Advisory & { verdict?: string }).verdict ?? "",
    },
    clientAnswers,
  };

  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 16384,
      system: PRODUCE_SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(input, null, 2) }],
    });

    const textBlock = msg.content.find(
      (b): b is { type: "text"; text: string } => b.type === "text",
    );
    if (!textBlock?.text) {
      return err({ code: "STORAGE_ERROR", message: "Claude вернул пустой ответ (produce)" });
    }

    const raw = textBlock.text
      .replace(/^```(?:json)?\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();

    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { return err({ code: "STORAGE_ERROR", message: `Невалидный JSON от produce: ${raw.slice(0, 200)}` }); }

    const p = parsed as Record<string, unknown>;
    if (!Array.isArray(p.documents)) {
      return err({ code: "STORAGE_ERROR", message: "produce: нет поля documents в ответе" });
    }

    const docs: ProducedDoc[] = (p.documents as unknown[])
      .filter((d): d is Record<string, unknown> => typeof d === "object" && d !== null)
      .map(d => ({
        title: typeof d.title === "string" ? d.title : "",
        content: typeof d.content === "string" ? d.content : "",
      }))
      .filter(d => d.title && d.content);

    return ok(docs);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message });
  }
}
