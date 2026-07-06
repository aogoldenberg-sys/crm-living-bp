import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signInWithCustomToken } from "firebase/auth";
import { auth } from "../firebase";
import { useAuth } from "./useAuth";
import "./LoginPage.css";

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z" fill="#EA4335"/>
    </svg>
  );
}

function YandexIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="9" fill="#FC3F1D"/>
      <path d="M10.18 14H8.67V7.27H7.9c-1.18 0-1.8.57-1.8 1.42 0 .97.44 1.42 1.35 2.05l.75.52L5.9 14H4.28l1.88-2.52C5.05 10.6 4.4 9.74 4.4 8.6c0-1.62 1.13-2.72 3.49-2.72h2.29V14h-.01Z" fill="#fff"/>
    </svg>
  );
}

export function LoginPage() {
  const login = useAuth((s) => s.login);
  const loginWithGoogle = useAuth((s) => s.loginWithGoogle);
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

  const handleGoogleLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      await loginWithGoogle();
      navigate("/dashboard");
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      const msg = (err as { message?: string }).message ?? String(err);
      console.error("[GoogleLogin] code:", code, "message:", msg, "raw:", err);
      setError(`Ошибка входа через Google (${code || "неизвестно"})`);
    } finally {
      setLoading(false);
    }
  };

  // Обработка возврата с Яндекс OAuth — Worker редиректит с #yandex_token=...
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.includes("yandex_token=")) return;
    const params = new URLSearchParams(hash.slice(1));
    const token = params.get("yandex_token");
    if (!token) return;
    // Очищаем fragment сразу — токен не должен висеть в URL
    window.history.replaceState(null, "", window.location.pathname);
    setLoading(true);
    signInWithCustomToken(auth, token)
      .then(() => navigate("/dashboard"))
      .catch(() => setError("Ошибка входа через Яндекс"))
      .finally(() => setLoading(false));
  }, [navigate]);

  const handleYandexLogin = () => {
    const YANDEX_CLIENT_ID = "da7824d80cd5404ea931e62795edfebf";
    const redirect = encodeURIComponent("https://crm-auth.aogoldenberg.workers.dev/auth/yandex/callback");
    window.location.href = `https://oauth.yandex.ru/authorize?response_type=code&client_id=${YANDEX_CLIENT_ID}&redirect_uri=${redirect}`;
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

        <div className="lf-divider">
          <span>или войти через</span>
        </div>

        <div className="lf-oauth">
          <button type="button" className="lf-oauth-btn lf-oauth-google" onClick={handleGoogleLogin} disabled={loading}>
            <GoogleIcon /> Google
          </button>
          <button type="button" className="lf-oauth-btn lf-oauth-yandex" onClick={handleYandexLogin} disabled={loading}>
            <YandexIcon /> Яндекс
          </button>
        </div>

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
