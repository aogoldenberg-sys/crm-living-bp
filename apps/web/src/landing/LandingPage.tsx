import { Link } from "react-router-dom";
import { HeroMedia } from "./HeroMedia";
import "./LandingPage.css";

/** SVG-глиф марки — гексагон с диагональю (placeholder, заменяется иконкой). */
function BrandGlyph() {
  return (
    <svg
      className="brand-glyph"
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
    >
      <polygon
        points="14,2 25,8 25,20 14,26 3,20 3,8"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="none"
      />
      <line x1="3" y1="8" x2="25" y2="20" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function LandingPage() {
  return (
    <div className="landing">
      {/* ── Хедер с маркой ─────────────────────────────────────────────── */}
      <header className="landing-header">
        <Link to="/" className="brand" aria-label="Kairos — на главную">
          <img src={import.meta.env.BASE_URL + "logo-badge.png"} className="brand-logo-img" alt="" aria-hidden="true" />
          <span className="brand-wordmark">Kairos</span>
        </Link>
      </header>

      {/* ── Герой ──────────────────────────────────────────────────────── */}
      <main className="hero">
        {/* Медиа-слот: сейчас image-заглушка; архитектура рассчитана на видео */}
        <div className="hero-media-wrap" aria-hidden="true">
          <HeroMedia
            media={{
              type: "image",
              src: "/crm_life/hero-placeholder.svg",
              alt: "",
            }}
          />
          <div className="hero-overlay" />
        </div>

        {/* Контент поверх медиа */}
        <div className="hero-content">
          <p className="hero-eyebrow">Финансовый разум вашего бизнеса</p>

          <h1 className="hero-title">
            Бизнес-план,<br />
            <em>который живёт.</em>
          </h1>

          <p className="hero-sub">
            Загрузите бизнес-план — система покажет где вы теряете деньги. Прямо сейчас.
          </p>

          <div className="hero-cta">
            <Link to="/login" className="cta-primary">
              Войти
            </Link>
            <Link to="/register" className="cta-ghost">
              Создать аккаунт
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
