import { describe, it, expect } from "vitest";
import { mapPageToSection, mapDocumentToSections } from "./rule-mapper.js";

describe("mapPageToSection", () => {
  it("текст с финансовыми словами → finances", () => {
    const text = "В этом разделе описаны финанс компании: выручка и прибыль за год.";
    expect(mapPageToSection(text)).toBe("finances");
  });

  it("текст с маркетинговыми словами → marketing_strategy", () => {
    const text = "Стратегия маркетинга: реклама и продвижение в социальных сетях.";
    expect(mapPageToSection(text)).toBe("marketing_strategy");
  });

  it("текст с одним ключевым словом → null (меньше 2 совпадений)", () => {
    const text = "Просто одно слово маркетинг и больше ничего полезного.";
    expect(mapPageToSection(text)).toBeNull();
  });

  it("пустой текст → null", () => {
    expect(mapPageToSection("")).toBeNull();
  });
});

describe("mapDocumentToSections", () => {
  it("5 страниц → Map с несколькими разделами", () => {
    const pages = [
      { pageNum: 1, text: "Резюме проекта: краткое введение в бизнес-план, цель проекта" },
      { pageNum: 2, text: "Финансы: выручка, прибыль, бюджет, доход и расход за период" },
      { pageNum: 3, text: "Рынок: объём рынка, TAM SAM SOM, сегмент потребителей" },
      { pageNum: 4, text: "Команда: директор и сотрудники, опыт команды, генеральный" },
      { pageNum: 5, text: "Нет ключевых слов здесь совсем ничего нет" },
    ];

    const result = mapDocumentToSections(pages);

    expect(result.size).toBeGreaterThanOrEqual(2);
    expect(result.has("executive_summary")).toBe(true);
    expect(result.has("finances")).toBe(true);
    expect(result.get("executive_summary")?.pages).toContain(1);
    expect(result.get("finances")?.pages).toContain(2);
  });

  it("confidence растёт при нескольких страницах одного раздела", () => {
    const pages = [
      { pageNum: 1, text: "Финансы: выручка, прибыль, бюджет, доход" },
      { pageNum: 2, text: "Финансы: расход, выручка, прибыль, бюджет" },
    ];

    const result = mapDocumentToSections(pages);
    const fin = result.get("finances");

    expect(fin).toBeDefined();
    expect(fin!.pages).toHaveLength(2);
    // 0.7 + 2 * 0.05 = 0.8
    expect(fin!.confidence).toBeGreaterThan(0.7);
  });

  it("пустой массив страниц → пустая Map", () => {
    const result = mapDocumentToSections([]);
    expect(result.size).toBe(0);
  });
});
