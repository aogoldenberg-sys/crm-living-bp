import type { AnthropicClient } from "../client.js";
import { ok, err } from "@crm/core";
import type { Result } from "@crm/core";

export type MarketPresenceResult = {
  demandVsMarket: string;       // текст оценки спроса клиента vs рынок
  marketShareEstimate: string;  // оценочная доля (диапазон)
  disclaimer: string;           // ОБЯЗАТЕЛЕН по спеке
};

const PRESENCE_PROMPT = `Ты — аналитик рынка. На основе ИНН, ниши и агрегатов выписки
оцени рыночное присутствие бизнеса (раздел 7 — спрос vs рынок).

ВАЖНО: Это оценка на основе косвенных данных. ВСЕГДА добавляй disclaimer.

Ответ JSON:
{
  "demandVsMarket": "текст анализа спроса клиента vs рынок, 2-3 предложения",
  "marketShareEstimate": "примерная доля рынка в % или диапазон",
  "disclaimer": "Оценка основана на косвенных данных (выписка + ниша). Для точного анализа необходимо маркетинговое исследование."
}`;

const FALLBACK_DISCLAIMER =
  "Оценка основана на косвенных данных. Для точного анализа необходимо маркетинговое исследование.";

export async function assessMarketPresence(
  client: AnthropicClient,
  inn: string,
  niche: string,
  revenueMonthly: number, // копейки
): Promise<Result<MarketPresenceResult>> {
  let text: string;
  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: PRESENCE_PROMPT,
      messages: [{
        role: "user",
        content: `ИНН: ${inn}\nНиша: ${niche}\nСреднемесячная выручка: ${Math.round(revenueMonthly / 100).toLocaleString("ru-RU")} ₽`,
      }],
    });
    const first = msg.content[0];
    if (!first || first.type !== "text") {
      return err({ code: "STORAGE_ERROR", message: "Empty response" });
    }
    text = first.text;
  } catch (e) {
    return err({ code: "STORAGE_ERROR", message: e instanceof Error ? e.message : String(e) });
  }

  try {
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match?.[0] ?? text) as MarketPresenceResult;
    // Disclaimer обязателен по спеке — подставляем если Claude пропустил
    if (!parsed.disclaimer) {
      parsed.disclaimer = FALLBACK_DISCLAIMER;
    }
    return ok(parsed);
  } catch {
    return err({ code: "STORAGE_ERROR", message: "Invalid JSON from Claude" });
  }
}
