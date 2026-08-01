/**
 * Реестр документов пакета.
 * Реестр = приложение к письму. Только документы, которые ПРЕДОСТАВЛЯЮТСЯ.
 * missing и not_applicable — в пояснения письма, не в реестр.
 * Чистые функции — ноль LLM, ноль I/O.
 */

import type { ChecklistEntry } from "@crm/schemas";
import type { ClarifyAnswer } from "./clarify.js";

export type RegistryRow = {
  entryId: string;
  docKind: string;
  label: string;
  /** Только записи, входящие в физический пакет */
  resolution: "provided" | "duplicate" | "pending_scan";
};

/**
 * Собирает реестр документов, предоставляемых в пакет.
 * Исключает missing и not_applicable — они объясняются в письме,
 * но в приложение к письму (опись) не входят.
 */
export function buildRegistry(
  entries: ReadonlyArray<ChecklistEntry>,
  answers: ClarifyAnswer[],
): RegistryRow[] {
  const byItem = new Map<string, ClarifyAnswer>(
    answers.map(a => [a.itemId, a]),
  );

  const rows: RegistryRow[] = [];

  for (const e of entries) {
    let resolution: RegistryRow["resolution"] | null = null;

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
      case "missing_no_event": {
        const ans = byItem.get(e.requestItemId);
        if (ans?.status === "have_paper") {
          resolution = "pending_scan";
        }
        // not_applicable → пропуск; missing → пропуск (в письмо, не в реестр)
        break;
      }
      // not_applicable → пропуск
    }

    if (resolution !== null) {
      rows.push({ entryId: e.entryId, docKind: e.docKind, label: e.label, resolution });
    }
  }

  return rows;
}
