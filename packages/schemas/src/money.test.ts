import { describe, it, expect } from "vitest";
import { Kopecks, PositiveKopecks, IsoDate, IsoDateTime, Inn, DataSource } from "./money.js";

describe("Kopecks", () => {
  it("принимает целое число", () => {
    expect(Kopecks.parse(100)).toBe(100);
  });
  it("принимает ноль", () => {
    expect(Kopecks.parse(0)).toBe(0);
  });
  it("принимает отрицательное целое", () => {
    expect(Kopecks.parse(-500)).toBe(-500);
  });
  it("отклоняет float", () => {
    expect(() => Kopecks.parse(100.5)).toThrow();
  });
});

describe("PositiveKopecks", () => {
  it("принимает положительное целое", () => {
    expect(PositiveKopecks.parse(1)).toBe(1);
  });
  it("отклоняет ноль", () => {
    expect(() => PositiveKopecks.parse(0)).toThrow();
  });
  it("отклоняет отрицательное", () => {
    expect(() => PositiveKopecks.parse(-1)).toThrow();
  });
  it("отклоняет float", () => {
    expect(() => PositiveKopecks.parse(1.5)).toThrow();
  });
});

describe("IsoDate", () => {
  it("принимает корректную дату", () => {
    expect(IsoDate.parse("2026-06-13")).toBe("2026-06-13");
  });
  it("отклоняет дату с временем", () => {
    expect(() => IsoDate.parse("2026-06-13T10:00:00Z")).toThrow();
  });
  it("отклоняет неполную дату", () => {
    expect(() => IsoDate.parse("2026-6-1")).toThrow();
  });
  it("отклоняет несуществующий месяц 13", () => {
    expect(() => IsoDate.parse("2026-13-45")).toThrow();
  });
  it("отклоняет несуществующий день 00", () => {
    expect(() => IsoDate.parse("2026-06-00")).toThrow();
  });
});

describe("IsoDateTime", () => {
  it("принимает UTC datetime с Z", () => {
    expect(IsoDateTime.parse("2026-06-13T10:00:00Z")).toBe("2026-06-13T10:00:00Z");
  });
  it("отклоняет datetime с offset (+03:00) — ломает курсор Firestore", () => {
    expect(() => IsoDateTime.parse("2026-06-13T13:00:00+03:00")).toThrow();
  });
  it("отклоняет datetime без таймзоны — сломает машину времени", () => {
    expect(() => IsoDateTime.parse("2026-06-13T10:00:00")).toThrow();
  });
  it("отклоняет дату без времени", () => {
    expect(() => IsoDateTime.parse("2026-06-13")).toThrow();
  });
});

describe("Inn", () => {
  it("принимает 10-значный ИНН", () => {
    expect(Inn.parse("7707083893")).toBe("7707083893");
  });
  it("принимает 12-значный ИНН", () => {
    expect(Inn.parse("123456789012")).toBe("123456789012");
  });
  it("отклоняет 9-значный", () => {
    expect(() => Inn.parse("123456789")).toThrow();
  });
  it("отклоняет ИНН с буквами", () => {
    expect(() => Inn.parse("770708389X")).toThrow();
  });
});

describe("DataSource", () => {
  it("принимает допустимый источник", () => {
    expect(DataSource.parse("bank_api")).toBe("bank_api");
  });
  it("отклоняет неизвестный источник", () => {
    expect(() => DataSource.parse("unknown_source")).toThrow();
  });
});
