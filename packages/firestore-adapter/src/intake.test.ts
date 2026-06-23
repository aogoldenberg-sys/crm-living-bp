import { describe, it, expect } from "vitest";
import type { PlanIntake } from "@crm/schemas";
import { saveIntake, loadIntake } from "./intake.js";
import { FakeFirestore, ErrorFakeFirestore } from "./testing/fake-firestore.js";

/** Минимальный валидный PlanIntake для тестов. */
function makePlanIntake(overrides?: Partial<PlanIntake>): PlanIntake {
  return {
    intakeId: "00000000-0000-0000-0000-000000000001",
    businessId: "test-biz",
    extractedAt: "2026-06-16T10:00:00Z",
    mappedSections: [
      {
        sectionId: "executive_summary",
        present: true,
        contentSummary: "Краткое описание",
        confidence: 0.9,
      },
    ],
    assessment: {
      strengths: [],
      concerns: [],
      gaps: [],
      assumptionsExtracted: {},
      verifiability: [],
    },
    confidence: 0.85,
    disclaimer: "Анализ выполнен автоматически",
    status: "draft",
    ...overrides,
  };
}

// ─── ПОЗИТИВНЫЕ ────────────────────────────────────────────────────────────

describe("saveIntake + loadIntake — позитивные", () => {
  it("saveIntake → loadIntake возвращает тот же объект", async () => {
    const db = new FakeFirestore();
    const intake = makePlanIntake();

    const saveResult = await saveIntake(db, "test-biz", intake);
    expect(saveResult.ok).toBe(true);

    const loadResult = await loadIntake(db, "test-biz", intake.intakeId);
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      expect(loadResult.value).toEqual(intake);
    }
  });

  it("plan_intake пишется под tenants/{businessId}/, не плоско", async () => {
    const db = new FakeFirestore();
    const intake = makePlanIntake({ businessId: "tenant-abc" });

    await saveIntake(db, "tenant-abc", intake);

    // Читаем через правильный путь — документ должен быть там
    const correctPath = db.collection("tenants/tenant-abc/plan_intake").doc(intake.intakeId);
    const snap = await correctPath.get();
    expect(snap.exists).toBe(true);

    // Плоский путь — документа нет
    const flatPath = db.collection("plan_intake").doc(intake.intakeId);
    const flatSnap = await flatPath.get();
    expect(flatSnap.exists).toBe(false);
  });
});

// ─── НЕГАТИВНЫЕ ────────────────────────────────────────────────────────────

describe("loadIntake — негативные", () => {
  it("loadIntake несуществующего intakeId → ok(null)", async () => {
    const db = new FakeFirestore();

    const result = await loadIntake(db, "test-biz", "00000000-0000-0000-0000-999999999999");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  it("status при сохранении 'draft' сохраняется как 'draft' (не меняется на accepted_as_v1)", async () => {
    const db = new FakeFirestore();
    const intake = makePlanIntake({ status: "draft" });

    await saveIntake(db, "test-biz", intake);
    const result = await loadIntake(db, "test-biz", intake.intakeId);

    expect(result.ok).toBe(true);
    if (result.ok && result.value !== null) {
      expect(result.value.status).toBe("draft");
    }
  });

  it("businessId протянут в путь записи (не другой тенант)", async () => {
    const db = new FakeFirestore();
    const intakeA = makePlanIntake({
      intakeId: "00000000-0000-0000-0000-000000000001",
      businessId: "tenant-a",
    });

    await saveIntake(db, "tenant-a", intakeA);

    // Тенант B не видит документ тенанта A
    const resultB = await loadIntake(db, "tenant-b", intakeA.intakeId);
    expect(resultB.ok).toBe(true);
    if (resultB.ok) {
      expect(resultB.value).toBeNull();
    }

    // Тенант A видит свой документ
    const resultA = await loadIntake(db, "tenant-a", intakeA.intakeId);
    expect(resultA.ok).toBe(true);
    if (resultA.ok) {
      expect(resultA.value).not.toBeNull();
    }
  });

  it("STORAGE_ERROR при сбое db в saveIntake", async () => {
    const db = new ErrorFakeFirestore(new Error("Firestore unavailable"));
    const intake = makePlanIntake();

    const result = await saveIntake(db, "test-biz", intake);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("STORAGE_ERROR");
    }
  });

  it("STORAGE_ERROR при сбое db в loadIntake", async () => {
    const db = new ErrorFakeFirestore(new Error("quota exceeded"));

    const result = await loadIntake(db, "test-biz", "00000000-0000-0000-0000-000000000001");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("STORAGE_ERROR");
    }
  });
});
