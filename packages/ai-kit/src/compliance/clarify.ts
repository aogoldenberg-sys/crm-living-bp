/**
 * Уточнение недостающих документов — диалог с клиентом.
 *
 * ПРАВИЛО: clarify спрашивает ТОЛЬКО о позициях missing_no_event.
 * Позиции have_file / have_paper / restorable / not_applicable
 * уже закрыты buildChecklist — спрашивать повторно нельзя.
 */

import type { AnthropicClient } from "../client.js";
import type { RequestItem, ChecklistEntry } from "@crm/schemas";
import type { DraftInput } from "./draft.js";
import { type Result, ok, err } from "@crm/core";

export type ClarifyAnswer = {
  /** RequestItem.itemId */
  itemId: string;
  /** have_paper = есть на бумаге; not_applicable = не наша операция; missing = реально нет */
  status: "have_paper" | "not_applicable" | "missing";
  note: string | null;
};

// ── CLARIFY_SYSTEM (статический — кэшируется на стороне API) ─────────────────

const CLARIFY_SYSTEM = `Роль: ассистент документального аудита.

Тебе дают: список пунктов требования органа (JSON openItems) и свободный текст ответа клиента.
Задача: для каждого пункта определить статус наличия документа.

Правила классификации:
- have_paper: клиент явно упоминает "есть", "имеется", "на бумаге", "в папке", "могу найти", "сканирую"
- not_applicable: клиент упоминает "не наш", "не наша операция", "не мы", "мимо", "не относится"
- missing: всё остальное, в том числе отсутствие упоминания пункта

Правила вывода:
- Вернуть ТОЛЬКО валидный JSON массив
- Один элемент на каждый itemId из openItems, в том же порядке
- Если клиент не упомянул пункт → статус "missing", note: null
- note: краткая цитата из текста клиента или null
- НИКОГДА не выдумывай. Что не упомянуто — "missing".

Схема:
[{"itemId":"<uuid>","status":"have_paper"|"not_applicable"|"missing","note":"..." | null}]`;

// ── selectOpenItems ───────────────────────────────────────────────────────────

/**
 * Возвращает пункты запроса, для которых buildChecklist НЕ нашёл
 * ни файла, ни восстановимого события (хотя бы одна строка missing_no_event).
 */
export function selectOpenItems(
  items: ReadonlyArray<RequestItem>,
  entries: ReadonlyArray<ChecklistEntry>,
): RequestItem[] {
  const openIds = new Set(
    entries
      .filter(e => e.availability === "missing_no_event")
      .map(e => e.requestItemId),
  );
  return items.filter(it => openIds.has(it.itemId));
}

// ── parseClarifyAnswers ───────────────────────────────────────────────────────

/**
 * Claude разбирает свободный ответ клиента на структурированные ClarifyAnswer.
 * Кэшируем систему промпта (дорогая инструкция, дешёвые данные).
 */
export async function parseClarifyAnswers(
  client: AnthropicClient,
  openItems: RequestItem[],
  userAnswer: string,
): Promise<Result<ClarifyAnswer[]>> {
  if (openItems.length === 0) return ok([]);

  const userMsg = `openItems:\n${JSON.stringify(openItems.map(it => ({ itemId: it.itemId, rawText: it.rawText })))}\n\nОтвет клиента:\n${userAnswer}`;

  let raw: string;
  try {
    const msg = await client.beta.promptCaching.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: [{ type: "text", text: CLARIFY_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userMsg }],
      betas: ["prompt-caching-2024-07-31"],
    });
    const first = msg.content[0];
    if (!first || first.type !== "text") {
      return err({ code: "STORAGE_ERROR", message: "Claude вернул нетекстовый ответ (clarify)" });
    }
    raw = first.text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
  } catch (e) {
    return err({ code: "STORAGE_ERROR", message: e instanceof Error ? e.message : String(e) });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err({ code: "STORAGE_ERROR", message: `Невалидный JSON (clarify): ${raw.slice(0, 200)}` });
  }

  if (!Array.isArray(parsed)) {
    return err({ code: "STORAGE_ERROR", message: "Ожидался массив ClarifyAnswer" });
  }

  // Простая валидация без Zod (ClarifyAnswer не в schemas)
  const VALID = new Set(["have_paper", "not_applicable", "missing"]);
  for (const a of parsed) {
    if (typeof a !== "object" || a === null) {
      return err({ code: "STORAGE_ERROR", message: "Элемент ClarifyAnswer не объект" });
    }
    const item = a as Record<string, unknown>;
    if (typeof item.itemId !== "string" || !VALID.has(item.status as string)) {
      return err({ code: "STORAGE_ERROR", message: `Невалидный ClarifyAnswer: ${JSON.stringify(a)}` });
    }
  }

  return ok(parsed as ClarifyAnswer[]);
}

// ── buildDraftInput ───────────────────────────────────────────────────────────

type Meta = {
  authority: DraftInput["authority"];
  incomingRef: { number: string | null; date: string | null };
  companyName: string;
  companyInn: string;
};

/**
 * Собирает DraftInput из чек-листа + ответов пользователя.
 *
 * Логика:
 *   have_file / have_paper → provided
 *   restorable            → restoredDuplicates
 *   missing_no_event:
 *     answer.status have_paper    → provided
 *     answer.status not_applicable → пропуск
 *     answer.status missing / нет → missing
 */
export function buildDraftInput(
  _items: ReadonlyArray<RequestItem>,
  entries: ReadonlyArray<ChecklistEntry>,
  answers: ClarifyAnswer[],
  meta: Meta,
): DraftInput {
  const byItem = new Map<string, ClarifyAnswer>(
    answers.map(a => [a.itemId, a]),
  );

  const provided: DraftInput["provided"] = [];
  const missing: DraftInput["missing"] = [];
  const restoredDuplicates: DraftInput["restoredDuplicates"] = [];
  let attachNo = 1;

  for (const e of entries) {
    switch (e.availability) {
      case "have_file":
      case "have_paper":
        provided.push({ docKind: e.docKind, label: e.label, attachmentNo: attachNo++ });
        break;
      case "restorable":
        restoredDuplicates.push({ docKind: e.docKind, label: e.label, attachmentNo: attachNo++ });
        break;
      case "missing_no_event": {
        const ans = byItem.get(e.requestItemId);
        if (ans?.status === "have_paper") {
          provided.push({ docKind: e.docKind, label: e.label, attachmentNo: attachNo++ });
        } else if (ans?.status === "not_applicable") {
          // не включаем в письмо
        } else {
          const reason = ans?.note ?? "Документ отсутствует";
          missing.push({ docKind: e.docKind, label: e.label, reason });
        }
        break;
      }
    }
  }

  const rawRequestTexts = _items.map(it => it.rawText);
  return { ...meta, rawRequestTexts, provided, missing, restoredDuplicates };
}
