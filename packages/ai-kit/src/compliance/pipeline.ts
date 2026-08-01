/**
 * Конвейер сборки пакета документов.
 * Принимает уже построенный чек-лист (из buildChecklist) и ответы клиента.
 * Выполняет: buildDraftInput → draftResponse → buildRegistry.
 *
 * ПРАВИЛО: если selectOpenItems вернул 0 позиций — parseClarifyAnswers
 * не вызывается (ноль токенов на уточнение).
 */

import type { AnthropicClient } from "../client.js";
import type { RequestItem, ChecklistEntry, RequestingAuthority } from "@crm/schemas";
import { type Result, ok, err } from "@crm/core";
import { selectOpenItems, buildDraftInput, type ClarifyAnswer } from "./clarify.js";
import { draftResponse } from "./draft.js";
import { buildRegistry, type RegistryRow } from "./registry.js";
import { buildClientPosition } from "./position.js";

export type PipelineMeta = {
  authority: RequestingAuthority;
  incomingRef: { number: string | null; date: string | null };
  companyName: string;
  companyInn: string;
};

export type PipelineResult = {
  draftLetter: string;
  registry: RegistryRow[];
  clientPosition: string;
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

  const positionResult = await buildClientPosition(
    client,
    draftInput.missing.map(m => ({ docKind: m.docKind, label: m.label, userNote: m.reason })),
  );
  if (!positionResult.ok) return err(positionResult.error);

  return ok({
    draftLetter: letterResult.value,
    registry,
    clientPosition: positionResult.value,
    openItemCount: openItems.length,
  });
}
