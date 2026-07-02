import { describe, it, expect } from "vitest";
import type { CashForecast } from "@crm/core/forecast";
import { saveForecast, loadForecast } from "./forecast.js";
import { FakeFirestore, ErrorFakeFirestore } from "./testing/fake-firestore.js";

const sampleForecast: CashForecast = {
  generatedAt: "2026-06-13",
  horizonDays: 90,
  dailyBalances: [
    { date: "2026-06-14", p10: 50_000_00, p50: 100_000_00, p90: 150_000_00 },
    { date: "2026-06-15", p10: 40_000_00, p50: 90_000_00, p90: 140_000_00 },
  ],
  gapDate: null,
  gapAmount: null,
  hardGapDate: null,
  pessimisticGapDate: null,
  confidence: 0.92,
};

describe("saveForecast + loadForecast", () => {
  it("saveForecast → loadForecast возвращает тот же объект", async () => {
    const db = new FakeFirestore() ;

    const saveResult = await saveForecast(db, "test-biz", sampleForecast);
    expect(saveResult.ok).toBe(true);

    const loadResult = await loadForecast(db, "test-biz");
    expect(loadResult.ok).toBe(true);
    if (loadResult.ok) {
      expect(loadResult.value).toEqual(sampleForecast);
    }
  });

  it("loadForecast возвращает null если прогноза ещё нет", async () => {
    const db = new FakeFirestore() ;

    const result = await loadForecast(db, "test-biz");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  it("STORAGE_ERROR при сбое db", async () => {
    const db = new ErrorFakeFirestore(
      new Error("connection refused"),
    ) ;

    const saveResult = await saveForecast(db, "test-biz", sampleForecast);
    expect(saveResult.ok).toBe(false);
    if (!saveResult.ok) {
      expect(saveResult.error.code).toBe("STORAGE_ERROR");
    }

    const loadResult = await loadForecast(db, "test-biz");
    expect(loadResult.ok).toBe(false);
    if (!loadResult.ok) {
      expect(loadResult.error.code).toBe("STORAGE_ERROR");
    }
  });
});
