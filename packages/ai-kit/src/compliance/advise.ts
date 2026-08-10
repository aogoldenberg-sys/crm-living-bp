import type { AnthropicClient } from "../client.js";
import { type Result, ok, err, LEGAL_BASIS } from "@crm/core";
import type { RequestingAuthority } from "@crm/schemas";
import type { DocumentClass } from "./classify.js";

export type Advisory = {
  essence: string;           // что это, кто прислал, что значит практически
  legalGround: string;       // норма + УСЛОВИЯ её применения
  notApplicable: string[];   // когда мера НЕ применяется — перечень
  consequences: string;      // чем грозит
  options: string[];         // варианты действий со сроками
  questions: string[];       // 3-5 вопросов, ответы меняют вывод
  offeredDocuments: string[]; // что система готова составить
  disclaimer: string;
};

const ADVISE_SYSTEM = `Ты — юридический советник по российскому праву.
Клиент получил официальный документ от государственного органа — предупреждение,
постановление, уведомление или иной акт. Документ не требует представить перечень
документов — он несёт правовое значение само по себе.

Твоя задача: дать глубокий практический разбор — что это значит для клиента,
при каких условиях мера применима, когда её можно оспорить, что делать.

## ГЛАВНОЕ ПРАВИЛО

ЗАПРЕЩЕНО:
- Использовать нормы, которых нет в переданном legalBasis.
- Выдумывать суммы, даты, номера дел.
- Пересказывать документ — клиент его читал. Давай то, чего в нём НЕТ.

Говори по-русски, простым языком. Без канцелярщины.

## Формат ответа — ТОЛЬКО валидный JSON, без markdown:

{
  "essence": "1-2 предложения: что это и кто прислал. Конкретно, практически.",
  "legalGround": "Норма + при каких конкретных условиях мера применима. Если есть порог суммы — указать.",
  "notApplicable": [
    "Ситуация 1, когда мера не применяется или незаконна",
    "Ситуация 2...",
    "..."
  ],
  "consequences": "Чем реально грозит. Конкретные последствия (штраф, ограничение права, арест), не только статьи.",
  "options": [
    "Шаг 1 с конкретным сроком",
    "Шаг 2...",
    "..."
  ],
  "questions": [
    "Конкретный вопрос, ответ на который меняет правовой вывод",
    "...",
    "...",
    "...",
    "..."
  ],
  "offeredDocuments": [],
  "disclaimer": "Это информационный анализ, а не юридическая консультация."
}

## ТРЕБОВАНИЯ К СЕКЦИЯМ

notApplicable — САМАЯ ЦЕННАЯ часть. Клиент должен увидеть, есть ли основание оспорить
меру. Бери из exceptions в legalBasis и переформулируй под ситуацию клиента.
Не оставляй пустым если исключения есть в legalBasis.

questions — строго конкретные, проверяют применимость условий и исключений.
Плохой: «нужна ли помощь юриста». Хороший: «какова сумма долга по исполнительному
производству» (проверяет порог применимости). Минимум 3, максимум 5.

options — реальные действия с конкретными сроками, не «проконсультируйтесь с юристом».`;

export async function adviseOnDocument(
  client: AnthropicClient,
  documentText: string,
  meta: {
    authority: RequestingAuthority;
    documentClass: DocumentClass;
    companyName: string | null;
    companyInn: string | null;
  },
): Promise<Result<Advisory>> {
  // LEGAL_BASIS is Record<RequestingAuthority, LegalBasisEntry> but noUncheckedIndexedAccess
  // means lookup returns T | undefined. We know all RequestingAuthority keys are present —
  // the Record type enforces it at definition, but TS still adds undefined at access sites.
  const basis = LEGAL_BASIS[meta.authority];
  const legalBasis = basis
    ? {
        norms: basis.norms,
        deadlineDays: basis.deadlineDays,
        liability: basis.liability,
        sanctions: basis.sanctions,
        conditions: basis.conditions,
        exceptions: basis.exceptions,
      }
    : { norms: [], deadlineDays: null, liability: null, sanctions: null, conditions: [], exceptions: [] };

  const input = {
    documentClass: meta.documentClass,
    authority: meta.authority,
    companyName: meta.companyName,
    companyInn: meta.companyInn,
    legalBasis,
    documentText,
  };

  try {
    // thinking включён: правовая квалификация — аналитическая задача.
    // После thinking msg.content[0] может быть thinking-блоком — используем .find().
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 16384,
      thinking: { type: "enabled", budget_tokens: 4000 },
      system: [{ type: "text", text: ADVISE_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: JSON.stringify(input, null, 2) }],
    });

    const textBlock = msg.content.find(
      (b): b is { type: "text"; text: string } => b.type === "text",
    );
    if (!textBlock?.text) {
      return err({ code: "STORAGE_ERROR", message: "Claude вернул пустой ответ (advise)" });
    }

    const raw = textBlock.text
      .replace(/^```(?:json)?\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return err({ code: "STORAGE_ERROR", message: `Невалидный JSON от advise: ${raw.slice(0, 300)}` });
    }

    if (!parsed || typeof parsed !== "object") {
      return err({ code: "STORAGE_ERROR", message: "advise: неожиданная структура ответа" });
    }

    const p = parsed as Record<string, unknown>;

    return ok({
      essence: typeof p.essence === "string" ? p.essence : "",
      legalGround: typeof p.legalGround === "string" ? p.legalGround : "",
      notApplicable: Array.isArray(p.notApplicable)
        ? (p.notApplicable as unknown[]).filter((x): x is string => typeof x === "string")
        : [],
      consequences: typeof p.consequences === "string" ? p.consequences : "",
      options: Array.isArray(p.options)
        ? (p.options as unknown[]).filter((x): x is string => typeof x === "string")
        : [],
      questions: Array.isArray(p.questions)
        ? (p.questions as unknown[]).filter((x): x is string => typeof x === "string")
        : [],
      offeredDocuments: Array.isArray(p.offeredDocuments)
        ? (p.offeredDocuments as unknown[]).filter((x): x is string => typeof x === "string")
        : [],
      disclaimer: typeof p.disclaimer === "string" ? p.disclaimer : "Это информационный анализ, а не юридическая консультация.",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ code: "STORAGE_ERROR", message });
  }
}
