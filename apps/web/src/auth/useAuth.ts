import { create } from "zustand";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase";

async function resolveBusinessId(uid: string): Promise<string> {
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (snap.exists()) {
      const bizId = (snap.data() as { businessId?: string }).businessId;
      if (bizId) return bizId;
    }
  } catch {
    // fall through
  }
  return uid; // fallback: uid (new accounts before worker runs)
}

export type UserRole = "owner" | "manager";

interface AuthState {
  businessId: string | null;
  user: User | null;
  /** Роль пользователя из кастомного claim токена. null = владелец (default). */
  role: UserRole | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  _setUser: (user: User | null, businessId: string | null, role?: UserRole | null) => void;
}

export const useAuth = create<AuthState>((set) => ({
  businessId: null,
  user: null,
  role: null,

  login: async (email: string, password: string) => {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const businessId = await resolveBusinessId(cred.user.uid);
    set({ user: cred.user, businessId, role: null });
  },

  register: async (email: string, password: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    // Отправить письмо подтверждения (Firebase default template — шаблон в Console → Auth → Templates)
    await sendEmailVerification(cred.user).catch(() => { /* не критично если не отправилось */ });
    // Call /register to provision Firestore docs
    const workerUrl = import.meta.env.VITE_INGEST_WORKER_URL as string;
    const idToken = await cred.user.getIdToken();
    const res = await fetch(`${workerUrl}/register`, {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      // Roll back: delete the created user
      await cred.user.delete();
      throw new Error("Ошибка создания аккаунта. Попробуйте позже.");
    }
    const regBusinessId = await resolveBusinessId(cred.user.uid);
    set({ user: cred.user, businessId: regBusinessId, role: null });
  },

  logout: async () => {
    await signOut(auth);
    set({ user: null, businessId: null, role: null });
  },

  _setUser: (user, businessId, role = null) => set({ user, businessId, role }),
}));
