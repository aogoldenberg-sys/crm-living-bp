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

function DashboardOrOnboarding() {
  const { user, businessId } = useAuth();
  const { loading, exists } = usePlanExists(businessId);
  if (!user) return <Navigate to="/login" replace />;
  if (loading) return <div className="loading-screen">Загрузка...</div>;
  if (!exists) return <Navigate to="/onboarding" replace />;
  return <Dashboard />;
}

export default function App() {
  const { user, _setUser } = useAuth();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const result = await firebaseUser.getIdTokenResult();
        const role = (result.claims["role"] as UserRole | undefined) ?? null;
        // Prefer custom claim; if absent, resolve from Firestore users/{uid}
        let businessId = result.claims["businessId"] as string | undefined;
        if (!businessId) {
          try {
            const snap = await getDoc(doc(db, "users", firebaseUser.uid));
            if (snap.exists()) {
              businessId = (snap.data() as { businessId?: string }).businessId;
            }
          } catch {
            // ignore — fall through to uid fallback
          }
        }
        _setUser(firebaseUser, businessId ?? firebaseUser.uid, role);
      } else {
        _setUser(null, null, null);
      }
    });
    return () => unsubscribe();
  }, [_setUser]);

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

        {/* Регистрация */}
        <Route path="/register" element={user ? <Navigate to="/dashboard" replace /> : <RegisterPage />} />

        {/* Онбординг — только для авторизованных */}
        <Route
          path="/onboarding"
          element={user ? <OnboardingFlow /> : <Navigate to="/login" replace />}
        />
        <Route
          path="/onboarding/questionnaire"
          element={user ? <OnboardingFlow /> : <Navigate to="/login" replace />}
        />

        {/* Дашборд — проверяет наличие плана, иначе редирект на онбординг */}
        <Route path="/dashboard" element={<DashboardOrOnboarding />} />

        {/* Раздел бизнес-плана */}
        <Route
          path="/dashboard/plan/:sectionId"
          element={user ? <PlanSectionPage /> : <Navigate to="/login" replace />}
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
