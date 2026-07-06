import { describe, it, expect } from "vitest";
import { buildChecklist, caseCompleteness } from "./match.js";
import type { UploadedDocIndex } from "./match.js";
import type { RequestItem, ChecklistEntry } from "@crm/schemas";
import type { BusinessEvent } from "@crm/schemas";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _seq = 0;
function makeId(): string {
  _seq++;
  // Детерминированные UUID-подобные строки для тестов
  return `00000000-0000-4000-8000-${String(_seq).padStart(12, "0")}`;
}

function resetSeq() {
  _seq = 0;
}

const EMPTY_UPLOADED: UploadedDocIndex = new Map();

function makeItem(overrides: Partial<RequestItem> = {}): RequestItem {
  return {
    itemId: "11111111-1111-4111-8111-111111111111",
    rawText: "Предоставить платёжные поручения",
    docKinds: ["payment_order"],
    periodFrom: "2026-01-01",
    periodTo: "2026-03-31",
    counterpartyInn: null,
    counterpartyName: null,
    extractConfidence: 0.95,
    ...overrides,
  };
}

function makePaymentEvent(overrides: Partial<{
  eventId: string;
  ts: string;
  valueDate: string;
  counterpartyInn: string | null;
}> = {}): BusinessEvent {
  return {
    type: "payment_in",
    eventId: overrides.eventId ?? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ts: overrides.ts ?? "2026-02-15T10:00:00Z",
    valueDate: overrides.valueDate ?? "2026-02-15",
    amount: 100000,
    counterpartyInn: overrides.counterpartyInn ?? null,
    counterpartyName: "ООО Тест",
    purpose: "Оплата по договору",
    matchedInvoiceId: null,
    source: "bank_api",
    businessId: "biz-1",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildChecklist", () => {
  it("1. пустой items[] → ok=false, code=empty_request", () => {
    resetSeq();
    const result = buildChecklist([], [], EMPTY_UPLOADED, makeId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("empty_request");
    }
  });

  it("2. кривой период (periodFrom > periodTo) → ok=false, code=invalid_period", () => {
    resetSeq();
    const item = makeItem({ periodFrom: "2026-12-31", periodTo: "2026-01-01" });
    const result = buildChecklist([item], [], EMPTY_UPLOADED, makeId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_period");
    }
  });

  it("3. контрагент без операций → entry с availability=missing_no_event", () => {
    resetSeq();
    const item = makeItem({
      counterpartyInn: "1234567890",
      counterpartyName: "ООО Ромашка",
    });
    // события есть, но по другому ИНН
    const event = makePaymentEvent({ counterpartyInn: "9999999999" });
    const result = buildChecklist([item], [event], EMPTY_UPLOADED, makeId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBeGreaterThan(0);
      const first = result.value[0];
      expect(first?.availability).toBe("missing_no_event");
    }
  });

  it("4. have_file приоритетнее restorable — загруженный файл → availability=have_file", () => {
    resetSeq();
    const item = makeItem();
    const event = makePaymentEvent();
    // ключ: `payment_order:any:2026-02-15`
    const uploaded: UploadedDocIndex = new Map([
      ["payment_order:any:2026-02-15", "/files/pp-001.pdf"],
    ]);
    const result = buildChecklist([item], [event], uploaded, makeId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const first = result.value[0];
      expect(first?.availability).toBe("have_file");
      expect(first?.fileRef).toBe("/files/pp-001.pdf");
    }
  });

  it("5. dedupe: дублирующееся событие не создаёт вторую строку", () => {
    resetSeq();
    const item = makeItem();
    // Два одинаковых события (один eventId)
    const event = makePaymentEvent();
    const result = buildChecklist([item], [event, event], EMPTY_UPLOADED, makeId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Должна быть только одна строка (dedupe по requestItemId:docKind:eventId)
      expect(result.value.length).toBe(1);
    }
  });
});

describe("caseCompleteness", () => {
  it("6. completeness=0: нет ни одной закрытой строки", () => {
    const entries: ChecklistEntry[] = [
      {
        entryId: "e1111111-1111-4111-8111-111111111111",
        requestItemId: "r1111111-1111-4111-8111-111111111111",
        docKind: "payment_order",
        label: "Платёжное поручение · все контрагенты · весь период",
        availability: "missing_no_event",
        fileRef: null,
        evidence: [],
        confirmedByOwner: false,
      },
      {
        entryId: "e2222222-2222-4222-8222-222222222222",
        requestItemId: "r1111111-1111-4111-8111-111111111111",
        docKind: "contract",
        label: "Договор · все контрагенты · весь период",
        availability: "restorable",
        fileRef: null,
        evidence: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
        confirmedByOwner: false,
      },
    ];
    expect(caseCompleteness(entries)).toBe(0);
  });

  it("7. completeness частичный: часть have_file, часть missing → 0 < c < 1", () => {
    const entries: ChecklistEntry[] = [
      {
        entryId: "e1111111-1111-4111-8111-111111111111",
        requestItemId: "r1111111-1111-4111-8111-111111111111",
        docKind: "payment_order",
        label: "Платёжное поручение",
        availability: "have_file",
        fileRef: "/files/f1.pdf",
        evidence: [],
        confirmedByOwner: false,
      },
      {
        entryId: "e2222222-2222-4222-8222-222222222222",
        requestItemId: "r1111111-1111-4111-8111-111111111111",
        docKind: "contract",
        label: "Договор",
        availability: "missing_no_event",
        fileRef: null,
        evidence: [],
        confirmedByOwner: false,
      },
    ];
    const c = caseCompleteness(entries);
    expect(c).toBeGreaterThan(0);
    expect(c).toBeLessThan(1);
    expect(c).toBe(0.5);
  });

  it("8. completeness=1: все строки have_file или confirmedByOwner", () => {
    const entries: ChecklistEntry[] = [
      {
        entryId: "e1111111-1111-4111-8111-111111111111",
        requestItemId: "r1111111-1111-4111-8111-111111111111",
        docKind: "payment_order",
        label: "Платёжное поручение",
        availability: "have_file",
        fileRef: "/files/f1.pdf",
        evidence: [],
        confirmedByOwner: false,
      },
      {
        entryId: "e2222222-2222-4222-8222-222222222222",
        requestItemId: "r1111111-1111-4111-8111-111111111111",
        docKind: "contract",
        label: "Договор",
        availability: "restorable",
        fileRef: null,
        evidence: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
        confirmedByOwner: true,
      },
    ];
    expect(caseCompleteness(entries)).toBe(1);
  });

  it("9. property-тест: restorable entries всегда имеют evidence.length >= 1", () => {
    resetSeq();
    // Формируем реальный buildChecklist с событием — проверяем инвариант
    const item = makeItem({
      docKinds: ["payment_order", "act", "contract"],
      counterpartyInn: null,
    });
    const event = makePaymentEvent();
    const result = buildChecklist([item], [event], EMPTY_UPLOADED, makeId);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const restorableEntries = result.value.filter(
        (e) => e.availability === "restorable",
      );
      for (const entry of restorableEntries) {
        expect(entry.evidence.length).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
