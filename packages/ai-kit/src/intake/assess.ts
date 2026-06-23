import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import type { AnthropicClient } from "../client.js";
import type { ExtractedPlan } from "@crm/core";
import { type Result, ok, err } from "@crm/core";
import type { Strength, Concern, VerifiabilityItem } from "@crm/schemas";
import { AssessmentOutputSchema } from "./schemas.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadPrompt(): string {
  return readFileSync(
    join(__dirname, "../../prompts/intake_assess.md"),
    "utf-8",
  );
}

export type AssessmentOutput = {
  strengths: Strength[];
  concerns: Concern[];
  verifiability: VerifiabilityItem[];
};

/**
 * Качественная оценка бизнес-плана через Claude.
 *
 * Принимает ExtractedPlan и возвращает симметричную оценку §20.3:
 * сильные стороны, опасения, верифицируемость предположений.
 *
 * Не включает gaps/assumptionsExtracted — они формируются в @crm/core,
 * не здесь. Claude оценивает только то, что видит в rawSections + assumptions.
 */
export async function assessPlan(
  client: AnthropicClient,
  extracted: ExtractedPlan,
): Promise<Result<AssessmentOutput>> {
  const systemPrompt = loadPrompt();

  const inputJson = JSON.stringify({
    rawSections: extracted.rawSections,
    assumptions: extracted.assumptions,
  });

  let responseText: string;
  try {
    const message = await client.messages.create({
      model: "claude-3-5-haiku-latest",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: inputJson,
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

  const validated = AssessmentOutputSchema.safeParse(parsed);
  if (!validated.success) {
    return err({
      code: "STORAGE_ERROR",
      message: `Ответ Claude не прошёл валидацию: ${validated.error.message}`,
    });
  }

  return ok(validated.data);
}
