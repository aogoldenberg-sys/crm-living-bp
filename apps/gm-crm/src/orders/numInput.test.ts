import { describe, it, expect } from "vitest";
import { parseDecimal, rubToKopecks, parseRub, parseQty } from "./numInput";

describe("parseDecimal", () => {
  it("принимает точку и запятую", () => {
    expect(parseDecimal("12.50")).toBe(12.5);
    expect(parseDecimal("12,50")).toBe(12.5);
    expect(parseDecimal("12.")).toBe(12);
    expect(parseDecimal(",5")).toBe(0.5);
  });
  it("игнорирует пробелы и NBSP", () => {
    expect(parseDecimal("1 234,56")).toBe(1234.56);
    expect(parseDecimal("1 234")).toBe(1234);
    expect(parseDecimal("1 234")).toBe(1234);
    expect(parseDecimal("  7 ")).toBe(7);
  });
  it("возвращает null, а не NaN", () => {
    expect(parseDecimal("")).toBeNull();
    expect(parseDecimal("abc")).toBeNull();
    expect(parseDecimal("1,2,3")).toBeNull();
    expect(parseDecimal("1e5")).toBeNull();
    expect(parseDecimal(".")).toBeNull();
  });
});

describe("rubToKopecks", () => {
  it("округляет до целых копеек", () => {
    expect(rubToKopecks("12,50")).toBe(1250);
    expect(rubToKopecks("0.1")).toBe(10);
    expect(rubToKopecks("1.005")).toBe(Math.round(1.005 * 100));
    expect(Number.isInteger(rubToKopecks("19.99"))).toBe(true);
  });
  it("пустое → emptyValue, некорректное/отрицательное → null", () => {
    expect(rubToKopecks("")).toBeNull();
    expect(rubToKopecks("", 0)).toBe(0);
    expect(rubToKopecks("-5")).toBeNull();
    expect(rubToKopecks("x")).toBeNull();
  });
  it("parseRub", () => {
    expect(parseRub("12,345")).toBe(12.35);
    expect(parseRub("", 0)).toBe(0);
  });
});

describe("parseQty", () => {
  it("дробное весовое количество", () => {
    expect(parseQty("0,5")).toBe(0.5);
    expect(parseQty("1.2345")).toBe(1.235);
    expect(parseQty("3")).toBe(3);
  });
  it("0, пустое и отрицательное", () => {
    expect(parseQty("0")).toBeNull();
    expect(parseQty("0", true)).toBe(0);
    expect(parseQty("")).toBeNull();
    expect(parseQty("-1", true)).toBeNull();
  });
});
