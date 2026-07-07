import type { StrategyResult } from "./strategyFromFact.js";

// РЕШЕНИЕ: назван RevisionRoadmapItem чтобы не конфликтовать с RoadmapItem из roadmap/index.ts
export type RevisionRoadmapItem = {
  title: string;
  dueInDays: number;
  responsible: "system" | "human";
};

export type HumanTaskSpec = {
  reason: string;
  sectionRef: string;
  requiredDocKind: string | null;
};

export type RoadmapResult = {
  items: RevisionRoadmapItem[];
  humanTasks: HumanTaskSpec[];
};

export function roadmapFromStrategy(strategy: StrategyResult): RoadmapResult {
  if (strategy.verdict === "insufficient_data") {
    return {
      items: [],
      humanTasks: [
        { reason: "Загрузите банковскую выписку для анализа", sectionRef: "finances", requiredDocKind: "bank_statement" },
        { reason: "Загрузите кассовый отчёт", sectionRef: "finances", requiredDocKind: "cash_report" },
      ],
    };
  }

  const items: RevisionRoadmapItem[] = strategy.goals.map((goal, i) => ({
    title: goal,
    dueInDays: (i + 1) * 30,
    responsible: "system" as const,
  }));

  const humanTasks: HumanTaskSpec[] = [];

  if (strategy.verdict === "new_strategy") {
    humanTasks.push(
      { reason: "Провести встречу по пересмотру стратегии", sectionRef: "product_roadmap", requiredDocKind: null },
      { reason: "Подготовить актуальный прайс-лист", sectionRef: "pricing", requiredDocKind: "cash_report" },
    );
    items.push({ title: "Сформировать новую стратегию (требует участия собственника)", dueInDays: 14, responsible: "human" });
  }

  return { items, humanTasks };
}
