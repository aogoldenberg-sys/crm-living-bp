import type { AnthropicClient } from "../client.js";
import type { ExtractedPlan } from "@crm/core";
import { type Result, ok, err } from "@crm/core";
import { ExtractedPlanSchema } from "./schemas.js";

// Prompt inlined — CF Workers don't support readFileSync / import.meta.url
const SYSTEM_PROMPT = `Ты — аналитик бизнес-планов. Тебе дан текст документа.

Задача: извлечь структурированные данные в JSON строго по схеме ExtractedPlan.

Схема:
{
  "businessId": "<передаётся в запросе>",
  "rawSections": {
    "<sectionId>": { "text": "<краткое содержание>", "confidence": <0.0–1.0> }
  },
  "assumptions": {
    "<key>": {
      "key": "<key>",
      "value": { "point": <число> } | { "lo": <число>, "hi": <число> },
      "unit": "<₽ | % | дней | шт | ...>",
      "origin": "ai_extracted",
      "confidence": <0.0–1.0>,
      "sourceSection": "<sectionId или null>",
      "verifiability": {
        "verifiableBy": "<способ верификации или null>",
        "afterEvent": "<событие-триггер или null>"
      }
    }
  }
}

Денежные значения в value — ЦЕЛЫЕ КОПЕЙКИ (₽ × 100). Пример: 1 500 000 ₽ → 150000000.
Если значение — диапазон, используй { "lo": ..., "hi": ... }.
Если точное значение — { "point": ... }.
Pre-revenue гипотезы (проект ещё не открыт): verifiableBy: null, afterEvent: null.
Гипотезы, верифицируемые после открытия: verifiableBy: "bank_api" / "OTA_stats" / "accounting", afterEvent: "N недель после открытия".

Обязательные ключи для туристических/капитальных проектов (извлекай если есть):
- occupancy_summer, occupancy_shoulder, occupancy_winter (unit: "%")
- avg_night_price (unit: "₽", копейки)
- trip_check (unit: "₽", копейки)
- capex_total (unit: "₽", копейки)
- grant_minek, grant_agrostartup, grant_governor, grant_minvostok (unit: "₽", копейки)
- opening_date (unit: "дата", value: { point: 0 }, sourceSection где упоминается)
  — для дат value.point = 0, а фактическую дату укажи в sourceSection как текст
- modules_count (unit: "шт")
- ebitda_margin (unit: "%")
- payback_years (unit: "лет")

Известные sectionId: executive_summary, problem, solution, market_size, target_audience,
value_proposition, competitors, business_model, pricing, product_roadmap, go_to_market,
sales_channels, marketing_strategy, team, operations, finances, unit_economics,
risks, legal, kpi_metrics, funding_ask, exit_strategy.

confidence = насколько уверен в качестве извлечённого содержимого (0.0–1.0).
Если раздел не найден — не включай в rawSections.
Верни ТОЛЬКО валидный JSON без обёрток markdown.`;

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
  const systemPrompt = SYSTEM_PROMPT;

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
