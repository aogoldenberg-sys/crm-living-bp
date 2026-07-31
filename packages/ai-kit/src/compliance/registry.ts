/**
 * Реестр документов пакета.
 * Чистые функции — ноль LLM, ноль I/O.
 */

import type { ChecklistEntry } from "@crm/schemas";
import type { ClarifyAnswer } from "./clarify.js";

export type RegistryRow = {
  entryId: string;
  docKind: string;
  label: string;
  /** Итоговый статус после clarify-диалога */
  resolution: "provided" | "duplicate" | "pending_scan" | "missing" | "not_applicable";
};

/**
 * Собирает реестр документов на основе чек-листа и ответов клиента.
 * Используется в PackageResult для отображения и в DoneView для ZIP.
 */
export function buildRegistry(
  entries: ReadonlyArray<ChecklistEntry>,
  answers: ClarifyAnswer[],
): RegistryRow[] {
  const byItem = new Map<string, ClarifyAnswer>(
    answers.map(a => [a.itemId, a]),
  );

  return entries.map(e => {
    let resolution: RegistryRow["resolution"];

    switch (e.availability) {
      case "have_file":
        resolution = "provided";
        break;
      case "have_paper":
        resolution = "pending_scan";
        break;
      case "restorable":
        resolution = "duplicate";
        break;
      case "not_applicable":
        resolution = "not_applicable";
        break;
      case "missing_no_event": {
        const ans = byItem.get(e.requestItemId);
        if (ans?.status === "have_paper") {
          resolution = "pending_scan";
        } else if (ans?.status === "not_applicable") {
          resolution = "not_applicable";
        } else {
          resolution = "missing";
        }
        break;
      }
      default:
        resolution = "missing";
    }

    return { entryId: e.entryId, docKind: e.docKind, label: e.label, resolution };
  });
}
