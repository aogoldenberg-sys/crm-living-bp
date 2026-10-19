import { collection, doc, setDoc, updateDoc, writeBatch, type CollectionReference } from "firebase/firestore";
import { auth, db } from "../firebase";
import { SEND_ID_TOKEN, authHeader } from "./idToken";

const PROXY_URL = "https://opentgp.ru/food/pay-proxy.php";
// Firestore batch — максимум 500 операций; берём с запасом под финальный update.
const BATCH = 400;

export interface Recipient { email: string; customerName: string }
export interface Mailing { subject: string; bodyHtml: string; templateId: string; recipients: Recipient[] }

/**
 * Рассылка с журналом: mailings/{id} пишется ДО вызова прокси (status "sending"),
 * id уходит на сервер как ключ идемпотентности. Нет записи — нет отправки.
 * После успеха — по документу на получателя (их читает карточка клиента) с детерминированными id.
 */
export async function sendMailing(businessId: string, m: Mailing): Promise<{ ok: boolean; message: string }> {
  const col = collection(db, `tenants/${businessId}/mailings`);
  const ref = doc(col);
  const emails = m.recipients.map(r => r.email);
  await setDoc(ref, {
    kind: "batch", status: "sending", subject: m.subject, templateId: m.templateId, emails,
    createdAt: new Date().toISOString(), createdBy: auth.currentUser?.email ?? null,
  });

  let error: string | null;
  try {
    error = await postToProxy(ref.id, m.subject, m.bodyHtml, emails);
  } catch (e) {
    error = (e as Error).message;
  }
  if (error) {
    await updateDoc(ref, { status: "failed", error, finishedAt: new Date().toISOString() });
    return { ok: false, message: error };
  }
  const sent = `Отправлено: ${emails.length} писем`;
  try {
    await logSent(col, ref.id, m);
  } catch (e) {
    // Письма уже ушли: ошибкой это показывать нельзя, иначе пользователь отправит повторно.
    console.error("mailing log:", e);
    return { ok: true, message: `${sent} (журнал в карточках клиентов не записан)` };
  }
  return { ok: true, message: sent };
}

async function postToProxy(mailingId: string, subject: string, bodyHtml: string, emails: string[]): Promise<string | null> {
  const res = await fetch(PROXY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // РЕШЕНИЕ: секрет оставлен на переходный период, пока прокси не проверяет ID token. Убрать после обновления сервера.
      "X-Proxy-Secret": "grp-proxy-2026",
      "X-Proxy-Path": "/crm-mailing",
      ...(SEND_ID_TOKEN ? { "X-Idempotency-Key": mailingId } : {}),
      ...(await authHeader()),
    },
    body: JSON.stringify({ subject, body_html: bodyHtml, emails, mailing_id: mailingId }),
  });
  const data = await res.json().catch(() => ({})) as { error?: string };
  return res.ok && !data.error ? null : (data.error ?? `Ошибка ${res.status}`);
}

async function logSent(col: CollectionReference, mailingId: string, m: Mailing) {
  const sentAt = new Date().toISOString();
  for (let i = 0; i < m.recipients.length; i += BATCH) {
    const batch = writeBatch(db);
    m.recipients.slice(i, i + BATCH).forEach((r, j) => {
      batch.set(doc(col, `${mailingId}_${i + j}`), {
        email: r.email, customerName: r.customerName, subject: m.subject,
        templateId: m.templateId, sentAt, mailingId,
      });
    });
    await batch.commit();
  }
  await updateDoc(doc(col, mailingId), { status: "sent", finishedAt: sentAt });
}
