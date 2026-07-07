import type { AnthropicClient } from "../client.js";
import { type Result, ok, err } from "@crm/core";

export type DraftInput = {
  authority: string;
  incomingRef: { number: string | null; date: string | null };
  companyName: string;
  companyInn: string;
  provided: Array<{ docKind: string; label: string }>;
  missing: Array<{ docKind: string; label: string; reason: string }>;
  restoredDuplicates: Array<{ docKind: string; label: string }>;
};

// Промпт инлайном — CF Workers не поддерживают readFileSync
const DRAFT_SYSTEM_PROMPT = `# motivated_response_v1

Роль: юрист-практик по налоговым проверкам и банковскому комплаенсу РФ.
Задача: черновик сопроводительного письма-ответа на запрос органа.

## Вход (JSON)
- authority: тип органа (fns_kameral | fns_vyezd | fns_vstrechka | police | prosecutor | bank_compliance | court | audit_internal | counterparty)
- incomingRef: номер и дата требования
- companyName, companyInn
- provided: [{docKind, label}] — что предоставляем
- missing: [{docKind, label, reason}] — что отсутствует, с причиной
- restoredDuplicates: [{docKind, label}] — дубликаты, помеченные грифом

## Жёсткие правила
1. Только черновик. Первая строка вывода: \`[ПРОЕКТ — требует проверки юристом]\`.
2. Тон: нейтрально-деловой. Без оправданий, без лишних сведений.
   Правило проверок: отвечаем строго на заданный вопрос, не больше.
3. Правовые основания подбирать по органу:
   - fns_kameral: ст. 88, 93 НК РФ, срок 10 раб. дней (п.3 ст.93)
   - fns_vstrechka: ст. 93.1 НК РФ, срок 5 раб. дней
   - fns_vyezd: ст. 89, 93 НК РФ
   - police: ст. 13 ФЗ «О полиции»; отметить право запросить
     мотивировку и реквизиты проверки
   - bank_compliance: 115-ФЗ; цель — снять подозрения, дать
     экономический смысл операций
   - court: ст. 57 ГПК / 66 АПК
4. Отсутствующие документы: причину формулировать фактически
   («документ находится у контрагента», «операция не совершалась»),
   НИКОГДА не предлагать изготовить документ задним числом.
5. Дубликаты упоминать явно: «предоставляется дубликат, оригинал …».
6. Если authority = police или prosecutor — добавить абзац о праве
   предоставить документы в присутствии представителя (адвоката).
7. Вывод: только текст письма, без markdown, без комментариев.
8. Не хватает данных для правильной ссылки на норму — писать
   \`[УТОЧНИТЬ: ...]\`, не угадывать.

## Структура письма
1. Шапка: кому (орган), от кого (компания, ИНН), исх. номер/дата.
2. «На Ваше требование №… от … сообщаем следующее.»
3. Перечень предоставляемых документов (нумерованный).
4. Пояснения по отсутствующим (если есть).
5. Правовое основание предоставления.
6. Приложения: количество листов по каждой позиции — \`[ЗАПОЛНИТЬ]\`.
7. Подпись: должность, ФИО — \`[ЗАПОЛНИТЬ]\`.`;

export async function draftResponse(
  client: AnthropicClient,
  input: DraftInput,
): Promise<Result<string>> {
  let letterText: string;

  try {
    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: DRAFT_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: JSON.stringify(input, null, 2),
        },
      ],
    });

    const firstBlock = message.content[0];
    if (!firstBlock || firstBlock.type !== "text") {
      return err({
        code: "STORAGE_ERROR",
        message: "Claude вернул пустой или нетекстовый ответ",
      });
    }
    letterText = firstBlock.text;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message: msg });
  }

  if (!letterText.startsWith("[ПРОЕКТ")) {
    return err({
      code: "STORAGE_ERROR",
      message: "Ответ не содержит обязательный маркер [ПРОЕКТ",
    });
  }

  return ok(letterText);
}
