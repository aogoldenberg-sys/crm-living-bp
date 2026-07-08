import Anthropic from "@anthropic-ai/sdk";

// Prompt inlined — CF Workers don't support readFileSync
const SYSTEM_PROMPT = `Ты — эксперт по бизнес-планированию. Тебе предоставлены ответы пользователя на 10 вопросов о его бизнесе или проекте.

Задача: на основе этих ответов сгенерировать структурированный финансовый план в формате JSON строго по описанной ниже схеме.

## Правила генерации

1. **Не изобретай конкретные финансовые цифры**: используй только те числа, которые прямо указал пользователь. Если данные не предоставлены — пиши "Черновик — данные не предоставлены, требует проверки".
2. **Не выдавай числа «с потолка»**: если пользователь указал выручку за год, можно сделать простые расчёты (выручка / 12 = месячная). Но не придумывай структуру затрат, марже, оборачиваемости и т.д.
3. **Будь сбалансированным**: не льсти и не пугай. Отмечай реальные сильные стороны и реальные риски.
4. **Стадия проекта**: учитывай стадию (идея / запускаемся / работаем) при оценке достоверности разделов.
5. **Язык**: всегда отвечай на русском языке.

## Известные sectionId (ровно 22):
executive_summary, problem, solution, market_size, target_audience, value_proposition, competitors, business_model, pricing, product_roadmap, go_to_market, sales_channels, marketing_strategy, team, operations, finances, unit_economics, risks, legal, kpi_metrics, funding_ask, exit_strategy

## Схема ответа

Верни ТОЛЬКО валидный JSON без обёрток markdown, строго по схеме:

{
  "mappedSections": [
    {
      "sectionId": "<один из 22 sectionId>",
      "present": <true если есть достаточно данных, false если раздел пустой/черновик>,
      "contentSummary": "<краткое содержание раздела на основе ответов, или 'Черновик — данные не предоставлены, требует проверки'>",
      "confidence": <0.0–1.0, насколько полно раздел покрыт данными пользователя>
    }
  ],
  "assessment": {
    "strengths": [
      {
        "point": "<чёткая формулировка сильной стороны>",
        "sectionRef": "<sectionId где проявляется>",
        "evidence": "<конкретное доказательство из ответов пользователя>"
      }
    ],
    "concerns": [
      {
        "point": "<чёткая формулировка опасения>",
        "severity": "red" | "yellow",
        "sectionRef": "<sectionId где проявляется>",
        "rationale": "<почему это важно и как влияет на план>"
      }
    ],
    "gaps": [
      {
        "missingSection": "<sectionId отсутствующего раздела>",
        "whyMatters": "<почему важно заполнить этот раздел>"
      }
    ],
    "assumptionsExtracted": {
      "<ключ>": {
        "key": "<ключ>",
        "value": { "point": <число> },
        "unit": "<₽ | % | месяцев | шт>",
        "origin": "questionnaire",
        "confidence": <0.0–1.0>,
        "sourceSection": "<sectionId>"
      }
    },
    "verifiability": []
  },
  "confidence": <общая уверенность 0.0–1.0>,
  "disclaimer": "Данный анализ создан AI на основе ответов пользователя и не является финансовым советом. Для принятия финансовых и инвестиционных решений рекомендуется привлечение профессиональных консультантов. §20.4"
}

## Вопросы анкеты (10 штук, порядок важен)

- q1: "В чём ваш бизнес? Чем занимаетесь?" (описание бизнеса)
- q2: "Это товар, услуга или и то, и другое?" (тип продукта; при "и то, и другое" есть уточнение через \n)
- q3: "На каком вы этапе?" (идея / запускаемся / уже работаем)
- q4: "Где работаете? (город, регион или онлайн)" (география)
- q5: "Кто ваши клиенты? Кто у вас покупает?" (может отсутствовать — пропущен)
- q6: "Что хорошего ваш бизнес даёт клиентам? Зачем они к вам приходят?" (ценность)
- q7: "Какую проблему клиента вы решаете?" (проблема)
- q8: "Чем вы лучше других? (1–3 пункта)" (может отсутствовать — пропущен)
- q9: "Как клиенты о вас узнают?" (может отсутствовать — пропущен)
- q10: "Назовите 2–3 конкурентов и чем они отличаются"

## Правила заполнения mappedSections

- executive_summary: из q1+q2+q3. Всегда present=true.
- problem: из q7. present=true.
- solution: из q1+q2. present=true.
- market_size: черновик если не указано явно.
- target_audience: из q5 если заполнен, иначе черновик.
- value_proposition: из q6+q8.
- competitors: из q10. present=true.
- business_model: из q1+q2.
- pricing: черновик если не выводимо из ответов.
- product_roadmap: черновик.
- go_to_market: из q9 если заполнен.
- sales_channels: из q9 если заполнен.
- marketing_strategy: из q9 если заполнен, иначе черновик.
- team: черновик.
- operations: черновик.
- finances: черновик (финансовые данные не запрашивались).
- unit_economics: черновик.
- risks: выводимо из q7+q10+q2, черновик если недостаточно.
- legal: черновик.
- kpi_metrics: черновик.
- funding_ask: черновик.
- exit_strategy: черновик.

## Правила assessment

- strengths: 2–4 реальные сильные стороны на основе ответов.
- concerns: 1–4 опасения. red=критический, yellow=внимание.
- gaps: все разделы с present=false, важные для инвестиционного решения.
- assumptionsExtracted: извлекай только если пользователь явно назвал цифры в ответах (не выдумывай).

Верни ТОЛЬКО валидный JSON. Никакого текста до или после JSON.`;

export type GenerateAnswers = Record<string, string>;

export interface GeneratedPlan {
  mappedSections: Array<{
    sectionId: string;
    present: boolean;
    contentSummary: string;
    confidence: number;
  }>;
  assessment: {
    strengths: Array<{ point: string; sectionRef: string; evidence: string }>;
    concerns: Array<{ point: string; severity: "red" | "yellow"; sectionRef: string; rationale: string }>;
    gaps: Array<{ missingSection: string; whyMatters: string }>;
    assumptionsExtracted: Record<string, unknown>;
    verifiability: unknown[];
  };
  confidence: number;
  disclaimer: string;
}

export async function generatePlan(
  answers: GenerateAnswers,
  apiKey: string,
): Promise<GeneratedPlan> {
  const client = new Anthropic({ apiKey });

  const msg = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Ответы пользователя:\n${JSON.stringify(answers, null, 2)}`,
      },
    ],
  });

  const block = msg.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Claude вернул пустой ответ");
  }

  const clean = block.text
    .replace(/^```json\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  return JSON.parse(clean) as GeneratedPlan;
}
