import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./useAuth";
import "./LoginPage.css";

export function LoginPage() {
  const login = useAuth((s) => s.login);
  const navigate = useNavigate();

  const [businessId, setBusinessId] = useState("");
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(businessId.trim(), secret);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка входа");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      {/* Марка вверху */}
      <Link to="/" className="login-brand" aria-label="На главную">
        <svg width="22" height="22" viewBox="0 0 28 28" fill="none" aria-hidden="true">
          <polygon
            points="14,2 25,8 25,20 14,26 3,20 3,8"
            stroke="currentColor" strokeWidth="1.5" fill="none"
          />
          <line x1="3" y1="8" x2="25" y2="20" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span>Живой</span>
      </Link>

      {/* Карточка */}
      <div className="login-card">
        <h1 className="login-heading">Добро пожаловать</h1>
        <p className="login-hint">Введите ID бизнеса и секретный ключ для доступа</p>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="lf-group">
            <label htmlFor="lf-businessId" className="lf-label">ID бизнеса</label>
            <input
              id="lf-businessId"
              type="text"
              className="lf-input"
              value={businessId}
              onChange={(e) => setBusinessId(e.target.value)}
              placeholder="your-business-id"
              autoComplete="username"
              required
              spellCheck={false}
            />
          </div>

          <div className="lf-group">
            <label htmlFor="lf-secret" className="lf-label">Секретный ключ</label>
            <input
              id="lf-secret"
              type="password"
              className="lf-input"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="••••••••••••"
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <p className="lf-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="lf-submit" disabled={loading}>
            {loading ? "Вход…" : "Войти"}
          </button>
        </form>

        <p className="login-footer">
          Нет аккаунта?{" "}
          <Link to="/register" className="login-link">
            Создать аккаунт
          </Link>
        </p>
      </div>
    </div>
  );
}
