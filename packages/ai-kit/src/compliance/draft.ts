import type { AnthropicClient } from "../client.js";
import type { RequestingAuthority } from "@crm/schemas";
import { type Result, ok, err, LEGAL_BASIS } from "@crm/core";

export type DraftInput = {
  authority: RequestingAuthority;
  incomingRef: { number: string | null; date: string | null };
  companyName: string;
  companyInn: string;
  rawRequestTexts: string[];
  provided: Array<{ docKind: string; label: string; attachmentNo: number }>;
  missing: Array<{ docKind: string; label: string; reason: string }>;
  restoredDuplicates: Array<{ docKind: string; label: string; attachmentNo: number }>;
};

const DRAFT_SYSTEM_PROMPT = `# motivated_response_v2

Роль: юрист-практик по проверкам контролирующих органов и банковскому комплаенсу РФ.
Задача: черновик мотивированного ответа на запрос (требование) органа.

## Жёсткие правила

1. ЗАПРЕТ: Правовое основание бери ТОЛЬКО из переданных данных.
   НЕ подбирай норму по аналогии, НЕ используй нормы другой отрасли права.
   Основание не передано — пиши [УТОЧНИТЬ: правовое основание].
   Ошибка в норме опаснее её отсутствия.

2. Только черновик. Первая строка: \`[ПРОЕКТ — требует проверки юристом]\`.

3. Тон: нейтрально-деловой. Без оправданий, без лишних сведений.
   Отвечаем строго на заданный вопрос, не больше.

4. Даты, суммы, номера, ФИО — только из переданных данных.
   Не сообщено — [ЗАПОЛНИТЬ].
   Правдоподобная выдумка реквизитов запрещена.

5. Отсутствующие документы: причину формулировать фактически,
   исходя из типа документа и контекста (см. п.9).
   НИКОГДА не предлагать изготовить документ задним числом.

6. Дубликаты упоминать явно: «предоставляется дубликат, оригинал …».

7. Если authority = police или prosecutor — добавить абзац о праве
   предоставить документы в присутствии представителя (адвоката).

8. В поле originalRequestItems передаётся дословный текст каждого пункта требования.
   Используй его для точного понимания контекста: кто запрашивает, что именно,
   по какому основанию, кто фигурирует (сотрудник, контрагент, должностное лицо).
   Определяй роли лиц из контекста — не все ФИО являются контрагентами.

9. Для отсутствующих документов причину формулируй исходя из контекста:
   - кадровые документы сотрудника → «в процессе восстановления из кадрового архива»
   - документы контрагента → «направлен запрос контрагенту»
   - документы, которые организация обязана иметь → «ведётся поиск в архиве»
   - если характер документа неясен → «документ не обнаружен, причина уточняется»
   Не повторяй одну и ту же формулировку для всех пунктов — каждый пункт уникален.

10. Вывод: только текст письма, без markdown, без комментариев.

## Структура письма

[ПРОЕКТ — требует проверки юристом]
Шапка: орган, адрес [ЗАПОЛНИТЬ], от кого (реквизиты из данных)
1. Ссылка на требование: номер, дата, основание
2. ПО КАЖДОМУ пункту отдельной строкой:
   - представляется (приложение № N)
   - составлен и представляется (приложение № N)
   - не может быть представлен — фактическая причина
3. Пояснения по существу
4. Приложение: реестр на [ЗАПОЛНИТЬ] листах
Подпись: должность, ФИО — [ЗАПОЛНИТЬ]
Дата`;

/** Собирает user message с правовыми основаниями из справочника. */
function buildUserMessage(input: DraftInput): string {
  const basis = LEGAL_BASIS[input.authority];
  const normsText = basis.norms.length > 0
    ? basis.norms.join(", ")
    : "[УТОЧНИТЬ: правовое основание]";
  const liabilityText = basis.liability
    ? `Ответственность за непредоставление: ${basis.liability}`
    : "";
  const deadlineText = basis.deadlineDays
    ? `Срок ответа: ${basis.deadlineDays} рабочих дней`
    : "";

  return JSON.stringify({
    ...input,
    legalBasis: normsText,
    liability: liabilityText || undefined,
    deadline: deadlineText || undefined,
    originalRequestItems: input.rawRequestTexts,
  }, null, 2);
}

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
        { role: "user", content: buildUserMessage(input) },
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
