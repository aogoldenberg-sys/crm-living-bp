export const QUESTIONS = [
  { id: "q1", text: "Название вашего бизнеса или проекта", type: "text", required: true },
  { id: "q2", text: "Опишите продукт или услугу: что именно, как работает, кому нужно", type: "textarea", required: true },
  { id: "q3", text: "Стадия проекта", type: "radio", options: ["идея", "запускаемся", "работаем"], required: true },
  { id: "q4", text: "Кто ваш целевой клиент? Какую проблему вы решаете для него?", type: "textarea", required: true },
  { id: "q5", text: "Чем вы отличаетесь от конкурентов? Ваше главное преимущество?", type: "textarea", required: true },
  { id: "q6", text: "Планируемая выручка за первый полный год работы (₽)", type: "number", required: true },
  { id: "q7", text: "Размер стартовых инвестиций / капитальных затрат (₽)", type: "number", required: false, skippable: true },
  { id: "q8", text: "Команда: количество человек, ключевые роли", type: "textarea", required: false, skippable: true },
  { id: "q9", text: "Назовите 2–3 главных конкурента", type: "textarea", required: false, skippable: true },
  { id: "q10", text: "Через сколько месяцев планируете выйти на безубыточность? (0 = уже прибыльны)", type: "number", required: true, allowZero: true },
  { id: "q11", text: "Какие ключевые риски угрожают проекту?", type: "textarea", required: true },
] as const;

export type QuestionId = typeof QUESTIONS[number]["id"];
export type Answers = Partial<Record<QuestionId, string>>;
