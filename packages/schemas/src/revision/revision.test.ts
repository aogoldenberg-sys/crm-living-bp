import { describe, it, expect } from "vitest";
import {
  SourceDocument,
  Counterparty,
  AuthorityRequest,
  HumanTask,
  TurnoverSheet,
  FixedAssetCard,
} from "./index.js";

const NOW = "2026-07-07T10:00:00Z";
const UUID = "00000000-0000-0000-0000-000000000001";
const UUID2 = "00000000-0000-0000-0000-000000000002";
const INN = "7707083893";

describe("SourceDocument", () => {
  it("valid parses ok", () => {
    expect(() =>
      SourceDocument.parse({
        docId: UUID,
        businessId: "biz-1",
        kind: "bank_statement",
        fileRef: "gs://bucket/file.pdf",
        uploadedAt: NOW,
        pages: 10,
        mappedSections: [],
        status: "uploaded",
      }),
    ).not.toThrow();
  });

  it("invalid kind throws", () => {
    expect(() =>
      SourceDocument.parse({
        docId: UUID,
        businessId: "biz-1",
        kind: "unknown_kind",
        fileRef: "gs://bucket/file.pdf",
        uploadedAt: NOW,
        pages: 10,
        mappedSections: [],
        status: "uploaded",
      }),
    ).toThrow();
  });

  it("mappedSection with confidence out of range throws", () => {
    expect(() =>
      SourceDocument.parse({
        docId: UUID,
        businessId: "biz-1",
        kind: "cash_report",
        fileRef: "gs://bucket/file.pdf",
        uploadedAt: NOW,
        pages: 5,
        mappedSections: [{ sectionId: "s1", pageRange: [0, 4], confidence: 1.5 }],
        status: "parsed",
      }),
    ).toThrow();
  });

  it("sha256 optional, length 64 enforced", () => {
    expect(() =>
      SourceDocument.parse({
        docId: UUID,
        businessId: "biz-1",
        kind: "fin_report",
        fileRef: "gs://bucket/file.pdf",
        uploadedAt: NOW,
        pages: 3,
        mappedSections: [],
        status: "mapped",
        sha256: "a".repeat(63), // too short
      }),
    ).toThrow();
  });
});

describe("Counterparty", () => {
  it("valid supplier parses ok", () => {
    expect(() =>
      Counterparty.parse({ inn: INN, name: "ООО Ромашка", role: "supplier", share: 0.35 }),
    ).not.toThrow();
  });

  it("null share is valid", () => {
    expect(() =>
      Counterparty.parse({ inn: INN, name: "ООО Ромашка", role: "buyer", share: null }),
    ).not.toThrow();
  });

  it("invalid INN throws", () => {
    expect(() =>
      Counterparty.parse({ inn: "123", name: "ООО Ромашка", role: "supplier", share: 0.1 }),
    ).toThrow();
  });

  it("share > 1 throws", () => {
    expect(() =>
      Counterparty.parse({ inn: INN, name: "ООО Ромашка", role: "buyer", share: 1.5 }),
    ).toThrow();
  });
});

describe("AuthorityRequest", () => {
  it("valid received parses ok", () => {
    expect(() =>
      AuthorityRequest.parse({
        requestId: UUID,
        businessId: "biz-1",
        authority: "fns",
        requestDocRef: "gs://bucket/req.pdf",
        responseDraftRef: null,
        receivedAt: NOW,
        status: "received",
      }),
    ).not.toThrow();
  });

  it("with responseDraftRef parses ok", () => {
    expect(() =>
      AuthorityRequest.parse({
        requestId: UUID,
        businessId: "biz-1",
        authority: "bank",
        requestDocRef: "gs://bucket/req.pdf",
        responseDraftRef: "gs://bucket/draft.pdf",
        receivedAt: NOW,
        status: "draft_ready",
      }),
    ).not.toThrow();
  });

  it("invalid authority kind throws", () => {
    expect(() =>
      AuthorityRequest.parse({
        requestId: UUID,
        businessId: "biz-1",
        authority: "court", // not in AuthorityKind
        requestDocRef: "gs://bucket/req.pdf",
        responseDraftRef: null,
        receivedAt: NOW,
        status: "received",
      }),
    ).toThrow();
  });

  it("invalid status throws", () => {
    expect(() =>
      AuthorityRequest.parse({
        requestId: UUID,
        businessId: "biz-1",
        authority: "mvd",
        requestDocRef: "gs://bucket/req.pdf",
        responseDraftRef: null,
        receivedAt: NOW,
        status: "closed", // not in enum
      }),
    ).toThrow();
  });
});

