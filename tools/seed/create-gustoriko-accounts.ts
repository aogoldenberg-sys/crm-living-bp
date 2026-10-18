/**
 * Создаёт Firebase Auth аккаунты и записывает роли в Firestore.
 * Запуск: npx tsx tools/seed/create-gustoriko-accounts.ts
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const admin = require("/Users/annagranenova/crm/packages/firestore-adapter/node_modules/firebase-admin") as typeof import("firebase-admin");
type ServiceAccount = import("firebase-admin").ServiceAccount;
import { readFileSync } from "fs";

const SA_PATH = "/Users/annagranenova/Downloads/It/crm-living-bp-firebase-adminsdk-fbsvc-c53d9c7dbd.json";
const BUSINESS_ID = "gustoriko";

// Аккаунты сотрудников ОпенТрейдГрупп
const USERS = [
  {
    email:       "sales@opentgp.ru",
    password:    "OTG-Sales#847",
    displayName: "Менеджер продаж",
    roleId:      "sales",
  },
  {
    email:       "assembly@opentgp.ru",
    password:    "OTG-Order#293",
    displayName: "Формирование заказа",
    roleId:      "assembly",
  },
  {
    email:       "purchases@opentgp.ru",
    password:    "OTG-Buy#561",
    displayName: "Менеджер по закупкам",
    roleId:      "purchasing",
  },
  {
    email:       "finance@opentgp.ru",
    password:    "OTG-Fin#174",
    displayName: "Финансист",
    roleId:      "finance",
  },
  // Руководитель — anna@opentgp.ru — уже существует, только обновляем роль
  {
    email:       "anna@opentgp.ru",
    password:    null, // не меняем пароль
    displayName: "Руководитель",
    roleId:      "director",
  },
] as const;

async function main() {
  const sa = JSON.parse(readFileSync(SA_PATH, "utf-8")) as ServiceAccount;
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  const authAdmin = admin.auth();
  const db = admin.firestore();

  console.log("Создаём аккаунты и записываем роли…\n");

  const results: { email: string; uid: string; status: string }[] = [];

  for (const u of USERS) {
    let uid: string;
    let status: string;

    try {
      // Пробуем найти существующего пользователя
      const existing = await authAdmin.getUserByEmail(u.email).catch(() => null);

      if (existing) {
        uid = existing.uid;
        status = "уже существует";
        // Обновляем displayName если нужно
        await authAdmin.updateUser(uid, { displayName: u.displayName });
      } else if (u.password) {
        const created = await authAdmin.createUser({
          email:         u.email,
          password:      u.password,
          displayName:   u.displayName,
          emailVerified: true, // сразу подтверждён — внутренний аккаунт
        });
        uid = created.uid;
        status = "создан";
      } else {
        status = "пропущен (нет пароля)";
        uid = "";
      }

      if (uid) {
        // Пишем роль в Firestore по email (подхватится при любом логине)
        await db
          .doc(`tenants/${BUSINESS_ID}/emailRoles/${u.email}`)
          .set({
            roleId:      u.roleId,
            displayName: u.displayName,
            updatedAt:   new Date().toISOString(),
          });
        results.push({ email: u.email, uid, status });
      }
    } catch (e) {
      console.error(`  ✗ ${u.email}:`, e instanceof Error ? e.message : e);
      results.push({ email: u.email, uid: "—", status: "ошибка" });
    }
  }

  // Вывод таблицы
  console.log("\n═══════════════════════════════════════════════════════════════════");
  console.log("  АККАУНТЫ СОТРУДНИКОВ ГУСТОРИКО / ОПЕНТРЕЙДГРУПП");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(`  ${"Email".padEnd(26)} ${"Пароль".padEnd(18)} ${"Роль".padEnd(24)} Статус`);
  console.log("  " + "─".repeat(80));
  for (const u of USERS) {
    const r = results.find(x => x.email === u.email);
    const pw = u.password ?? "(без изменений)";
    const roleLabel = ({
      sales:      "Менеджер продаж",
      assembly:   "Формирование заказа",
      purchasing: "Менеджер по закупкам",
      finance:    "Финансист",
      director:   "Руководитель",
    })[u.roleId] ?? u.roleId;
    console.log(`  ${u.email.padEnd(26)} ${pw.padEnd(18)} ${roleLabel.padEnd(24)} ${r?.status ?? "—"}`);
  }
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("\n  Ссылка для входа: http://localhost:5173/login");
  console.log("  (или https://opentgp.ru/kairos/app/login после деплоя)\n");
}

main().catch((e: unknown) => {
  console.error("FATAL:", e);
  process.exit(1);
});
