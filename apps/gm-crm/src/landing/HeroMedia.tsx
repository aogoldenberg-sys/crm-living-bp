import { useEffect, useRef, useState } from "react";

export interface HeroMediaConfig {
  type: "image" | "video";
  src: string;
  /** Постер — первый кадр видео или fallback для изображения. */
  poster?: string;
  alt?: string;
}

interface HeroMediaProps {
  media: HeroMediaConfig;
  className?: string;
}

/** Определяет нужно ли использовать статичный режим (экономия трафика / анимации). */
function useStaticMode(): boolean {
  const [isStatic, setIsStatic] = useState(() => {
    if (typeof window === "undefined") return false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const conn = (navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }).connection;
    const saveData = conn?.saveData ?? false;
    const slowNet = ["slow-2g", "2g"].includes(conn?.effectiveType ?? "");
    return reduced || saveData || slowNet;
  });

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = () => setIsStatic(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return isStatic;
}

/**
 * Медиа-слот героя. Принимает image или video без переделки архитектуры.
 * В статичном режиме (reduced-motion / saveData / slow-2g) видео не загружается,
 * отображается poster.
 */
export function HeroMedia({ media, className = "" }: HeroMediaProps) {
  const isStatic = useStaticMode();
  const videoRef = useRef<HTMLVideoElement>(null);

  // Ken-burns работает через CSS animation только для img
  const kbClass = media.type === "image" ? "hero-media-kenburns" : "";

  if (media.type === "video" && !isStatic) {
    return (
      <video
        ref={videoRef}
        className={`hero-media ${className}`}
        src={media.src}
        poster={media.poster}
        muted
        loop
        playsInline
        autoPlay
        aria-hidden="true"
      />
    );
  }

  /* Изображение: используем poster если есть, иначе src */
  const imgSrc = media.type === "video" ? (media.poster ?? media.src) : media.src;

  return (
    <img
      className={`hero-media ${kbClass} ${className}`}
      src={imgSrc}
      alt={media.alt ?? ""}
      loading="lazy"
      aria-hidden="true"
    />
  );
}
