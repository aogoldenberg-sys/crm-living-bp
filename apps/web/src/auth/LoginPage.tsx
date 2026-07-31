import { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { sendEmailVerification } from "firebase/auth";
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
  const register = useAuth((s) => s.register);
  const navigate = useNavigate();
  const location = useLocation();

  const initMode = (location.state as { mode?: string } | null)?.mode === "register" ? "register" : "login";
  const [mode, setMode] = useState<"login" | "register">(initMode);
  const [showVerify, setShowVerify] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const stateError = (location.state as { error?: string } | null)?.error ?? null;
  const [error, setError] = useState<string | null>(stateError);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const switchMode = (m: "login" | "register") => {
    setMode(m);
    setError(null);
    setPassword("");
    setConfirmPwd("");
  };

  const handleYandexLogin = () => {
    const YANDEX_CLIENT_ID = "da7824d80cd5404ea931e62795edfebf";
    const redirect = encodeURIComponent("https://crm-auth.aogoldenberg.workers.dev/auth/yandex/callback");
    window.location.href = `https://oauth.yandex.ru/authorize?response_type=code&client_id=${YANDEX_CLIENT_ID}&redirect_uri=${redirect}`;
  };

  const handleGoogleLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      await loginWithGoogle();
      navigate("/dashboard");
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      setError(`Ошибка входа через Google (${code || "неизвестно"})`);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === "register") {
      if (password !== confirmPwd) { setError("Пароли не совпадают"); return; }
      if (password.length < 6) { setError("Пароль слишком короткий (минимум 6 символов)"); return; }
      setLoading(true);
      try {
        await register(email.trim(), password);
        setShowVerify(true);
        setCountdown(60);
      } catch (err) {
        const code = (err as { code?: string }).code ?? "";
        setError(
          code === "auth/email-already-in-use" ? "Email уже используется" :
          code === "auth/weak-password" ? "Пароль слишком короткий (минимум 6 символов)" :
          "Ошибка регистрации"
        );
      } finally {
        setLoading(false);
      }
      return;
    }

    setLoading(true);
    try {
      await login(email.trim(), password);
      navigate("/dashboard");
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      setError(
        code === "auth/wrong-password" || code === "auth/invalid-credential" ? "Неверный email или пароль" :
        code === "auth/user-not-found" ? "Пользователь не найден" :
        code === "auth/too-many-requests" ? "Слишком много попыток. Попробуйте позже." :
        "Ошибка входа"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    const user = auth.currentUser;
    if (!user || countdown > 0) return;
    await sendEmailVerification(user).catch(() => {});
    setCountdown(60);
  };

  const brand = (
    <Link to="/" className="login-brand" aria-label="На главную">
      <img src={import.meta.env.BASE_URL + "logo-badge.png"} className="brand-logo-img" alt="" aria-hidden="true" style={{ width: 88, height: 88, objectFit: "contain" }} />
      <span>Kairos</span>
    </Link>
  );

  if (showVerify) {
    return (
      <div className="login-page">
        {brand}
        <div className="login-card verify-card">
          <div className="verify-icon" aria-hidden="true">✉️</div>
          <h1 className="login-heading">Проверьте почту</h1>
          <p className="login-hint">Письмо отправлено на<br /><strong className="verify-email">{email}</strong></p>
          <p className="verify-spam">Письмо может попасть в папку «Спам».</p>
          <button type="button" className="lf-submit lf-submit--outline" onClick={handleResend} disabled={countdown > 0}>
            {countdown > 0 ? `Отправить ещё раз (${countdown}с)` : "Отправить ещё раз"}
          </button>
          <button type="button" className="lf-submit" style={{ marginTop: "var(--space-3)" }} onClick={() => navigate("/dashboard")}>
            Войти в приложение
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      {brand}
      <div className="login-card">
        <h1 className="login-heading">{mode === "login" ? "Добро пожаловать" : "Создать аккаунт"}</h1>
        <p className="login-hint">{mode === "login" ? "Введите email и пароль для доступа" : "Введите данные для регистрации"}</p>

        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <div className="lf-group">
            <label htmlFor="lf-email" className="lf-label">Email</label>
            <input id="lf-email" type="email" className="lf-input" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
              autoComplete="email" required spellCheck={false} />
          </div>
          <div className="lf-group">
            <label htmlFor="lf-password" className="lf-label">Пароль</label>
            <div className="lf-pwd-wrap">
              <input id="lf-password" type={showPwd ? "text" : "password"} className="lf-input lf-input--pwd"
                value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••••"
                autoComplete={mode === "login" ? "current-password" : "new-password"} required />
              <button type="button" className="lf-eye" onClick={() => setShowPwd((v) => !v)}
                aria-label={showPwd ? "Скрыть пароль" : "Показать пароль"}>{showPwd ? "🙈" : "👁️"}</button>
            </div>
          </div>
          {mode === "register" && (
            <div className="lf-group">
              <label htmlFor="lf-confirm" className="lf-label">Подтвердите пароль</label>
              <div className="lf-pwd-wrap">
                <input id="lf-confirm" type={showPwd ? "text" : "password"} className="lf-input lf-input--pwd"
                  value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)}
                  placeholder="••••••••••••" autoComplete="new-password" required />
              </div>
            </div>
          )}
          {error && <p className="lf-error" role="alert">{error}</p>}
          <button type="submit" className="lf-submit" disabled={loading}>
            {loading ? (mode === "login" ? "Вход…" : "Регистрация…") : (mode === "login" ? "Войти" : "Создать аккаунт")}
          </button>
        </form>

        <div className="lf-divider"><span>или войти через</span></div>
        <div className="lf-oauth">
          <button type="button" className="lf-oauth-btn lf-oauth-google" onClick={handleGoogleLogin} disabled={loading}>
            <GoogleIcon /> Google
          </button>
          <button type="button" className="lf-oauth-btn lf-oauth-yandex" onClick={handleYandexLogin} disabled={loading}>
            <YandexIcon /> Яндекс
          </button>
        </div>

        <p className="login-footer">
          {mode === "login" ? (
            <>Нет аккаунта?{" "}<button type="button" className="lf-link-btn" onClick={() => switchMode("register")}>Зарегистрироваться</button></>
          ) : (
            <>Уже есть аккаунт?{" "}<button type="button" className="lf-link-btn" onClick={() => switchMode("login")}>Войти</button></>
          )}
        </p>
      </div>
    </div>
  );
}
