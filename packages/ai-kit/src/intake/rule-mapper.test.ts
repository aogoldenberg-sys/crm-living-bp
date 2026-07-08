import { describe, it, expect } from "vitest";
import { mapPageToSection, mapDocumentToSections } from "./rule-mapper.js";

// Actual keywords pulled from SECTION_KEYWORDS in rule-mapper.ts
// Each fixture starts with the header keyword to trigger the ×3 boost

describe("mapPageToSection", () => {
  it("текст с финансовыми словами → finances", () => {
    const text = "В этом разделе описаны финанс компании: выручка и прибыль за год.";
    expect(mapPageToSection(text)).toBe("finances");
  });

  it("текст с маркетинговыми словами → marketing_strategy", () => {
    const text = "Стратегия маркетинга: реклама и продвижение в социальных сетях.";
    expect(mapPageToSection(text)).toBe("marketing_strategy");
  });

  it("текст с одним ключевым словом в теле и НЕ в заголовке → null (score < 2)", () => {
    // keyword "маркетинг" appears only past char 80, so no header boost; body score = 1 < 2
    const text = "Страница без заголовка и без ключевых слов в первых восьмидесяти символах — " +
      "маркетинг";
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

describe("E2E scoring", () => {
  it("synthetic 10-page plan: ≥7 pages map correctly", () => {
    // Fixtures use actual keywords from SECTION_KEYWORDS.
    // Header (first 80 chars) contains a keyword → ×3 boost ensures score ≥ 2 even on short texts.
    const fixtures: Array<{ text: string; expected: string }> = [
      {
        text: "Резюме проекта\nОбзор и краткое введение в цель проекта и summary бизнес-идеи.",
        expected: "executive_summary",
      },
      {
        text: "Проблема клиента\nБоль и pain point: challenge состоит в задача оптимизации.",
        expected: "problem",
      },
      {
        text: "Решение и продукт\nНаше решение — сервис и услуга для рынка. Solution и product.",
        expected: "solution",
      },
      {
        text: "Рынок и объём\nTAM SAM SOM анализ: market и сегмент потребителей.",
        expected: "market_size",
      },
      {
        text: "Финансы компании\nВыручка и прибыль: бюджет, доход, расход, финанс показатели, p&l.",
        expected: "finances",
      },
      {
        text: "Команда проекта\nКоманда: директор, генеральный, сотрудник и опыт команды, team.",
        expected: "team",
      },
      {
        text: "Маркетинг и реклама\nСтратегия маркетинга: продвижение, smm, marketing кампании.",
        expected: "marketing_strategy",
      },
      {
        text: "Риски и угрозы\nРиск-анализ: risk, угроза, pest и swot матрица.",
        expected: "risks",
      },
      {
        text: "KPI и метрики\nПоказатель OKR: kpi, метрика и цель проекта на год.",
        expected: "kpi_metrics",
      },
      {
        text: "Инвестиции и финансирование\nГрант и субсидия: инвестиц в проект, funding раунд.",
        expected: "funding_ask",
      },
    ];

    let correct = 0;
    for (const { text, expected } of fixtures) {
      const result = mapPageToSection(text);
      if (result === expected) correct++;
    }

    expect(correct).toBeGreaterThanOrEqual(7);
  });
});
