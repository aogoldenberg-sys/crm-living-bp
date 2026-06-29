export const QUESTIONS = [
  { id: "q1",  text: "Что вы продаёте?",                                        type: "radio_with_text", options: ["товар", "услуга", "и то, и другое"] as readonly string[], textPlaceholder: "Уточните: что именно...", required: true },
  { id: "q2",  text: "Ниша / сфера деятельности?",                              type: "text",     required: true },
  { id: "q3",  text: "Стадия проекта",                                           type: "radio",    options: ["идея", "запускаемся", "уже работаем"] as readonly string[], required: true },
  { id: "q4",  text: "География — где работаете?",                               type: "text",     placeholder: "город, регион или онлайн", required: true },
  { id: "q5",  text: "Зачем бизнес существует, какую задачу решает?",            type: "textarea", required: true },
  { id: "q6",  text: "Какую проблему клиента вы решаете?",                       type: "textarea", required: true },
  { id: "q7",  text: "Кто ваш клиент?",                                          type: "text",     required: false, skippable: true },
  { id: "q8",  text: "Чем вы лучше альтернатив? Назовите 3 пункта.",             type: "textarea", required: false, skippable: true },
  { id: "q9",  text: "Как клиент о вас узнаёт? Перечислите каналы.",             type: "text",     required: false, skippable: true },
  { id: "q10", text: "Месячный бюджет на привлечение клиентов (₽)",              type: "number",   placeholder: "0", required: true, allowZero: true },
  { id: "q11", text: "2–3 конкурента и их особенность",                          type: "textarea", required: true },
] as const;

export type QuestionId = typeof QUESTIONS[number]["id"];
export type Answers = Partial<Record<QuestionId, string>>;
