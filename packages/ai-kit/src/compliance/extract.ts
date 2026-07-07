import type { AnthropicClient } from "../client.js";
import { type Result, ok, err } from "@crm/core";
import { RequestItem } from "@crm/schemas";

// Промпт инлайном — CF Workers не поддерживают readFileSync
const EXTRACT_SYSTEM_PROMPT = `Роль: юридический аналитик-экстрактор.
Вход: текст или скан-изображение требования контролирующего органа (PDF/JPEG через vision).
Задача: разобрать на позиции и вернуть JSON массив RequestItem.

КРИТИЧЕСКОЕ ПРАВИЛО ПРОТИВ ФАБРИКАЦИИ:
- Если документ пустой, нечитаемый, не является требованием или не содержит явных
  запросов документов — верни ПУСТОЙ МАССИВ: []
- НИКОГДА не выдумывай позиции, которых нет в документе
- НИКОГДА не заполняй поля из общих знаний — только из буквального текста документа
- Белый лист, чёрное изображение, случайный текст без требований → []
- Неуверен, что это требование контролирующего органа → []

Правила (только при наличии реального требования):
- rawText — дословный текст пункта требования, не перефразируй
- period: если не указан — periodFrom: null, periodTo: null
- counterpartyInn: если не указан — null
- extractConfidence — честный (0–1); если пункт неоднозначен — 0.5–0.7
- Не хватает данных → null, не выдумывать
- Вывод: ТОЛЬКО валидный JSON массив, без markdown, без комментариев

Схема одного элемента:
{
  "itemId": "<uuid>",
  "rawText": "<дословно из требования>",
  "docKinds": ["payment_order" | "bank_statement" | "account_card" | "contract" | "act" | "waybill" | "invoice" | "invoice_facture" | "order_internal" | "explanatory" | "other"],
  "periodFrom": "YYYY-MM-DD" | null,
  "periodTo": "YYYY-MM-DD" | null,
  "counterpartyInn": "XXXXXXXXXX" | null,
  "counterpartyName": "..." | null,
  "extractConfidence": 0.0–1.0
}`;

type MessageContent =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: "image/jpeg"; data: string };
    };

function buildContent(
  fileContent: string,
  isImage: boolean,
): MessageContent[] {
  if (isImage) {
    return [
      {
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: fileContent },
      },
      { type: "text", text: "Разберите требование на позиции" },
    ];
  }
  return [{ type: "text", text: fileContent }];
}

async function callClaude(
  client: AnthropicClient,
  fileContent: string,
  isImage: boolean,
  retryHint?: string,
): Promise<Result<string>> {
  const userText = retryHint
    ? `${retryHint}\n\nПовторите разбор и верните ТОЛЬКО валидный JSON массив.`
    : undefined;

  const messages: Array<{
    role: "user";
    content: MessageContent[] | string;
  }> = [{ role: "user", content: buildContent(fileContent, isImage) }];

  if (userText) {
    messages.push({ role: "user", content: userText });
  }

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      system: EXTRACT_SYSTEM_PROMPT,
      messages,
    });

    const firstBlock = message.content[0];
    if (!firstBlock || firstBlock.type !== "text") {
      return err({
        code: "STORAGE_ERROR",
        message: "Claude вернул пустой или нетекстовый ответ",
      });
    }
    return ok(firstBlock.text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message: msg });
  }
}

export async function extractRequest(
  client: AnthropicClient,
  fileContent: string,
  isImage: boolean,
): Promise<Result<RequestItem[]>> {
  // Первая попытка
  const first = await callClaude(client, fileContent, isImage);
  if (!first.ok) return first;

  let parsed: unknown;
  try {
    parsed = JSON.parse(first.value);
  } catch {
    // Первый JSON невалидный — ретрай с подсказкой
    const hint = `Предыдущий ответ не является валидным JSON: ${first.value.slice(0, 200)}`;
    const second = await callClaude(client, fileContent, isImage, hint);
    if (!second.ok) return second;

    try {
      parsed = JSON.parse(second.value);
    } catch {
      return err({
        code: "STORAGE_ERROR",
        message: `Невалидный JSON после двух попыток: ${second.value.slice(0, 200)}`,
      });
    }
  }

  const validated = RequestItem.array().safeParse(parsed);
  if (!validated.success) {
    return err({
      code: "STORAGE_ERROR",
      message: `Ответ не прошёл валидацию схемы RequestItem: ${validated.error.message}`,
    });
  }

  // Пустой массив = Claude не нашёл требований → insufficient_data, не фабрикация
  if (validated.data.length === 0) {
    return err({
      code: "INSUFFICIENT_DATA",
      message: "Требование не распознано: документ пуст, нечитаем или не содержит запросов документов",
    });
  }

  return ok(validated.data);
}
