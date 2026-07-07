import { useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./useAuth";
import "./RegisterPage.css";

export function RegisterPage() {
  const register = useAuth((s) => s.register);
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);

  // Prevent the old "logout if user exists" pattern — we no longer need it.
  // After register() the store sets user, but we handle navigation ourselves.
  const didRegisterRef = useRef(false);

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
      didRegisterRef.current = true;
      await register(email.trim(), password);
      setRegistered(true);
    } catch (err) {
      didRegisterRef.current = false;
      const code = (err as { code?: string }).code ?? "";
      const message = err instanceof Error ? err.message : "Ошибка регистрации";
      setError(mapFirebaseError(code, message));
    } finally {
      setLoading(false);
    }
  };

  if (registered) {
    return (
      <div className="register-page">
        <Link to="/" className="register-brand" aria-label="На главную">
          <img src={import.meta.env.BASE_URL + "logo-badge.png"} className="brand-logo-img" alt="" aria-hidden="true" style={{width:88,height:88,objectFit:'contain'}} />
          <span>Kairos</span>
        </Link>

        <div className="register-card verify-card">
          <div className="verify-icon" aria-hidden="true">✉️</div>
          <h1 className="register-heading">Подтвердите email</h1>
          <p className="register-hint">
            Письмо со ссылкой для подтверждения отправлено на<br />
            <strong className="verify-email">{email}</strong>
          </p>
          <p className="verify-note">
            Перейдите по ссылке из письма, затем войдите в аккаунт.
          </p>
          <button
            type="button"
            className="lf-submit"
            onClick={() => navigate("/login")}
          >
            Перейти ко входу
          </button>
          <p className="register-footer" style={{marginTop: 'var(--space-4)'}}>
            Письмо не пришло? Проверьте папку «Спам».
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="register-page">
      {/* Марка вверху */}
      <Link to="/" className="register-brand" aria-label="На главную">
        <img src={import.meta.env.BASE_URL + "logo-badge.png"} className="brand-logo-img" alt="" aria-hidden="true" style={{width:88,height:88,objectFit:'contain'}} />
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
            <div className="lf-pwd-wrap">
              <input
                id="rf-password"
                type={showPwd ? "text" : "password"}
                className="lf-input lf-input--pwd"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                autoComplete="new-password"
                minLength={6}
                required
              />
              <button type="button" className="lf-eye" onClick={() => setShowPwd((v) => !v)} aria-label={showPwd ? "Скрыть пароль" : "Показать пароль"}>
                {showPwd ? "🙈" : "👁️"}
              </button>
            </div>
          </div>

          <div className="lf-group">
            <label htmlFor="rf-confirm" className="lf-label">Подтвердите пароль</label>
            <div className="lf-pwd-wrap">
              <input
                id="rf-confirm"
                type={showPwd ? "text" : "password"}
                className="lf-input lf-input--pwd"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••••••"
                autoComplete="new-password"
                minLength={6}
                required
              />
            </div>
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
