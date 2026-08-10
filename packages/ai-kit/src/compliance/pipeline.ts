/**
 * Конвейер анализа требований/уведомлений.
 *
 * Всегда возвращает чёткий advisory-разбор: суть, условия, исключения,
 * конкретные шаги. Никаких шаблонных ответных писем.
 */

import type { AnthropicClient } from "../client.js";
import type { RequestItem, ChecklistEntry, RequestingAuthority } from "@crm/schemas";
import { type Result, ok, err, LEGAL_BASIS } from "@crm/core";

export type PipelineMeta = {
  authority: RequestingAuthority;
  incomingRef: { number: string | null; date: string | null };
  companyName: string | null;
  companyInn: string | null;
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
  mode: "advisory";
};

const ADVISORY_SYSTEM = `Ты — юридический советник. Тебе прислали документ от государственного органа:
это может быть запрос, требование, предупреждение, постановление или уведомление.
Твоя задача: дать чёткий и полезный разбор того, что происходит и что делать.

Говоришь по-русски, простым языком. Без канцелярщины.

## Что ты получаешь на вход (JSON)

- authority — тип органа (bailiffs = ФССП, fns_kameral = ФНС камеральная, labor_inspection = ГИТ и т.д.)
- legalBasis — нормы, сроки, санкции
- requestMeta — реквизиты документа (дата, номер, орган, адресат)
- requestItems — пункты/содержание полученного документа
- answers — уточнения от пользователя (могут быть пустыми)

## Что возвращаешь

ТОЛЬКО валидный JSON, без markdown, без комментариев:
{
  "letter": "текст анализа",
  "documents": []
}

## СТРУКТУРА АНАЛИЗА (поле letter)

Используй разделы ниже — только те, что применимы к ситуации:

СУТЬ ДОКУМЕНТА
1-2 предложения: что это и чего хочет орган. Конкретно, без пересказа юридических формулировок.

ЧТО ЭТО ЗНАЧИТ ДЛЯ ВАС
Жизненные последствия. Что реально может случиться, если не реагировать.
Для запросов документов — какие риски при непредоставлении (суммы штрафов, блокировки счетов и т.д.).
Для предупреждений — что ограничивается или запрещается на практике.

КОГДА ПРИМЕНЯЕТСЯ (если применимо)
Конкретные условия: суммы, сроки, виды нарушений/задолженностей.
Для запросов документов — какие именно документы и за какой период.

КОГДА НЕЛЬЗЯ ПРИМЕНИТЬ (если есть исключения)
Ситуации при которых мера незаконна: инвалидность, сумма ниже порога, единственный доход,
рассрочка, истечение срока, нарушение процедуры уведомления и т.д.
Пропусти раздел если исключений нет.

ЧТО ДЕЛАТЬ ДАЛЬШЕ
Конкретные шаги с реальными сроками:
- Что проверить прямо сейчас
- Что подготовить / куда обратиться
- Можно ли решить через Госуслуги или онлайн
- Что можно обжаловать и в какой срок
Для запросов документов — что собрать, что написать в сопроводительном письме, как ответить.

УТОЧНЯЮЩИЕ ВОПРОСЫ
3–5 вопросов для более точного совета. Примеры:
- Сумма долга / размер требования?
- Вид задолженности?
- Есть ли рассрочка/отсрочка?
- Нужна ли помощь с обжалованием?
- Какие документы уже имеются?

## ПРАВИЛА

- Статьи называй только там где они помогают понять суть (штраф 200 руб. по ст. 126 НК — ок)
- НЕ пересказывай дословно текст документа
- Каждый раздел — конкретный и полезный, не общие слова
- В documents всегда возвращать пустой массив []
- НЕ использовать скобки [...] нигде в тексте letter`;

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
      system: ADVISORY_SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(input, null, 2) }],
    });

    const first = msg.content[0];
    if (!first || first.type !== "text") {
      return err({ code: "STORAGE_ERROR", message: "Claude вернул пустой ответ" });
    }

    const raw = first.text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    let parsed: { letter?: string; documents?: unknown[] };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return err({ code: "STORAGE_ERROR", message: `Невалидный JSON от Claude: ${raw.slice(0, 300)}` });
    }

    if (!parsed.letter || typeof parsed.letter !== "string") {
      return err({ code: "STORAGE_ERROR", message: "Ответ не содержит поле letter" });
    }

    return ok({ draftLetter: parsed.letter, documents: [], mode: "advisory" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message: msg });
  }
}
