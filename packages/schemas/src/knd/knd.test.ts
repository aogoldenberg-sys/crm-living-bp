import { describe, it, expect } from "vitest";
import { parseKndXml } from "./parser.js";

const XML_USN = `
<Файл КНД="1152017" ДатаДок="2024-01-31" ИННЮЛ="7701234567" КПП="770101001">
  <ДохНалПер>5000000</ДохНалПер>
  <НалБаза>5000000</НалБаза>
  <СумНал>300000</СумНал>
</Файл>
`.trim();

const XML_NDFL2 = `
<Файл КНД="1151078" ДатаДок="2024-03-01" ИННЮЛ="7701234567" КПП="770101001">
  <ИННФЛ>123456789012</ИННФЛ>
  <ГодД>2023</ГодД>
  <СуммДох>1200000</СуммДох>
</Файл>
`.trim();

const XML_UNKNOWN_KND = `
<Файл КНД="9999999" ДатаДок="2024-01-01">
  <Данные>что-то</Данные>
</Файл>
`.trim();

const XML_BROKEN = `не XML вообще`;

describe("parseKndXml — КНД 1152017 (УСН доходы)", () => {
  it("парсит корректный XML и возвращает ok=true", () => {
    const result = parseKndXml(XML_USN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.КНД).toBe("1152017");
    expect(result.value.ИННЮЛ).toBe("7701234567");
    // 5 000 000 рублей × 100 = 500 000 000 копеек
    expect((result.value as { ДохНалПер: number }).ДохНалПер).toBe(500_000_000);
    expect((result.value as { СумНал: number }).СумНал).toBe(30_000_000);
  });
});

describe("parseKndXml — КНД 1151078 (2-НДФЛ)", () => {
  it("парсит справку 2-НДФЛ и возвращает ok=true", () => {
    const result = parseKndXml(XML_NDFL2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.КНД).toBe("1151078");
    const v = result.value as { ИННФЛ: string; ГодД: number; СуммДох: number };
    expect(v.ИННФЛ).toBe("123456789012");
    expect(v.ГодД).toBe(2023);
    expect(v.СуммДох).toBe(120_000_000); // 1 200 000 руб × 100
  });
});

describe("parseKndXml — неизвестный КНД", () => {
  it("возвращает DomainError с кодом unknown_knd", () => {
    const result = parseKndXml(XML_UNKNOWN_KND);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unknown_knd");
  });
});

describe("parseKndXml — битый XML", () => {
  it("возвращает DomainError с кодом invalid_xml", () => {
    const result = parseKndXml(XML_BROKEN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid_xml");
  });
});
