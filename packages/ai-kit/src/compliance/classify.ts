import type { AnthropicClient } from "../client.js";
import { type Result, ok, err } from "@crm/core";

export type DocumentClass =
  | "requirement"  // требуют представить документы → нужен чек-лист
  | "warning"      // предупреждение/уведомление → представлять нечего
  | "resolution"   // постановление, мера уже применена
  | "act"          // акт/протокол, зафиксировано нарушение
  | "unknown";

export type Classification = {
  documentClass: DocumentClass;
  hasItemList: boolean;  // есть ЯВНЫЙ перечень истребуемых документов
  essence: string;       // 1-2 фразы: что это, для показа пользователю
  confidence: number;
};

const CLASSIFY_SYSTEM = `Ты — юридический классификатор документов государственных органов.
Прочитай документ и верни JSON. ТОЛЬКО JSON, без markdown, без пояснений.

Правила классификации:
- "requirement" — документ истребует конкретные документы или информацию от организации.
- "warning" — предупреждение об ответственности, ограничение права, уведомление. Ничего не истребует.
- "resolution" — постановление о применении меры (взыскание, арест, ограничение). Мера уже вынесена.
- "act" — акт проверки, протокол, фиксация нарушения.
- "unknown" — невозможно определить класс уверенно. НЕ УГАДЫВАЙ.

hasItemList = true ТОЛЬКО если в документе есть пронумерованный или явный перечень
истребуемых документов («прошу представить: 1... 2... 3...»).
Упоминание документа в тексте перечнем НЕ является.
Документ предупреждает об ответственности, но ничего не истребует → hasItemList = false.
Признаки не складываются → documentClass = "unknown". НЕ УГАДЫВАЙ.

Формат ответа:
{
  "documentClass": "requirement|warning|resolution|act|unknown",
  "hasItemList": true|false,
  "essence": "1-2 фразы: что это и кто прислал",
  "confidence": 0.0-1.0
}`;

export async function classifyRequestDocument(
  client: AnthropicClient,
  documentText: string,
  isImage?: boolean,
): Promise<Result<Classification>> {
  const userContent = isImage
    ? documentText  // для изображений documentText содержит описание или OCR
    : documentText.slice(0, 8000);  // обрезаем для haiku — достаточно первых 8000 символов

  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: [{ type: "text", text: CLASSIFY_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userContent }],
    });

    const textBlock = msg.content.find(
      (b): b is { type: "text"; text: string } => b.type === "text",
    );
    if (!textBlock?.text) {
      return err({ code: "STORAGE_ERROR", message: "Пустой ответ классификатора" });
    }

    const raw = textBlock.text
      .replace(/^```(?:json)?\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return err({ code: "STORAGE_ERROR", message: `Невалидный JSON от классификатора: ${raw.slice(0, 200)}` });
    }

    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("documentClass" in (parsed as object)) ||
      !("hasItemList" in (parsed as object))
    ) {
      return err({ code: "STORAGE_ERROR", message: "Классификатор вернул неожиданную структуру" });
    }

    const p = parsed as {
      documentClass: string;
      hasItemList: boolean;
      essence: string;
      confidence: number;
    };

    const VALID_CLASSES = new Set<string>(["requirement", "warning", "resolution", "act", "unknown"]);
    const documentClass: DocumentClass = VALID_CLASSES.has(p.documentClass)
      ? (p.documentClass as DocumentClass)
      : "unknown";

    return ok({
      documentClass,
      hasItemList: Boolean(p.hasItemList),
      essence: typeof p.essence === "string" ? p.essence : "",
      confidence: typeof p.confidence === "number" ? Math.min(1, Math.max(0, p.confidence)) : 0.5,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message });
  }
}
