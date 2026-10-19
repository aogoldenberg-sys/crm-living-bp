import { useEffect, useRef } from "react";

const BASE_URL = import.meta.env.BASE_URL as string;

// Летающие шары (скопировано из Kairos Dashboard)
const BALL_INIT = [
  { size: 52, rx: 0.12, ry: 0.20 },
  { size: 38, rx: 0.18, ry: 0.72 },
  { size: 30, rx: 0.88, ry: 0.28 },
  { size: 44, rx: 0.80, ry: 0.78 },
  { size: 26, rx: 0.52, ry: 0.08 },
  { size: 36, rx: 0.92, ry: 0.55 },
];

const KEY = "gm_balls";

/** По умолчанию выключены; включены только явным gm_balls=on и без prefers-reduced-motion. */
export function ballsInitiallyOn(): boolean {
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  return localStorage.getItem(KEY) === "on" && !reduced;
}

export function saveBallsOn(on: boolean): void {
  localStorage.setItem(KEY, on ? "on" : "off");
}

/** Монтируется только когда шары включены: размонтирование полностью гасит rAF. */
export function Balls() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const balls = BALL_INIT.map((b) => ({
      x: b.rx * window.innerWidth, y: b.ry * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.8, vy: (Math.random() - 0.5) * 0.8,
      size: b.size,
    }));
    const mouse = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.5 };
    let raf = 0;

    const step = () => {
      const W = window.innerWidth, H = window.innerHeight;
      const children = ref.current?.children as HTMLCollectionOf<HTMLImageElement> | undefined;
      balls.forEach((b, i) => {
        if (i < 5) {
          b.x += b.vx; b.y += b.vy;
          if (b.x - b.size / 2 < 0) { b.x = b.size / 2; b.vx = Math.abs(b.vx); }
          if (b.x + b.size / 2 > W) { b.x = W - b.size / 2; b.vx = -Math.abs(b.vx); }
          if (b.y - b.size / 2 < 0) { b.y = b.size / 2; b.vy = Math.abs(b.vy); }
          if (b.y + b.size / 2 > H) { b.y = H - b.size / 2; b.vy = -Math.abs(b.vy); }
        } else {
          b.vx += (mouse.x - b.x) * 0.0016; b.vy += (mouse.y - b.y) * 0.0016;
          b.vx *= 0.94; b.vy *= 0.94;
          b.x += b.vx; b.y += b.vy;
        }
        const el = children?.[i];
        if (el) el.style.transform = `translate(${b.x - b.size / 2}px,${b.y - b.size / 2}px)`;
      });
      raf = requestAnimationFrame(step);
    };
    const start = () => { if (!raf && !document.hidden) raf = requestAnimationFrame(step); };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };
    const onVisibility = () => (document.hidden ? stop() : start());
    const onMouse = (e: MouseEvent) => { mouse.x = e.clientX; mouse.y = e.clientY; };

    window.addEventListener("mousemove", onMouse);
    document.addEventListener("visibilitychange", onVisibility);
    start();
    return () => {
      stop();
      window.removeEventListener("mousemove", onMouse);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <div ref={ref} className="go-balls-layer" aria-hidden="true">
      {BALL_INIT.map((b, i) => (
        <img key={i} src={BASE_URL + "ball-gold.png"} alt=""
          className="go-ball" style={{ width: b.size, height: b.size }} />
      ))}
    </div>
  );
}
