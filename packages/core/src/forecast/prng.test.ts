import { describe, it, expect } from "vitest";
import { mulberry32, normalSample } from "./prng.js";

describe("mulberry32", () => {
  it("один seed даёт одну последовательность всегда", () => {
    const rng1 = mulberry32(42);
    const rng2 = mulberry32(42);

    const seq1 = [rng1(), rng1(), rng1(), rng1(), rng1()];
    const seq2 = [rng2(), rng2(), rng2(), rng2(), rng2()];

    expect(seq1).toEqual(seq2);
  });

  it("разные seed дают разные последовательности", () => {
    const rng1 = mulberry32(42);
    const rng2 = mulberry32(99);

    expect(rng1()).not.toBe(rng2());
  });

  it("все значения в диапазоне [0, 1)", () => {
    const rng = mulberry32(1234);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("normalSample", () => {
  it("детерминирован при том же rng", () => {
    const rng1 = mulberry32(7);
    const rng2 = mulberry32(7);

    const s1 = normalSample(0, 1, rng1);
    const s2 = normalSample(0, 1, rng2);

    expect(s1).toBe(s2);
  });

  it("среднее и σ приблизительно совпадают при большой выборке", () => {
    const rng = mulberry32(0);
    const samples: number[] = [];
    for (let i = 0; i < 10_000; i++) {
      samples.push(normalSample(100, 15, rng));
    }
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(mean).toBeCloseTo(100, 0); // точность до целых
  });
});
