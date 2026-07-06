import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./useAuth";
import "./LoginPage.css";

export function LoginPage() {
  const login = useAuth((s) => s.login);
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mapFirebaseError = (code: string): string => {
    switch (code) {
      case "auth/wrong-password":
      case "auth/invalid-credential":
        return "Неверный email или пароль";
      case "auth/user-not-found":
        return "Пользователь не найден";
      case "auth/too-many-requests":
        return "Слишком много попыток. Попробуйте позже.";
      default:
        return "Ошибка входа";
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
      navigate("/dashboard");
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      setError(mapFirebaseError(code));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      {/* Марка вверху */}
      <Link to="/" className="login-brand" aria-label="На главную">
        <img src="/crm_life/logo.png" className="brand-logo-img" alt="" aria-hidden="true" style={{width:88,height:88,objectFit:'contain'}} />
        <span>Kairos</span>
      </Link>

      {/* Карточка */}
      <div className="login-card">
        <h1 className="login-heading">Добро пожаловать</h1>
        <p className="login-hint">Введите email и пароль для доступа</p>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="lf-group">
            <label htmlFor="lf-email" className="lf-label">Email</label>
            <input
              id="lf-email"
              type="email"
              className="lf-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
              spellCheck={false}
            />
          </div>

          <div className="lf-group">
            <label htmlFor="lf-password" className="lf-label">Пароль</label>
            <input
              id="lf-password"
              type="password"
              className="lf-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
