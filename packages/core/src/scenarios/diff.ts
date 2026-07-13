import type { AssumptionSet, PlanDiff } from "@crm/schemas";

/**
 * Строит список изменений плана по применяемым рычагам.
 * Если assumptions пустые — возвращаем заглушку per lever.
 */
export function buildPlanDiff(assumptions: AssumptionSet, leverNames: string[]): PlanDiff[] {
  if (Object.keys(assumptions).length === 0) {
    return leverNames.map(name => ({
      field: "lever",
      before: "текущий",
      after: "новый",
      humanReadable: name,
    }));
  }

  return leverNames.map(name => {
    const key = matchAssumptionKey(assumptions, name);
    if (!key) {
      return {
        field: "lever",
        before: "текущий",
        after: "новый",
        humanReadable: `Рычаг ${name}: применяется к плану`,
      };
    }

    const assumption = assumptions[key]!;
    const beforeVal = formatValue(assumption);
    const afterVal  = projectValue(assumption, name);

    return {
      field: key,
      before: beforeVal,
      after: afterVal,
      humanReadable: `Рычаг ${name}: изменение параметра ${key} с ${beforeVal} до ${afterVal}`,
    };
  });
}

function matchAssumptionKey(assumptions: AssumptionSet, leverName: string): string | null {
  const lower = leverName.toLowerCase();
  const candidates: Array<[string, number]> = [];

  for (const key of Object.keys(assumptions)) {
    const k = key.toLowerCase();
    let score = 0;
    if (k.includes("deal") && lower.includes("масштаб")) score++;
    if (k.includes("outflow") && lower.includes("автоматиза")) score++;
    if (k.includes("outflow") && lower.includes("затрат")) score++;
    if (k.includes("deal") && (lower.includes("пилот") || lower.includes("расширен"))) score++;
    if (score > 0) candidates.push([key, score]);
  }

  candidates.sort((a, b) => b[1] - a[1]);
  return candidates[0]?.[0] ?? Object.keys(assumptions)[0] ?? null;
}

function formatValue(assumption: AssumptionSet[string]): string {
  const v = assumption.value;
  if ("point" in v && v.point !== undefined) return `${v.point} ${assumption.unit}`;
  if ("lo" in v && "hi" in v) return `${v.lo}–${v.hi} ${assumption.unit}`;
  return assumption.unit;
}

function projectValue(assumption: AssumptionSet[string], leverName: string): string {
  const lower = leverName.toLowerCase();
  const v = assumption.value;
  const base = "point" in v && v.point !== undefined ? v.point : "lo" in v ? v.lo : 0;

  // Коэффициент изменения зависит от типа рычага (упрощённо)
  const factor = lower.includes("автоматиза") || lower.includes("затрат") ? 0.85 : 1.2;
  const projected = Math.round(base * factor);
  return `${projected} ${assumption.unit}`;
}
