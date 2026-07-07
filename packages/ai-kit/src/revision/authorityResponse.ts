import type { AnthropicClient } from "../client.js";
import type { AuthorityKind } from "@crm/schemas";
import { ok, err } from "@crm/core";
import type { Result } from "@crm/core";

export type AuthorityDraft = {
  draftText: string;
  watermark: "ПРОЕКТ";          // всегда
  requiresHumanApproval: true;  // A3 — система готовит, человек утверждает
};

// РЕШЕНИЕ: промпты по органу в Record — добавление нового органа = одна строка без if-цепочки
const AUTHORITY_PROMPTS: Record<AuthorityKind, string> = {
  fns: "Составь черновик ответа на запрос ФНС. Формальный стиль. Ссылки на НК РФ.",
  bank: "Составь черновик ответа на запрос банка (115-ФЗ комплаенс). Деловой стиль.",
  mvd: "Составь черновик ответа на запрос МВД. Официальный стиль. Ссылки на УПК РФ.",
  other: "Составь черновик официального ответа на запрос контролирующего органа.",
};

export async function draftAuthorityResponse(
  client: AnthropicClient,
  requestText: string,
  authority: AuthorityKind,
  businessName: string,
): Promise<Result<AuthorityDraft>> {
  const systemPrompt = `${AUTHORITY_PROMPTS[authority]}

КРИТИЧЕСКИ ВАЖНО:
1. Документ — ЧЕРНОВИК. Начни с "ПРОЕКТ (не подписан)".
2. Вся ответственность на подписанте — ты только помогаешь.
3. Не придумывай факты которых нет в запросе.
4. В конце: "Документ подготовлен системой Kairos как черновик. Требует проверки и подписи уполномоченного лица."`;

  let text: string;
  try {
    const msg = await client.messages.create({
      model: "claude-3-5-haiku-latest",
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{
        role: "user",
        content: `Организация: ${businessName}\n\nТекст запроса:\n${requestText}`,
      }],
    });
    const first = msg.content[0];
    if (!first || first.type !== "text") {
      return err({ code: "STORAGE_ERROR", message: "Empty response" });
    }
    text = first.text;
  } catch (e) {
    return err({ code: "STORAGE_ERROR", message: e instanceof Error ? e.message : String(e) });
  }

  // Watermark ПРОЕКТ обязателен — добавляем если Claude не поставил
  const draftText = text.includes("ПРОЕКТ") ? text : `ПРОЕКТ (не подписан)\n\n${text}`;

  return ok({
    draftText,
    watermark: "ПРОЕКТ",
    requiresHumanApproval: true,
  });
}
