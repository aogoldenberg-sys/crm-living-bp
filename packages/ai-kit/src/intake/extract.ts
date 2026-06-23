import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import type { AnthropicClient } from "../client.js";
import type { ExtractedPlan } from "@crm/core";
import { type Result, ok, err } from "@crm/core";
import { ExtractedPlanSchema } from "./schemas.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadPrompt(): string {
  return readFileSync(
    join(__dirname, "../../prompts/intake_extract.md"),
    "utf-8",
  );
}

/**
 * Экстракция структурированных данных из текста документа через Claude.
 *
 * Использует claude-3-5-haiku-latest: быстрый и дешёвый для извлечения,
 * не требует сложного рассуждения — только структурирование текста.
 *
 * businessId берётся из аргумента, а не из ответа Claude: Claude не знает
 * идентификатор тенанта — это данные инфраструктуры, не документа.
 */
export async function extractPlan(
  client: AnthropicClient,
  businessId: string,
  documentText: string,
): Promise<Result<ExtractedPlan>> {
  const systemPrompt = loadPrompt();

  let responseText: string;
  try {
    const message = await client.messages.create({
      model: "claude-3-5-haiku-latest",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: `businessId: ${businessId}\n\nДокумент:\n${documentText}`,
        },
      ],
    });

    const firstBlock = message.content[0];
    if (!firstBlock || firstBlock.type !== "text") {
      return err({ code: "STORAGE_ERROR", message: "Claude вернул пустой или нетекстовый ответ" });
    }
    responseText = firstBlock.text;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return err({ code: "STORAGE_ERROR", message: `Невалидный JSON от Claude: ${responseText.slice(0, 200)}` });
  }

  const validated = ExtractedPlanSchema.safeParse(parsed);
  if (!validated.success) {
    return err({
      code: "STORAGE_ERROR",
      message: `Ответ Claude не прошёл валидацию: ${validated.error.message}`,
    });
  }

  // businessId подставляется из аргумента — не из ответа Claude
  const result: ExtractedPlan = {
    ...validated.data,
    businessId,
  };

  return ok(result);
}
