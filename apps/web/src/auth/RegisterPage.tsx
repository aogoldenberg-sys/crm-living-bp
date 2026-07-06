import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./useAuth";
import "./RegisterPage.css";

export function RegisterPage() {
  const register = useAuth((s) => s.register);
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mapFirebaseError = (code: string, fallback: string): string => {
    switch (code) {
      case "auth/email-already-in-use":
        return "Email уже используется";
      case "auth/weak-password":
        return "Пароль слишком короткий (минимум 6 символов)";
      default:
        return fallback;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError("Пароли не совпадают");
      return;
    }

    if (password.length < 6) {
      setError("Пароль слишком короткий (минимум 6 символов)");
      return;
    }

    setLoading(true);
    try {
      await register(email.trim(), password);
      navigate("/dashboard");
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      const message = err instanceof Error ? err.message : "Ошибка регистрации";
      setError(mapFirebaseError(code, message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="register-page">
      {/* Марка вверху */}
      <Link to="/" className="register-brand" aria-label="На главную">
        <img src="/crm_life/logo.png" className="brand-logo-img" alt="" aria-hidden="true" style={{width:88,height:88,objectFit:'contain'}} />
        <span>Kairos</span>
      </Link>

      {/* Карточка */}
      <div className="register-card">
        <h1 className="register-heading">Создать аккаунт</h1>
        <p className="register-hint">Введите данные для регистрации</p>

        <form className="register-form" onSubmit={handleSubmit} noValidate>
          <div className="lf-group">
            <label htmlFor="rf-email" className="lf-label">Email</label>
            <input
              id="rf-email"
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
            <label htmlFor="rf-password" className="lf-label">Пароль</label>
            <input
              id="rf-password"
              type="password"
              className="lf-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              autoComplete="new-password"
              minLength={6}
              required
            />
          </div>

          <div className="lf-group">
            <label htmlFor="rf-confirm" className="lf-label">Подтвердите пароль</label>
            <input
              id="rf-confirm"
              type="password"
              className="lf-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••••••"
              autoComplete="new-password"
              minLength={6}
              required
            />
          </div>

          {error && (
            <p className="lf-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="lf-submit" disabled={loading}>
            {loading ? "Регистрация…" : "Создать аккаунт"}
          </button>
        </form>

        <p className="register-footer">
          Уже есть аккаунт?{" "}
          <Link to="/login" className="login-link">
            Войти
          </Link>
        </p>
      </div>
    </div>
  );
}
