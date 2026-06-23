import { create } from "zustand";
import { signInWithCustomToken, signOut, type User } from "firebase/auth";
import { auth } from "../firebase";

export type UserRole = "owner" | "manager";

interface AuthState {
  businessId: string | null;
  user: User | null;
  /** Роль пользователя из кастомного claim токена. null = владелец (default). */
  role: UserRole | null;
  login: (businessId: string, secret: string) => Promise<void>;
  logout: () => Promise<void>;
  _setUser: (user: User | null, businessId: string | null, role?: UserRole | null) => void;
}

export const useAuth = create<AuthState>((set) => ({
  businessId: null,
  user: null,
  role: null,

  login: async (businessId: string, secret: string) => {
    const workerUrl = import.meta.env.VITE_AUTH_WORKER_URL;
    const res = await fetch(`${workerUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId, secret }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
    }

    const { token } = (await res.json()) as { token: string };
    const credential = await signInWithCustomToken(auth, token);

    // Читаем роль из claims — auth worker выставляет если настроена
    const idTokenResult = await credential.user.getIdTokenResult();
    const role = (idTokenResult.claims["role"] as UserRole | undefined) ?? null;

    set({ user: credential.user, businessId, role });
  },

  logout: async () => {
    await signOut(auth);
    set({ user: null, businessId: null, role: null });
  },

  _setUser: (user, businessId, role = null) => set({ user, businessId, role }),
}));
