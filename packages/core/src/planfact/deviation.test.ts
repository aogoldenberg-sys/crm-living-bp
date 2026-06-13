import { describe, it, expect } from "vitest";
import { computeDeviation, computeEma } from "./deviation.js";

describe("computeDeviation", () => {
  it("факт равен плану → on_target, 0%", () => {
    const r = computeDeviation(100_000, 100_000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.deviationPct).toBe(0);
    expect(r.value.direction).toBe("on_target");
  });

  it("факт в пределах ±1% → on_target", () => {
    const r = computeDeviation(100_500, 100_000); // +0.5%
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.direction).toBe("on_target");
  });

  it("факт на 20% ниже плана → below", () => {
    const r = computeDeviation(80_000, 100_000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.deviationPct).toBe(-20);
    expect(r.value.direction).toBe("below");
  });

  it("факт на 10% выше плана → above", () => {
    const r = computeDeviation(110_000, 100_000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.deviationPct).toBe(10);
    expect(r.value.direction).toBe("above");
  });

  it("план = 0 → ошибка INVALID_PERIOD", () => {
    const r = computeDeviation(100_000, 0);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("INVALID_PERIOD");
  });

  it("округление до 2 знаков", () => {
    // 1/3 * 100 = 33.333... → 33.33
    const r = computeDeviation(100_000 + 33_333, 100_000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.deviationPct).toBe(33.33);
  });
});

describe("computeEma", () => {
  it("пустой массив → пустой массив", () => {
    expect(computeEma([], 0.3)).toEqual([]);
  });

  it("один элемент → тот же элемент", () => {
    expect(computeEma([42], 0.5)).toEqual([42]);
  });

  it("alpha=1 → EMA совпадает с исходным рядом", () => {
    const values = [10, 20, 30, 40];
    const ema = computeEma(values, 1);
    expect(ema).toEqual([10, 20, 30, 40]);
  });

  it("alpha=0 → EMA всегда равна первому значению", () => {
    const values = [10, 20, 30, 40];
    const ema = computeEma(values, 0);
    expect(ema).toEqual([10, 10, 10, 10]);
  });

  it("стандартный расчёт EMA alpha=0.5", () => {
    // ema[0] = 10
    // ema[1] = 0.5*20 + 0.5*10 = 15
    // ema[2] = 0.5*30 + 0.5*15 = 22.5
    const ema = computeEma([10, 20, 30], 0.5);
    expect(ema).toEqual([10, 15, 22.5]);
  });
});
