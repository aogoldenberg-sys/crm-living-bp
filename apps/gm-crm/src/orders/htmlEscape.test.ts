import { describe, it, expect } from "vitest";
import { esc } from "./htmlEscape";

describe("esc", () => {
  it("экранирует теги, кавычки и амперсанд", () => {
    expect(esc(`<img src=x onerror="alert(1)">`)).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(esc(`ООО 'Рога & Копыта'`)).toBe("ООО &#39;Рога &amp; Копыта&#39;");
  });
  it("null/undefined/числа", () => {
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
    expect(esc(7701234567)).toBe("7701234567");
  });
});
