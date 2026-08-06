import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from "react-router-dom";
import { onAuthStateChanged, sendEmailVerification, signInWithCustomToken } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import { useAuth } from "./auth/useAuth";
import type { UserRole } from "./auth/useAuth";
import { LoginPage } from "./auth/LoginPage";
import { LandingPage } from "./landing/LandingPage";
import { Dashboard } from "./dashboard/Dashboard";
import { PlanSectionPage } from "./plan/PlanSectionPage";
import { OnboardingFlow } from "./onboarding/OnboardingFlow";
import { usePlanExists } from "./onboarding/usePlanExists";
import { ServicesPage } from "./services/ServicesPage";
import { BusinessPage } from "./features/revision/BusinessPage";

// Обрабатывает #yandex_token= на ЛЮБОМ роуте — Worker редиректит на /kairos/
function YandexAuthHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.includes("yandex_token=")) return;

    const params = new URLSearchParams(hash.slice(1));
    const token = params.get("yandex_token");
    if (!token) return;

    // Проверка exp до обращения к Firebase
    try {
      const payload = JSON.parse(atob(token.split(".")[1] ?? ""));
      if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) {
        window.history.replaceState(null, "", window.location.pathname);
        navigate("/login", { state: { error: "Ссылка для входа через Яндекс устарела. Войдите ещё раз." } });
        return;
      }
    } catch { /* невалидный JWT — Firebase вернёт ошибку */ }

    window.history.replaceState(null, "", window.location.pathname);

    signInWithCustomToken(auth, token)
      .then(() => navigate("/dashboard", { replace: true }))
      .catch(() => navigate("/login", { state: { error: "Ошибка входа через Яндекс. Попробуйте ещё раз." }, replace: true }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

// Показывает баннер "подтвердите email" везде кроме / и /login
function EmailVerifyBanner() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  if (!user || user.emailVerified) return null;
  if (user.uid.startsWith("yandex:")) return null;
  if (pathname === "/" || pathname === "/login" || pathname === "/services") return null;

  const handleResend = async () => {
    if (countdown > 0) return;
    await sendEmailVerification(user).catch(() => {});
    setCountdown(60);
  };

  return (
    <div className="lp-email-banner">
      <span>Подтвердите email, чтобы разблокировать все функции.</span>
      <button type="button" onClick={handleResend} disabled={countdown > 0}>
        {countdown > 0 ? `Отправить ещё раз (${countdown}с)` : "Отправить письмо"}
      </button>
    </div>
  );
}

function DashboardOrOnboarding() {
  const { user, businessId } = useAuth();
  const { loading, exists } = usePlanExists(businessId);
  if (!user) return <Navigate to="/login" replace />;
  // Wait until businessId is resolved AND plan check completes before deciding
  if (!businessId || loading) return <div className="loading-screen">Загрузка...</div>;
  if (!exists) return <Navigate to="/onboarding" replace />;
  return <Dashboard />;
}

export default function App() {
  const { user, authReady, _setUser } = useAuth();

  // При возврате в окно — проверить emailVerified и перезагрузить страницу
  useEffect(() => {
    const handleFocus = async () => {
      const u = auth.currentUser;
      if (!u || u.emailVerified) return;
      await u.reload();
      if (u.emailVerified) window.location.reload();
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  useEffect(() => {
    const workerUrl = import.meta.env.VITE_INGEST_WORKER_URL as string;

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const result = await firebaseUser.getIdTokenResult();
        const role = (result.claims["role"] as UserRole | undefined) ?? null;

        // 1. Check custom claim first
        let businessId = result.claims["businessId"] as string | undefined;

        // 2. Firestore direct read
        if (!businessId) {
          try {
            const snap = await getDoc(doc(db, "users", firebaseUser.uid));
            if (snap.exists()) {
              businessId = (snap.data() as { businessId?: string }).businessId;
            }
          } catch { /* ignore */ }
        }

        // 3. Call /register (idempotent) — ensures users/{uid} exists in Firestore
        try {
          const idToken = await firebaseUser.getIdToken();
          const res = await fetch(`${workerUrl}/register`, {
            method: "POST",
            headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          if (res.ok) {
            const data = (await res.json()) as { businessId?: string };
            if (data.businessId) businessId = data.businessId;
          }
        } catch { /* ignore */ }

        // 4. Preserve existing good businessId on token refresh — don't regress to uid
        const currentStored = useAuth.getState().businessId;
        const resolved = businessId
          ?? (currentStored && currentStored !== firebaseUser.uid ? currentStored : undefined)
          ?? firebaseUser.uid;

        _setUser(firebaseUser, resolved, role);
      } else {
        _setUser(null, null, null);
      }
    });
    return () => unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_setUser]);

  // Block all route rendering until Firebase auth state is settled
  if (!authReady) {
    return <div className="loading-screen">Загрузка...</div>;
  }

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.slice(0, -1)}>
      <YandexAuthHandler />
      <EmailVerifyBanner />
      <Routes>
        {/* Лендинг — главная страница */}
        <Route path="/" element={user ? <Navigate to="/dashboard" replace /> : <LandingPage />} />

        {/* Вход/регистрация — один роут, unverified users остаются здесь */}
        <Route
          path="/login"
          element={user && (user.emailVerified || user.uid.startsWith("yandex:")) ? <Navigate to="/dashboard" replace /> : <LoginPage />}
        />

        {/* Старый /register — редирект на /login в режиме регистрации */}
        <Route path="/register" element={<Navigate to="/login" state={{ mode: "register" }} replace />} />

        {/* Онбординг — только для авторизованных */}
        <Route
          path="/onboarding"
          element={user ? <OnboardingFlow /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/onboarding/questionnaire"
          element={user ? <OnboardingFlow /> : <Navigate to="/login" replace />}
        />

        {/* Книга живого бизнеса */}
        <Route
          path="/business"
          element={user ? <BusinessPage /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/business/plan/:sectionId"
          element={user ? <PlanSectionPage mode="revision" /> : <Navigate to="/login" replace />}
        />

        {/* Дашборд — проверяет наличие плана, иначе редирект на онбординг */}
        <Route path="/dashboard" element={<DashboardOrOnboarding />} />

        {/* Раздел бизнес-плана */}
        <Route
          path="/dashboard/plan/:sectionId"
          element={user ? <PlanSectionPage /> : <Navigate to="/login" replace />}
        />

        {/* Сервисы без бизнес-плана: отчётность и комплаенс напрямую */}
        <Route
          path="/services"
          element={user ? <ServicesPage /> : <Navigate to="/login" replace />}
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
