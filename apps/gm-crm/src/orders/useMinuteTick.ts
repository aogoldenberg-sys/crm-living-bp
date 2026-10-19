import { useSyncExternalStore } from "react";

// Один общий таймер на всё приложение вместо setInterval в каждой карточке.
// Таймер живёт, пока есть хоть один подписчик.
const listeners = new Set<() => void>();
let tick = 0;
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (!timer) {
    timer = setInterval(() => {
      tick += 1;
      listeners.forEach((l) => l());
    }, 60_000);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) { clearInterval(timer); timer = null; }
  };
}

/** Счётчик минут; компонент перерисуется раз в минуту (для «осталось Nд/ч»). */
export function useMinuteTick(): number {
  return useSyncExternalStore(subscribe, () => tick);
}
