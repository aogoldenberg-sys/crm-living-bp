/**
 * Конвейер сборки пакета документов v2.
 *
 * Один вызов Claude: получает пункты требования + authority →
 * возвращает мотивированный ответ + все документы пакета.
 * Claude сам решает что можно сформировать, а что нет.
 */

import type { AnthropicClient } from "../client.js";
import type { RequestItem, ChecklistEntry, RequestingAuthority } from "@crm/schemas";
import { type Result, ok, err, LEGAL_BASIS } from "@crm/core";

export type PipelineMeta = {
  authority: RequestingAuthority;
  incomingRef: { number: string | null; date: string | null };
  companyName: string | null;
  companyInn: string | null;
  /** Полный requestMeta из extract — все реквизиты для письма */
  requestMeta?: Record<string, unknown>;
};

export type GeneratedDoc = {
  fileName: string;
  title: string;
  content: string;
};

export type PipelineResult = {
  draftLetter: string;
  documents: GeneratedDoc[];
};

const PACKAGE_SYSTEM = `Ты — юрист, защищающий интересы организации, получившей требование госоргана.
Твоя задача: составить готовый ответ для подписи и сформировать пакет приложений.
Ты на стороне клиента. Ищешь законные доводы, объясняешь отсутствие документов убедительно,
не признаёшь вину и не оцениваешь действия клиента.

## Что ты получаешь на вход (JSON)

- authority — тип органа
- legalBasis — нормы, срок, санкции (ТОЛЬКО эти нормы используй в письме)
- requestMeta — реквизиты: орган, адресат, дата, номер, повод, заявитель
- requestItems — пункты требования (rawText + docKinds + нумерация)
- checklist — статус каждого документа (have_file/have_paper/restorable/missing_no_event/not_applicable)
- answers — ответы пользователя на уточняющие вопросы

## Что возвращаешь

ТОЛЬКО валидный JSON, без markdown, без комментариев:
{
  "letter": "текст письма",
  "documents": [
    { "fileName": "snake_case.txt", "title": "Название", "content": "полный текст" }
  ]
}

## СТРУКТУРА ПИСЬМА (соблюдать точно)

Шапка — правый блок:
  Кому: должность подписанта, наименование органа, адрес органа
  От: наименование организации, ИНН, адрес, телефон
Исх. № _____ от «___» _________ [год из requestMeta.requestDate или текущий] г.

ОТВЕТ на требование от [requestMeta.requestDate]
(в порядке [legalBasis.norms через запятую])

На требование [requestMeta.authorityName] от [requestMeta.requestDate][,
поступившее в связи с [requestMeta.subjectText], зарегистрированного за [requestMeta.complainantRef]]
[requestMeta.recipientName] сообщает следующее.

Истребуемые документы представляются в объёме, указанном ниже.

[ПО КАЖДОМУ ПУНКТУ В ИСХОДНОЙ НУМЕРАЦИИ, включая пропуски в нумерации органа]:
[N]. [краткое название документа] — [одно из]:
  • приложение № [порядковый номер в пакете]
  • не представляется: [убедительная причина из answers или из контекста]

[ЕСЛИ есть пояснения по существу — только из answers]:
Пояснения по существу проверки.
[текст строго из ответов пользователя]

Приложение: документы на _____ листах согласно реестру (приложение № [последний номер + 1]).

[requestMeta.recipientDirector ?? "Генеральный директор"]
[requestMeta.recipientName]          _____________ / [ФИО из requestMeta или "___________"] /
                                                     М.П.

## ПРАВИЛА ПИСЬМА

1. Все поля из requestMeta — подставить напрямую, без [ЗАПОЛНИТЬ].
2. Единственный допустимый плейсхолдер: «Исх. № _____» и «от «___» _________ [год] г.» — эти поля проставляют от руки.
3. Каждый пункт требования упомянут в исходной нумерации органа — если орган пропустил пп. 4–6, в ответе их тоже нет.
4. Непредставление объяснять фактом из answers, а не молчанием. «Документ отсутствует» — это тоже ответ, но объясни почему.
5. Правовое основание — ТОЛЬКО из legalBasis.norms. Никаких норм из других отраслей права.
6. Если authority = prosecutor/police → добавить абзац о праве на юридическую помощь.
7. Тон: деловой, без канцелярских штампов «настоящим уведомляем». Точность, не объём.
8. Не признавать вину. Не давать оценок. Излагать факты и законные доводы.

## ПРАВИЛА ДОКУМЕНТОВ

Формируй документ если:
- explanatory / written_clarification / debt_calculation / art236_calculation → ВСЕГДА формируй, используй данные из answers
- order_hire / personal_card / contract / staffing_table / payroll_regulation / timesheet → формируй как ПРОЕКТ-дубликат только если есть основания из answers
- payment_order / bank_statement → НЕ формируй (у клиента), объясни в письме

Каждый документ:
- fileName: транслит, snake_case, .txt (например: spravka_zadolzhennost.txt)
- title: понятное название
- content: полный текст, деловой стиль, данные из requestMeta и answers
- Если данных для поля нет — ставь [ЗАПОЛНИТЬ] (ровно так, без пояснений в скобках)
- Если нет правового основания — ставь [УТОЧНИТЬ: правовое основание] (ровно эта форма)
- НЕ пиши инструкции внутри скобок: «уточнить у [ответственного лица]» — ЗАПРЕЩЕНО
- НЕ придумывай текст внутри скобок. Любой другой вид [...] в документах запрещён
- Каждый документ — ПРОЕКТ, первая строка content: «[ПРОЕКТ — требует проверки и подписи]»

## АДВОКАТСКАЯ ПОЗИЦИЯ при отсутствии документов

Когда документ отсутствует (missing_no_event), формулируй причину так, чтобы:
- объяснять объективными обстоятельствами (кассовый разрыв, споры с контрагентами, технические сбои, ненадлежащее ведение кадрового учёта в предшествующий период)
- не признавать умысел
- ссылаться на принимаемые меры
- там где уместно — указывать что общество готово предоставить документы дополнительно

## КРИТИЧЕСКИЕ ЗАПРЕТЫ

- Не фабриковать суммы, даты, номера которых нет в answers или requestMeta
- Не использовать нормы права, не переданные в legalBasis
- Не пропускать ни один пункт требования
- Допустимые плейсхолдеры: только [ЗАПОЛНИТЬ] и [УТОЧНИТЬ: правовое основание]
- В письме: исх. номер и дата письма — пиши «_____» (пробелы для ручного заполнения), не [ЗАПОЛНИТЬ]
- Любой другой вид [...] кроме [ПРОЕКТ...] в начале документа — запрещён`;


