import type { DealStageChanged } from "@crm/schemas";
import type { Deal } from "@crm/schemas";

/**
 * Сворачивает append-only лог событий DealStageChanged в текущее состояние сделок.
 *
 * Детерминировано: при одинаковом логе результат всегда одинаков.
 * Порядок событий: по полю ts. Если ts равны — eventId как тай-брейкер.
 *
 * @param events   Отфильтрованный список событий для одного businessId
 * @param asOf     Момент "сейчас" для расчёта daysInStage (по умолчанию new Date())
 * @param funnelId ID воронки, к которой относятся эти сделки (по умолчанию "default")
 * @returns Map<dealId, Deal> — текущая проекция каждой сделки
 */
export function reduceDeals(
  events: DealStageChanged[],
  asOf: Date = new Date(),
  funnelId: string = "default",
): Map<string, Deal> {
  // Сортировка по ts ASC, тай-брейкер по eventId — детерминизм при параллельных событиях
  const sorted = [...events].sort((a, b) => {
    const tsDiff = a.ts.localeCompare(b.ts);
    return tsDiff !== 0 ? tsDiff : a.eventId.localeCompare(b.eventId);
  });

  // Промежуточное состояние для каждой сделки
  const state = new Map<string, {
    dealId: string;
    funnelId: string;
    currentStage: string;
    amount: number;
    probability: number;
    ownerId: string;
    clientId: string | null;
    expectedCloseDate: string | null;
    expectedPaymentDate: string | null;
    stageEnteredAt: string; // ts события, на котором перешли на текущую стадию
    updatedAt: string;
  }>();

  for (const ev of sorted) {
    const prev = state.get(ev.dealId);
    // Переходим на новую стадию: обновляем stageEnteredAt
    const stageChanged = prev === undefined || prev.currentStage !== ev.toStage;

    state.set(ev.dealId, {
      dealId: ev.dealId,
      funnelId,
      currentStage: ev.toStage,
      amount: ev.estimatedAmount ?? (prev?.amount ?? 0),
      probability: prev?.probability ?? 0,
      ownerId: prev?.ownerId ?? ev.managerId,
      clientId: prev?.clientId ?? null,
      expectedCloseDate: prev?.expectedCloseDate ?? null,
      expectedPaymentDate: prev?.expectedPaymentDate ?? null,
      stageEnteredAt: stageChanged ? ev.ts : (prev?.stageEnteredAt ?? ev.ts),
      updatedAt: ev.ts,
    });
  }

  // Финальная проекция: вычисляем daysInStage относительно asOf
  const result = new Map<string, Deal>();
  const asOfMs = asOf.getTime();

  for (const [dealId, s] of state) {
    const enteredMs = new Date(s.stageEnteredAt).getTime();
    const daysInStage = Math.max(0, Math.floor((asOfMs - enteredMs) / (1000 * 60 * 60 * 24)));

    result.set(dealId, {
      dealId: s.dealId,
      funnelId: s.funnelId,
      currentStage: s.currentStage,
      amount: s.amount,
      probability: s.probability,
      ownerId: s.ownerId,
      clientId: s.clientId,
      expectedCloseDate: s.expectedCloseDate,
      expectedPaymentDate: s.expectedPaymentDate,
      daysInStage,
      updatedAt: s.updatedAt,
    });
  }

  return result;
}
