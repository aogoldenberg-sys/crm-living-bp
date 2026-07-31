/**
 * Конвейер сборки пакета документов.
 * Принимает уже построенный чек-лист (из buildChecklist) и ответы клиента.
 * Выполняет: buildDraftInput → draftResponse → buildRegistry.
 *
 * ПРАВИЛО: если selectOpenItems вернул 0 позиций — parseClarifyAnswers
 * не вызывается (ноль токенов на уточнение).
 */

import type { AnthropicClient } from "../client.js";
import type { RequestItem, ChecklistEntry } from "@crm/schemas";
import { type Result, ok, err } from "@crm/core";
import { selectOpenItems, buildDraftInput, type ClarifyAnswer } from "./clarify.js";
import { draftResponse } from "./draft.js";
import { buildRegistry, type RegistryRow } from "./registry.js";

export type PipelineMeta = {
  authority: string;
  incomingRef: { number: string | null; date: string | null };
  companyName: string;
  companyInn: string;
};

export type PipelineResult = {
  draftLetter: string;
  registry: RegistryRow[];
  openItemCount: number;
};

/**
 * Конечная точка конвейера: items + entries + answers + meta → пакет.
 *
 * Предусловие: answers покрывают все open-items (entries с missing_no_event).
 * Нарушение предусловия — не ошибка: missing items просто попадут в секцию missing.
 */
export async function runPipeline(
  client: AnthropicClient,
  items: ReadonlyArray<RequestItem>,
  entries: ReadonlyArray<ChecklistEntry>,
  answers: ClarifyAnswer[],
  meta: PipelineMeta,
): Promise<Result<PipelineResult>> {
  const openItems = selectOpenItems(items, entries);

  const draftInput = buildDraftInput(items, entries, answers, meta);

  const letterResult = await draftResponse(client, draftInput);
  if (!letterResult.ok) return err(letterResult.error);

  const registry = buildRegistry(entries, answers);

  return ok({
    draftLetter: letterResult.value,
    registry,
    openItemCount: openItems.length,
  });
}
