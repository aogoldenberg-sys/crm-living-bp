import { describe, it, expect } from "vitest";
import type { ForecastPlan } from "@crm/core/forecast";
import { loadPlan, savePlan } from "./plan.js";
import { FakeFirestore, ErrorFakeFirestore } from "./testing/fake-firestore.js";

const samplePlan: ForecastPlan = {
  startDate: "2026-06-13",
  fixedDailyOutflow: 50_000_00,
  expectedDailyDeals: 3.5,
  avgDealAmountKopecks: 120_000_00,
};

describe("savePlan + loadPlan", () => {
  it("savePlan → loadPlan возвращает тот же объект", async () => {
    const db = new FakeFirestore() ;

    const saveResult = await savePlan(db, "test-biz", samplePlan);
    expect(saveResult.ok).toBe(true);

    const loadResult = await loadPlan(db, "test-biz");
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      expect(loadResult.value).toEqual(samplePlan);
    }
  });

  it("loadPlan возвращает null если план ещё не задан", async () => {
    const db = new FakeFirestore() ;

    const result = await loadPlan(db, "test-biz");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  it("STORAGE_ERROR при сбое db", async () => {
    const db = new ErrorFakeFirestore(
      new Error("quota exceeded"),
    ) ;

    const saveResult = await savePlan(db, "test-biz", samplePlan);
    expect(saveResult.ok).toBe(false);
    if (!saveResult.ok) {
      expect(saveResult.error.code).toBe("STORAGE_ERROR");
    }

    const loadResult = await loadPlan(db, "test-biz");
    expect(loadResult.ok).toBe(false);
    if (!loadResult.ok) {
      expect(loadResult.error.code).toBe("STORAGE_ERROR");
    }
  });
});
