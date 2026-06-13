import { describe, it, expect } from "vitest";
import { computePercentiles, percentileFromSorted } from "./percentile.js";

describe("percentileFromSorted", () => {
  it("пустой массив возвращает 0", () => {
    expect(percentileFromSorted([], 0.5)).toBe(0);
  });

  it("один элемент → всегда этот элемент", () => {
    expect(percentileFromSorted([42], 0.1)).toBe(42);
    expect(percentileFromSorted([42], 0.9)).toBe(42);
  });

  it("корректные перцентили для известного массива", () => {
    // [1..10], p10 = idx=1 = 2, p50 = idx=5 = 6, p90 = idx=9 = 10
    const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentileFromSorted(arr, 0.1)).toBe(2);
    expect(percentileFromSorted(arr, 0.5)).toBe(6);
    expect(percentileFromSorted(arr, 0.9)).toBe(10);
  });
});

describe("computePercentiles", () => {
  it("p10 <= p50 <= p90", () => {
    const values = [50, 10, 90, 30, 70, 20, 80, 40, 60, 100];
    const { p10, p50, p90 } = computePercentiles(values);

    expect(p10).toBeLessThanOrEqual(p50);
    expect(p50).toBeLessThanOrEqual(p90);
  });

  it("детерминирован и сортирует входной массив", () => {
    const values = [5, 1, 3, 2, 4];
    const result = computePercentiles(values);

    expect(result.p10).toBe(1);
    expect(result.p50).toBe(3);
    expect(result.p90).toBe(5);
  });
});
