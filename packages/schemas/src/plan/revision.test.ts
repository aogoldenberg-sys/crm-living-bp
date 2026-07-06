import { describe, it, expect } from "vitest";
import { BusinessRevision } from "./revision.js";
import { PlanIntake } from "./intake.js";

const makeLayer = () => ({
  completeness: 0.8,
  sources: ["00000000-0000-0000-0000-000000000001"],
  missingItems: [],
});

const makeValidRevision = () => ({
  revisionId: "00000000-0000-0000-0000-000000000001",
  businessId: "biz-123",
  createdAt: "2026-07-05T10:00:00Z",
  mode: "document" as const,
  uploadedSources: [
    {
      sourceId: "00000000-0000-0000-0000-000000000002",
      kind: "bank_csv" as const,
      fileRef: "gs://bucket/file.csv",
      extractedAt: "2026-07-05T09:00:00Z",
      confidence: 0.95,
    },
  ],
  layers: {
    cash: makeLayer(),
    sales: makeLayer(),
    obligations: makeLayer(),
    owner_voice: makeLayer(),
  },
  healthCheck: {
    runway_days: 90,
    burn_rate_kopecks: 50000000,
    top_counterparties: [
      {
        inn: "7707083893",
        name: "ООО Рога и Копыта",
        totalKopecks: 100000000,
        shareOfRevenue: 0.4,
      },
    ],
    concentration_risk: 0.4,
    red_flags: ["Высокая концентрация выручки на одном клиенте"],
  },
});

describe("BusinessRevision", () => {
  it("positiv: полный валидный BusinessRevision", () => {
    const result = BusinessRevision.parse(makeValidRevision());
    expect(result.revisionId).toBe("00000000-0000-0000-0000-000000000001");
    expect(result.mode).toBe("document");
    expect(result.healthCheck.runway_days).toBe(90);
  });

  it("positiv: uploadedSources пустой массив", () => {
    const data = { ...makeValidRevision(), uploadedSources: [] };
    const result = BusinessRevision.parse(data);
    expect(result.uploadedSources).toHaveLength(0);
  });

  it("negativ: confidence > 1 в UploadedSource", () => {
    const data = {
      ...makeValidRevision(),
      uploadedSources: [
        {
          sourceId: "00000000-0000-0000-0000-000000000002",
          kind: "bank_csv",
          fileRef: "gs://bucket/file.csv",
          extractedAt: "2026-07-05T09:00:00Z",
          confidence: 1.5,
        },
      ],
    };
    expect(() => BusinessRevision.parse(data)).toThrow();
  });

  it("negativ: completeness < 0 в LayerStatus", () => {
    const data = {
      ...makeValidRevision(),
      layers: {
        ...makeValidRevision().layers,
        cash: { completeness: -0.1, sources: [], missingItems: [] },
      },
    };
    expect(() => BusinessRevision.parse(data)).toThrow();
  });

  it("negativ: mode неверный", () => {
    const data = { ...makeValidRevision(), mode: "invalid_mode" };
    expect(() => BusinessRevision.parse(data)).toThrow();
  });

  it("negativ: runway_days float", () => {
    const data = {
      ...makeValidRevision(),
      healthCheck: {
        ...makeValidRevision().healthCheck,
        runway_days: 90.5,
      },
    };
    expect(() => BusinessRevision.parse(data)).toThrow();
  });

  it("positiv: top_counterparties пустой массив", () => {
    const data = {
      ...makeValidRevision(),
      healthCheck: {
        ...makeValidRevision().healthCheck,
        top_counterparties: [],
      },
    };
    const result = BusinessRevision.parse(data);
    expect(result.healthCheck.top_counterparties).toHaveLength(0);
  });
});

describe("PlanIntake — mode с дефолтом", () => {
  const makeValidIntake = () => ({
    intakeId: "00000000-0000-0000-0000-000000000010",
    businessId: "biz-456",
    extractedAt: "2026-07-05T10:00:00Z",
    mappedSections: [],
    assessment: {
      strengths: [],
      concerns: [],
      gaps: [],
      assumptionsExtracted: {},
      verifiability: [],
    },
    confidence: 0.9,
    disclaimer: "Авторасчёт. Не является финансовым советом.",
    status: "draft" as const,
  });

  it("positiv: PlanIntake без поля mode — default применяется", () => {
    const result = PlanIntake.parse(makeValidIntake());
    expect(result.mode).toBe("document");
  });
});
