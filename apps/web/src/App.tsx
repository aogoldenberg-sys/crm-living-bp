import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./firebase";
import { useAuth } from "./auth/useAuth";
import type { UserRole } from "./auth/useAuth";
import { LandingPage } from "./landing/LandingPage";
import { LoginPage } from "./auth/LoginPage";
import { RegisterPage } from "./auth/RegisterPage";
import { Dashboard } from "./dashboard/Dashboard";
import { PlanSectionPage } from "./plan/PlanSectionPage";
import { OnboardingFlow } from "./onboarding/OnboardingFlow";
import { usePlanExists } from "./onboarding/usePlanExists";
import { ServicesPage } from "./services/ServicesPage";
import { BusinessPage } from "./features/revision/BusinessPage";

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

        // 3. Call /register (idempotent) — creates mapping for first-time Google OAuth users
        if (!businessId) {
          try {
            const idToken = await firebaseUser.getIdToken();
            const res = await fetch(`${workerUrl}/register`, {
              method: "POST",
              headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
              body: JSON.stringify({}),
            });
            if (res.ok) {
              const data = (await res.json()) as { businessId?: string };
              businessId = data.businessId;
            }
          } catch { /* ignore */ }
        }

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
      <Routes>
        {/* Лендинг — всегда доступен */}
        <Route path="/" element={<LandingPage />} />

        {/* Вход — редирект на дашборд если уже залогинен */}
        <Route
          path="/login"
          element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />}
        />

        {/* Регистрация — при живой сессии RegisterPage сам выйдет из аккаунта */}
        <Route path="/register" element={<RegisterPage />} />

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
