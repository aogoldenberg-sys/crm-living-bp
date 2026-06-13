import { createRequire } from "node:module";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * Инициализирует Firebase Admin SDK ровно один раз за весь процесс.
 * getApps() guard предотвращает "App already exists" при hot-reload в dev.
 *
 * Почему env-переменная, а не хардкод: сервисный аккаунт — секрет.
 * CI/CD и prod получают путь через переменную окружения, не через код.
 *
 * Не вызывается в тестах — тесты инжектируют FakeFirestore напрямую.
 */
export function createFirestoreClient(): Firestore {
  const serviceAccountPath = process.env["FIREBASE_SERVICE_ACCOUNT_PATH"];
  if (!serviceAccountPath) {
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT_PATH env variable is required to initialize Firebase Admin SDK",
    );
  }

  if (getApps().length === 0) {
    // createRequire нужен в ESM-контексте: динамический require JSON-файла.
    const require = createRequire(import.meta.url);
    const serviceAccount = require(serviceAccountPath) as object;
    initializeApp({ credential: cert(serviceAccount) });
  }

  return getFirestore();
}
