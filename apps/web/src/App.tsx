import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./firebase";
import { useAuth } from "./auth/useAuth";
import type { UserRole } from "./auth/useAuth";
import { LandingPage } from "./landing/LandingPage";
import { LoginPage } from "./auth/LoginPage";
import { RegisterPage } from "./auth/RegisterPage";
import { Dashboard } from "./dashboard/Dashboard";

export default function App() {
  const { user, _setUser } = useAuth();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        firebaseUser.getIdTokenResult().then((result) => {
          const businessId =
            (result.claims["businessId"] as string | undefined) ??
            firebaseUser.uid ??
            null;
          const role = (result.claims["role"] as UserRole | undefined) ?? null;
          _setUser(firebaseUser, businessId, role);
        });
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

        {/* Дашборд — требует авторизации */}
        <Route
          path="/dashboard"
          element={user ? <Dashboard /> : <Navigate to="/login" replace />}
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
