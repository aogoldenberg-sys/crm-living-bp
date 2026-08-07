import { Link } from "react-router-dom";
import { HeroMedia } from "./HeroMedia";
import "./LandingPage.css";

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
              src: "/kairos/hero-placeholder.svg",
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
            <Link to="/login" state={{ mode: "register" }} className="cta-ghost">
              Создать аккаунт
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
