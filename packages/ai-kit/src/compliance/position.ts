/**
 * Позиция клиента по отсутствующим документам.
 * Генерирует пояснения для missing-позиций — дополнение к cover-letter.
 */

import type { AnthropicClient } from "../client.js";
import { type Result, ok, err } from "@crm/core";

// ── CLIENT_POSITION_SYSTEM ────────────────────────────────────────────────────

export const CLIENT_POSITION_SYSTEM = `Роль: юридический аналитик — автор объяснительной записки клиента.

Задача: для каждой отсутствующей позиции сформулировать краткое обоснование,
почему документ отсутствует и какие шаги предпринимаются для его получения.

ПРАВИЛО ПРОТИВ ФАБРИКАЦИИ (абсолютное):
- Не выдумывай реквизиты, номера, даты и суммы.
- Отсутствующее обозначай [ЗАПОЛНИТЬ].
- Пиши только то, что прямо следует из входных данных.
- Если userNote отсутствует — формулируй нейтрально-деловое объяснение без деталей.

Формат: для каждого элемента одна строка "N. [docKind] — <объяснение>".
Вывод: только текст, без markdown, без комментариев.`;

// ── buildClientPosition ───────────────────────────────────────────────────────

export type MissingItem = {
  docKind: string;
  label: string;
  userNote: string | null;
};

/**
 * Генерирует позицию клиента по отсутствующим документам.
 * Кэшируем систему промпта через prompt-caching API.
 */
export async function buildClientPosition(
  client: AnthropicClient,
  missing: MissingItem[],
): Promise<Result<string>> {
  if (missing.length === 0) return ok("");

  const input = missing
    .map((m, i) => `${i + 1}. docKind: ${m.docKind}, label: "${m.label}", userNote: ${m.userNote ? `"${m.userNote}"` : "null"}`)
    .join("\n");

  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: CLIENT_POSITION_SYSTEM,
      messages: [{ role: "user", content: input }],
    });

    const first = msg.content[0];
    if (!first || first.type !== "text") {
      return err({ code: "STORAGE_ERROR", message: "Claude вернул нетекстовый ответ (position)" });
    }
    return ok(first.text.trim());
  } catch (e) {
    return err({ code: "STORAGE_ERROR", message: e instanceof Error ? e.message : String(e) });
  }
}
