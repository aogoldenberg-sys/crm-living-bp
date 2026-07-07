import { create } from "zustand";
import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type User,
} from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase";

/** Calls /register (idempotent) to get or create businessId. Falls back to Firestore direct read. */
async function ensureBusinessId(user: import("firebase/auth").User): Promise<string> {
  try {
    const idToken = await user.getIdToken();
    const workerUrl = import.meta.env.VITE_INGEST_WORKER_URL as string;
    const res = await fetch(`${workerUrl}/register`, {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      const data = (await res.json()) as { businessId?: string };
      if (data.businessId) return data.businessId;
    }
  } catch {
    // network error — fall through to Firestore direct read
  }
  // Fallback: read directly from Firestore
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      const bizId = (snap.data() as { businessId?: string }).businessId;
      if (bizId) return bizId;
    }
  } catch {
    // ignore
  }
  return user.uid; // last resort
}

export type UserRole = "owner" | "manager";

interface AuthState {
  /** true until first onAuthStateChanged fires — used to block routes from rendering prematurely */
  authReady: boolean;
  businessId: string | null;
  user: User | null;
  role: UserRole | null;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  _setUser: (user: User | null, businessId: string | null, role?: UserRole | null) => void;
}

export const useAuth = create<AuthState>((set) => ({
  authReady: false,
  businessId: null,
  user: null,
  role: null,

  login: async (email: string, password: string) => {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    const businessId = await ensureBusinessId(cred.user);
    set({ authReady: true, user: cred.user, businessId, role: null });
  },

  loginWithGoogle: async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      // onAuthStateChanged в App.tsx подхватит пользователя автоматически
    } catch (popupErr) {
      const code = (popupErr as { code?: string }).code ?? "";
      console.error("[loginWithGoogle] popup error:", code, popupErr);
      if (
        code === "auth/popup-blocked" ||
        code === "auth/popup-closed-by-user" ||
        code === "auth/cancelled-popup-request"
      ) {
        console.info("[loginWithGoogle] falling back to signInWithRedirect");
        await signInWithRedirect(auth, provider);
        return;
      }
      throw popupErr;
    }
  },

  register: async (email: string, password: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await sendEmailVerification(cred.user).catch(() => { /* не критично */ });
    const businessId = await ensureBusinessId(cred.user);
    set({ authReady: true, user: cred.user, businessId, role: null });
  },

  logout: async () => {
    await signOut(auth);
    set({ authReady: true, user: null, businessId: null, role: null });
  },

  // Called by onAuthStateChanged — always marks authReady=true after first call
  _setUser: (user, businessId, role = null) => set({ authReady: true, user, businessId, role }),
}));
