import type { Kopecks } from "@crm/schemas";
import { type Result, ok, err } from "../types.js";

export interface DeviationResult {
  deviationPct: number;
  direction: "above" | "below" | "on_target";
}

/** Порог «попадания в план»: ±1% считается выполнением. */
const ON_TARGET_THRESHOLD_PCT = 1;

/**
 * Вычисляет отклонение факта от плана в процентах.
 * Plan = 0 → ZERO_PLAN: это не невалидный период, а незаданный план;
 * дашборд должен показывать «план не задан», а не «период невалиден».
 * Math.round применяем только здесь (финальный результат) — никаких промежуточных округлений,
 * чтобы избежать накопления ошибок при цепочке вычислений.
 */
export function computeDeviation(
  fact: Kopecks,
  plan: Kopecks,
): Result<DeviationResult> {
  if (plan === 0) {
    return err({ code: "ZERO_PLAN", message: "Plan value is zero — cannot compute deviation" });
  }

  const raw = ((fact - plan) / plan) * 100;
  const deviationPct = Math.round(raw * 100) / 100;

  let direction: DeviationResult["direction"];
  if (Math.abs(deviationPct) < ON_TARGET_THRESHOLD_PCT) {
    direction = "on_target";
  } else if (deviationPct > 0) {
    direction = "above";
  } else {
    direction = "below";
  }

  return ok({ deviationPct, direction });
}

/**
 * Экспоненциальное скользящее среднее для сглаживания временных рядов метрик.
 * Alpha ближе к 1 — быстрая реакция на изменения; ближе к 0 — сильное сглаживание.
 * Первый элемент = значению — инициализация без «холодного старта» перекоса.
 *
 * Используем для обнаружения тренда отклонений во времени:
 * нарастающий негативный тренд важнее разовых выбросов.
 */
/**
 * Длина выходного массива всегда равна длине входного.
 * Нарушение этого инварианта ломает выравнивание временных рядов при отображении на дашборде.
 * При noUncheckedIndexedAccess TypeScript допускает undefined по индексу — бросаем явно,
 * чтобы рассинхрон длин не прошёл молча в продакшен.
 */
export function computeEma(values: number[], alpha: number): number[] {
  if (values.length === 0) return [];

  const first = values[0];
  if (first === undefined) throw new Error("computeEma: unexpected undefined at index 0");

  const result: number[] = [first];

  for (let i = 1; i < values.length; i++) {
    const prev = result[i - 1];
    const cur = values[i];
    if (prev === undefined || cur === undefined) {
      throw new Error(`computeEma: unexpected undefined at index ${i} — length invariant broken`);
    }
    result.push(alpha * cur + (1 - alpha) * prev);
  }

  return result;
}
