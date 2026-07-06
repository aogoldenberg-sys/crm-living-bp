import { randomUUID } from "crypto";
import { describe, it, expect } from "vitest";
import type { PlanIntake } from "@crm/schemas";
import { acceptIntake } from "./acceptIntake.js";
import { loadBusinessPlan } from "./businessPlan.js";
import { loadIntake, saveIntake } from "./intake.js";
import { FakeFirestore } from "./testing/fake-firestore.js";

/** Минимальный валидный PlanIntake со статусом "draft". */
function makeDraftIntake(overrides: Partial<PlanIntake> = {}): PlanIntake {
  return {
    intakeId: randomUUID(),
    businessId: "biz-test",
    extractedAt: new Date().toISOString(),
    mappedSections: [],
    assessment: {
      strengths: [],
      concerns: [],
      gaps: [],
      assumptionsExtracted: {
        avg_check: {
          key: "avg_check",
          value: { point: 500000 },
          unit: "₽",
          origin: "ai_extracted" as const,
          confidence: 0.8,
          sourceSection: "pricing",
          verifiability: { verifiableBy: null, afterEvent: null },
        },
      },
      verifiability: [],
    },
    confidence: 0.85,
    disclaimer: "Оценка предварительная",
    status: "draft",
    mode: "document",
    ...overrides,
  };
}

// ─── ПОЗИТИВНЫЕ ────────────────────────────────────────────────────────────

describe("acceptIntake — позитивные", () => {
  it("accept draft → BusinessPlanV1 создан, assumptions перенесены", async () => {
    const db = new FakeFirestore();
    const intake = makeDraftIntake();
    await saveIntake(db, intake.businessId, intake);

    const result = await acceptIntake(db, intake.businessId, intake.intakeId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { planId } = result.value;

    const planResult = await loadBusinessPlan(db, intake.businessId, planId);
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;

    const plan = planResult.value;
    expect(plan).not.toBeNull();
    if (!plan) return;

    expect(plan.assumptions).toEqual(intake.assessment.assumptionsExtracted);
    expect(plan.version).toBe(1);
    expect(plan.parentVersion).toBeNull();
    expect(plan.status).toBe("active");
  });

  it("intake.status после accept стал 'accepted_as_v1', не 'draft'", async () => {
    const db = new FakeFirestore();
    const intake = makeDraftIntake();
    await saveIntake(db, intake.businessId, intake);

    await acceptIntake(db, intake.businessId, intake.intakeId);

    const loadResult = await loadIntake(db, intake.businessId, intake.intakeId);
    expect(loadResult.ok).toBe(true);
    if (!loadResult.ok) return;

    expect(loadResult.value?.status).toBe("accepted_as_v1");
  });

  it("sourceIntakeId в плане совпадает с intakeId", async () => {
    const db = new FakeFirestore();
    const intake = makeDraftIntake();
    await saveIntake(db, intake.businessId, intake);

    const result = await acceptIntake(db, intake.businessId, intake.intakeId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const planResult = await loadBusinessPlan(db, intake.businessId, result.value.planId);
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;

    expect(planResult.value?.sourceIntakeId).toBe(intake.intakeId);
  });

  it("plan лежит под tenants/{businessId}/business_plans/, не плоско", async () => {
    const db = new FakeFirestore();
    const intake = makeDraftIntake({ businessId: "tenant-xyz" });
    await saveIntake(db, "tenant-xyz", intake);

    const result = await acceptIntake(db, "tenant-xyz", intake.intakeId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Правильный путь — документ есть
    const correctSnap = await db
      .collection("tenants/tenant-xyz/business_plans")
      .doc(result.value.planId)
      .get();
    expect(correctSnap.exists).toBe(true);

    // Плоский путь — документа нет
    const flatSnap = await db.collection("business_plans").doc(result.value.planId).get();
    expect(flatSnap.exists).toBe(false);
  });

  it("parentVersion === null у v1 (явная проверка)", async () => {
    const db = new FakeFirestore();
    const intake = makeDraftIntake();
    await saveIntake(db, intake.businessId, intake);

    const result = await acceptIntake(db, intake.businessId, intake.intakeId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const planResult = await loadBusinessPlan(db, intake.businessId, result.value.planId);
    expect(planResult.ok).toBe(true);
    if (!planResult.ok) return;

    expect(planResult.value?.parentVersion).toBeNull();
  });
});

// ─── НЕГАТИВНЫЕ ────────────────────────────────────────────────────────────

describe("acceptIntake — негативные", () => {
  it("двойной accept → второй вызов возвращает err ALREADY_ACCEPTED, в базе ровно 1 план", async () => {
    const db = new FakeFirestore();
    const intake = makeDraftIntake();
    await saveIntake(db, intake.businessId, intake);

    const first = await acceptIntake(db, intake.businessId, intake.intakeId);
    expect(first.ok).toBe(true);

    const second = await acceptIntake(db, intake.businessId, intake.intakeId);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe("ALREADY_ACCEPTED");
    }

    // Убеждаемся что в базе ровно 1 план под этим тенантом
    const snap = await db.collection(`tenants/${intake.businessId}/business_plans`).get();
    expect(snap.docs.length).toBe(1);
  });

  it("accept несуществующего intakeId → err NOT_FOUND", async () => {
    const db = new FakeFirestore();

    const result = await acceptIntake(db, "biz-test", "00000000-0000-0000-0000-999999999999");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_FOUND");
    }
  });

  it("businessId протянут: план лежит под своим тенантом, не под чужим", async () => {
    const db = new FakeFirestore();

    const intakeA = makeDraftIntake({ businessId: "tenant-a" });
    await saveIntake(db, "tenant-a", intakeA);

    const result = await acceptIntake(db, "tenant-a", intakeA.intakeId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Под тенантом B плана нет
    const snapB = await db.collection("tenants/tenant-b/business_plans").get();
    expect(snapB.docs.length).toBe(0);

    // Под тенантом A — есть
    const snapA = await db.collection("tenants/tenant-a/business_plans").get();
    expect(snapA.docs.length).toBe(1);
  });

  it("accept intake из другого тенанта (businessId не совпадает) → NOT_FOUND", async () => {
    const db = new FakeFirestore();

    const intake = makeDraftIntake({ businessId: "tenant-real" });
    await saveIntake(db, "tenant-real", intake);

    // Пытаемся accept под другим тенантом
    const result = await acceptIntake(db, "tenant-other", intake.intakeId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_FOUND");
    }
  });

  it("intake с status 'accepted_as_v1' (без предварительного saveIntake как draft) → ALREADY_ACCEPTED", async () => {
    const db = new FakeFirestore();

    const intake = makeDraftIntake({ status: "accepted_as_v1" });
    await saveIntake(db, intake.businessId, intake);

    const result = await acceptIntake(db, intake.businessId, intake.intakeId);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("ALREADY_ACCEPTED");
    }

    // Никаких планов создано не было
    const snap = await db.collection(`tenants/${intake.businessId}/business_plans`).get();
    expect(snap.docs.length).toBe(0);
  });
});