describe("HumanTask", () => {
  it("valid open task parses ok", () => {
    expect(() =>
      HumanTask.parse({
        taskId: UUID,
        businessId: "biz-1",
        reason: "Не хватает выписки за Q1",
        sectionRef: "cash-flow-q1",
        requiredDoc: "bank_statement",
        status: "open",
        createdBy: "system",
        createdAt: NOW,
      }),
    ).not.toThrow();
  });

  it("null requiredDoc is valid", () => {
    expect(() =>
      HumanTask.parse({
        taskId: UUID,
        businessId: "biz-1",
        reason: "Нужна сверка с контрагентом",
        sectionRef: "obligations",
        requiredDoc: null,
        status: "done",
        createdBy: "system",
        createdAt: NOW,
      }),
    ).not.toThrow();
  });

  it("createdBy not 'system' throws", () => {
    expect(() =>
      HumanTask.parse({
        taskId: UUID,
        businessId: "biz-1",
        reason: "test",
        sectionRef: "sales",
        requiredDoc: null,
        status: "open",
        createdBy: "admin", // must be literal "system"
        createdAt: NOW,
      }),
    ).toThrow();
  });

  it("invalid requiredDoc kind throws", () => {
    expect(() =>
      HumanTask.parse({
        taskId: UUID,
        businessId: "biz-1",
        reason: "test",
        sectionRef: "sales",
        requiredDoc: "invoice", // not in SourceDocKind
        status: "open",
        createdBy: "system",
        createdAt: NOW,
      }),
    ).toThrow();
  });
});

describe("TurnoverSheet", () => {
  it("valid parses ok", () => {
    expect(() =>
      TurnoverSheet.parse({
        cardId: UUID,
        businessId: "biz-1",
        accountCode: "60",
        periodStart: "2026-01-01",
        periodEnd: "2026-03-31",
        openingDebit: 100000,
        openingCredit: 0,
        turnoverDebit: 500000,
        turnoverCredit: 450000,
        closingDebit: 150000,
        closingCredit: 0,
        uploadedAt: NOW,
        sourceDocId: UUID2,
      }),
    ).not.toThrow();
  });

  it("invalid periodStart format throws", () => {
    expect(() =>
      TurnoverSheet.parse({
        cardId: UUID,
        businessId: "biz-1",
        accountCode: "51",
        periodStart: "01.01.2026", // wrong format
        periodEnd: "2026-03-31",
        openingDebit: 0,
        openingCredit: 0,
        turnoverDebit: 0,
        turnoverCredit: 0,
        closingDebit: 0,
        closingCredit: 0,
        uploadedAt: NOW,
        sourceDocId: UUID2,
      }),
    ).toThrow();
  });

  it("float kopecks throws", () => {
    expect(() =>
      TurnoverSheet.parse({
        cardId: UUID,
        businessId: "biz-1",
        accountCode: "62",
        periodStart: "2026-01-01",
        periodEnd: "2026-03-31",
        openingDebit: 100.5, // float forbidden
        openingCredit: 0,
        turnoverDebit: 0,
        turnoverCredit: 0,
        closingDebit: 0,
        closingCredit: 0,
        uploadedAt: NOW,
        sourceDocId: UUID2,
      }),
    ).toThrow();
  });
});

describe("FixedAssetCard", () => {
  it("valid parses ok", () => {
    expect(() =>
      FixedAssetCard.parse({
        assetId: UUID,
        businessId: "biz-1",
        name: "Компьютер Dell",
        inventoryNumber: "ОС-0001",
        initialCostKopecks: 15000000,
        residualCostKopecks: 9000000,
        usefulLifeMonths: 36,
        commissionedAt: "2024-01-15",
        uploadedAt: NOW,
        sourceDocId: UUID2,
      }),
    ).not.toThrow();
  });

  it("usefulLifeMonths zero throws", () => {
    expect(() =>
      FixedAssetCard.parse({
        assetId: UUID,
        businessId: "biz-1",
        name: "Принтер",
        inventoryNumber: "ОС-0002",
        initialCostKopecks: 5000000,
        residualCostKopecks: 5000000,
        usefulLifeMonths: 0, // must be positive
        commissionedAt: "2024-01-15",
        uploadedAt: NOW,
        sourceDocId: UUID2,
      }),
    ).toThrow();
  });

  it("missing required field throws", () => {
    expect(() =>
      FixedAssetCard.parse({
        assetId: UUID,
        businessId: "biz-1",
        // name missing
        inventoryNumber: "ОС-0003",
        initialCostKopecks: 5000000,
        residualCostKopecks: 5000000,
        usefulLifeMonths: 24,
        commissionedAt: "2024-01-15",
        uploadedAt: NOW,
        sourceDocId: UUID2,
      }),
    ).toThrow();
  });
});
