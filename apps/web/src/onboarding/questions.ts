export const QUESTIONS = [
  { id: "q1",  text: "В чём ваш бизнес? Чем занимаетесь?",                                             type: "text",            required: true },
  { id: "q2",  text: "Это товар, услуга или и то, и другое?",                                           type: "radio_with_text", options: ["товар", "услуга", "и то, и другое"] as readonly string[], textPlaceholder: "Уточните подробнее...", textOnlyFor: "и то, и другое", required: true },
  { id: "q3",  text: "На каком вы этапе?",                                                              type: "radio",           options: ["идея", "запускаемся", "уже работаем"] as readonly string[], required: true },
  { id: "q4",  text: "Где работаете? (город, регион или онлайн)",                                       type: "text",            required: true },
  { id: "q5",  text: "Кто ваши клиенты? Кто у вас покупает?",                                          type: "text",            required: false, skippable: true },
  { id: "q6",  text: "Что хорошего ваш бизнес даёт клиентам? Зачем они к вам приходят?",               type: "textarea",        required: true },
  { id: "q7",  text: "Какую проблему клиента вы решаете?",                                              type: "textarea",        required: true },
  { id: "q8",  text: "Чем вы лучше других? (1–3 пункта)",                                              type: "textarea",        required: false, skippable: true },
  { id: "q9",  text: "Как клиенты о вас узнают?",                                                      type: "text",            required: false, skippable: true },
  { id: "q10", text: "Назовите 2–3 конкурентов и чем они отличаются",                                  type: "textarea",        required: true },
] as const;

export type QuestionId = typeof QUESTIONS[number]["id"];
export type Answers = Partial<Record<QuestionId, string>>;