// Разрешённые плейсхолдеры — закрытый список.
// [ПРОЕКТ...] — маркер заголовка документа, разрешён.
const ALLOWED_PLACEHOLDER = /^\[ЗАПОЛНИТЬ\]$|^\[УТОЧНИТЬ: правовое основание\]$|^\[ПРОЕКТ[^\]]*\]$/;

/** Находит любой [...] вне закрытого списка. Возвращает сообщение об ошибке или null. */
function validatePackage(letter: string, documents: GeneratedDoc[]): string | null {
  const bracketRe = /\[[^\]]{1,120}\]/g;
  const texts: Array<{ label: string; text: string }> = [
    { label: "письмо", text: letter },
    ...documents.map(d => ({ label: d.fileName, text: d.content })),
  ];
  for (const { label, text } of texts) {
    for (const m of text.matchAll(bracketRe)) {
      if (!ALLOWED_PLACEHOLDER.test(m[0])) {
        return `Недопустимый плейсхолдер в «${label}»: ${m[0]}`;
      }
    }
  }
  return null;
}

export async function runPipeline(
  client: AnthropicClient,
  items: ReadonlyArray<RequestItem>,
  entries: ReadonlyArray<ChecklistEntry>,
  answers: unknown[],
  meta: PipelineMeta,
): Promise<Result<PipelineResult>> {
  const basis = LEGAL_BASIS[meta.authority];

  const input = {
    authority: meta.authority,
    legalBasis: {
      norms: basis.norms,
      deadlineDays: basis.deadlineDays,
      liability: basis.liability,
      sanctions: basis.sanctions,
    },
    requestMeta: meta.requestMeta ?? {
      recipientName: meta.companyName,
      recipientInn: meta.companyInn,
      requestNumber: meta.incomingRef.number,
      requestDate: meta.incomingRef.date,
    },
    requestItems: items.map((it, idx) => ({
      itemId: it.itemId,
      originalNumber: idx + 1,
      rawText: it.rawText,
      docKinds: it.docKinds,
      periodFrom: it.periodFrom,
      periodTo: it.periodTo,
      counterpartyName: it.counterpartyName,
    })),
    checklist: entries.map(e => ({
      entryId: e.entryId,
      requestItemId: e.requestItemId,
      docKind: e.docKind,
      label: e.label,
      availability: e.availability,
      confirmedByOwner: e.confirmedByOwner,
    })),
    answers,
  };

  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 16384,
      system: PACKAGE_SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(input, null, 2) }],
    });

    const first = msg.content[0];
    if (!first || first.type !== "text") {
      return err({ code: "STORAGE_ERROR", message: "Claude вернул пустой ответ" });
    }

    const raw = first.text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    let parsed: { letter?: string; documents?: Array<{ fileName?: string; title?: string; content?: string }> };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return err({ code: "STORAGE_ERROR", message: `Невалидный JSON от Claude: ${raw.slice(0, 300)}` });
    }

    if (!parsed.letter || typeof parsed.letter !== "string") {
      return err({ code: "STORAGE_ERROR", message: "Ответ не содержит поле letter" });
    }

    const documents: GeneratedDoc[] = (parsed.documents ?? [])
      .filter(d => d.fileName && d.title && d.content)
      .map(d => ({ fileName: d.fileName!, title: d.title!, content: d.content! }));

    const validationError = validatePackage(parsed.letter, documents);
    if (validationError) {
      return err({ code: "STORAGE_ERROR", message: validationError });
    }

    return ok({ draftLetter: parsed.letter, documents });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message: msg });
  }
}
