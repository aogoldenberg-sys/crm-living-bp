import type { Db } from "../db.js";
import type { Client } from "@crm/schemas";
import { Client as ClientSchema } from "@crm/schemas";
import { type Result, ok, err } from "@crm/core";

const col = (db: Db, biz: string) =>
  db.collection(`tenants/${biz}/clients`);

export async function saveClient(
  db: Db,
  businessId: string,
  client: Client,
): Promise<Result<void>> {
  try {
    await col(db, businessId)
      .doc(client.clientId)
      .set(client as unknown as Record<string, unknown>);
    return ok(undefined);
  } catch (e) {
    return err({ code: "STORAGE_ERROR", message: String(e) });
  }
}

export async function loadClient(
  db: Db,
  businessId: string,
  clientId: string,
): Promise<Result<Client | null>> {
  try {
    const snap = await col(db, businessId).doc(clientId).get();
    if (!snap.exists) return ok(null);
    const p = ClientSchema.safeParse(snap.data());
    if (!p.success) {
      console.warn(`[gustoriko] invalid client id=${clientId}`, p.error.issues);
      return ok(null);
    }
    return ok(p.data);
  } catch (e) {
    return err({ code: "STORAGE_ERROR", message: String(e) });
  }
}

export async function loadClients(
  db: Db,
  businessId: string,
): Promise<Result<Client[]>> {
  try {
    const snap = await col(db, businessId).orderBy("name").get();
    const clients: Client[] = [];
    for (const doc of snap.docs) {
      const p = ClientSchema.safeParse(doc.data());
      if (!p.success) {
        console.warn(`[gustoriko] invalid client id=${doc.id}`, p.error.issues);
        continue;
      }
      clients.push(p.data);
    }
    return ok(clients);
  } catch (e) {
    return err({ code: "STORAGE_ERROR", message: String(e) });
  }
}
