import type { AnthropicClient } from "../client.js";
import type { ExtractedPlan } from "@crm/core";
import { type Result, ok, err } from "@crm/core";
import type { Strength, Concern, VerifiabilityItem } from "@crm/schemas";
import { AssessmentOutputSchema } from "./schemas.js";

// Prompt inlined — CF Workers don't support readFileSync / import.meta.url
const SYSTEM_PROMPT = `Ты — независимый бизнес-аналитик. Тебе дана структура бизнес-плана.

Задача: симметричная оценка §20.3 — не льстить и не громить.
Верни JSON строго по схеме:
{
  "strengths": [{ "point": "...", "sectionRef": "...", "evidence": "..." }],
  "concerns":  [{ "point": "...", "severity": "red"|"yellow", "sectionRef": "...", "rationale": "..." }],
  "verifiability": [{ "assumption": "...", "howValidated": "...", "dataSourceNeeded": "..." }]
}

Правила:
- strengths: минимум 2, максимум 5. Только реальные — если сильных сторон нет, укажи 0.
- concerns: severity "red" = критический риск, "yellow" = внимание. Минимум 1 если есть.
- verifiability: для каждой числовой гипотезы из assumptions (assumptions — это объект вида { "<key>": { key, value, unit, origin, ... } }, итерируй по значениям).
  Для pre-revenue гипотез (verifiableBy: null) — опиши как будет верифицировано ПОСЛЕ открытия.
Верни ТОЛЬКО валидный JSON без обёрток markdown.`;

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
  const systemPrompt = SYSTEM_PROMPT;

  const inputJson = JSON.stringify({
    rawSections: extracted.rawSections,
    assumptions: extracted.assumptions,
  });

  let responseText: string;
  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
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

/**
 * Оценка конкретного раздела бизнес-плана.
 * Возвращает strengths/concerns/gaps для одного sectionId.
 */
export async function assessSection(
  client: AnthropicClient,
  sectionId: string,
  sectionText: string,
): Promise<{ strengths: string[]; concerns: string[]; gaps: string[] }> {
  let responseText: string;
  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: `Ты — аналитик бизнес-планов. Оцени раздел "${sectionId}".
Верни JSON: { "strengths": [...], "concerns": [...], "gaps": [...] }
Только валидный JSON без markdown-обёрток.`,
      messages: [{ role: "user", content: sectionText }],
    });

    const firstBlock = message.content[0];
    if (!firstBlock || firstBlock.type !== "text") {
      return { strengths: [], concerns: [], gaps: [] };
    }
    responseText = firstBlock.text;
  } catch {
    return { strengths: [], concerns: [], gaps: [] };
  }

  try {
    const parsed = JSON.parse(responseText) as { strengths?: string[]; concerns?: string[]; gaps?: string[] };
    return {
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
      concerns: Array.isArray(parsed.concerns) ? parsed.concerns : [],
      gaps: Array.isArray(parsed.gaps) ? parsed.gaps : [],
    };
  } catch {
    return { strengths: [], concerns: [], gaps: [] };
  }
}
