import type { Strategy } from "@crm/schemas";

export const STRATEGY_LIBRARY: Strategy[] = [
  {
    id: "blue_ocean",
    name: "Голубой океан",
    description: "Создание нового рыночного пространства без прямой конкуренции. Фокус на незанятых сегментах и инновации ценностного предложения.",
    niche_tags: ["инновации", "innovation", "новый рынок", "уникальный", "tech", "b2c", "стартап", "startup"],
    causal_template: "RETAIL_TEMPLATE",
    levers: [
      { id: "value_innovation", label: "Инновация ценности", description: "Создать предложение, которого нет у конкурентов", causal_node_ids: ["revenue", "market_demand"] },
      { id: "cost_structure", label: "Упрощение структуры затрат", description: "Убрать «само собой разумеющееся» в отрасли", causal_node_ids: ["margin"] },
    ],
    win_conditions: [
      { id: "new_segment", description: "Захвачен сегмент без прямых конкурентов", metric_check: "topClientConcentration <= 0.4" },
      { id: "ltv_growth", description: "LTV/CAC > 4x", metric_check: "ltvCacRatio >= 4" },
    ],
    failure_patterns: [
      { id: "me_too", description: "Конкуренты скопировали предложение в течение 6 месяцев", warning_signal: "revenueGrowthRate < 0.05" },
    ],
  },
  {
    id: "cost_leadership",
    name: "Лидерство по затратам",
    description: "Самые низкие издержки в отрасли — конкурентное преимущество через масштаб и операционную эффективность.",
    niche_tags: ["производство", "масштаб", "b2b", "оптовый", "торговля", "commodity", "маркетплейс"],
    levers: [
      { id: "scale", label: "Масштабирование объёмов", description: "Увеличить объём для снижения удельных затрат", causal_node_ids: ["margin", "revenue"] },
      { id: "process_automation", label: "Автоматизация процессов", description: "Снизить ручной труд", causal_node_ids: ["margin"] },
    ],
    win_conditions: [
      { id: "margin_stable", description: "Маржа ≥ 15% при конкурентной цене", metric_check: "marginPercent >= 0.15" },
      { id: "payback_fast", description: "Payback < 18 месяцев", metric_check: "paybackMonths <= 18" },
    ],
    failure_patterns: [
      { id: "price_war", description: "Ценовая война уничтожает маржу", warning_signal: "marginPercent < 0.05" },
    ],
  },
  {
    id: "differentiation",
    name: "Дифференциация",
    description: "Уникальное предложение, за которое клиент готов платить премию. Сильный бренд, качество или сервис.",
    niche_tags: ["премиум", "бренд", "сервис", "b2c", "услуги", "качество", "консалтинг", "luxury"],
    levers: [
      { id: "brand_building", label: "Построение бренда", description: "Инвестировать в восприятие и репутацию", causal_node_ids: ["lead_count", "conversion"] },
      { id: "premium_service", label: "Премиум-сервис", description: "Превзойти ожидания клиента на каждом касании", causal_node_ids: ["conversion", "revenue"] },
    ],
    win_conditions: [
      { id: "ltv_high", description: "LTV/CAC > 5x — клиент возвращается", metric_check: "ltvCacRatio >= 5" },
      { id: "margin_premium", description: "Маржа > 30% — за счёт премии", metric_check: "marginPercent >= 0.30" },
    ],
    failure_patterns: [
      { id: "commoditization", description: "Рынок воспринимает как commodity", warning_signal: "marginPercent < 0.15" },
    ],
  },
  {
    id: "land_and_expand",
    name: "Land & Expand",
    description: "Зайти через небольшой контракт, доказать ценность, расширить внутри клиента. Типично для B2B SaaS и консалтинга.",
    niche_tags: ["b2b", "saas", "подписка", "subscription", "enterprise", "корпоративный", "it", "software"],
    levers: [
      { id: "pilot", label: "Пилотный проект", description: "Минимальный первый контракт для доказательства ценности", causal_node_ids: ["conversion", "revenue"] },
      { id: "expansion", label: "Расширение аккаунта", description: "Upsell и cross-sell внутри существующего клиента", causal_node_ids: ["revenue", "margin"] },
    ],
    win_conditions: [
      { id: "expansion_rate", description: "Net Revenue Retention > 110%", metric_check: "revenueGrowthRate >= 0.10" },
      { id: "cac_payback", description: "CAC payback < 12 мес", metric_check: "paybackMonths <= 12" },
    ],
    failure_patterns: [
      { id: "churn", description: "Клиенты не продлевают после пилота", warning_signal: "topClientConcentration > 0.7" },
    ],
  },
  {
    id: "niche_domination",
    name: "Доминирование в нише",
    description: "Стать абсолютным лидером в узком сегменте. Глубокая экспертиза и барьеры входа.",
    niche_tags: ["нишевый", "специализация", "b2b", "профессиональный", "медицина", "право", "строительство", "туризм", "глэмпинг"],
    levers: [
      { id: "expertise", label: "Экспертиза и IP", description: "Накапливать знания и барьеры входа", causal_node_ids: ["conversion", "margin"] },
      { id: "community", label: "Сообщество клиентов", description: "Создать профессиональное сообщество вокруг продукта", causal_node_ids: ["lead_count", "revenue"] },
    ],
    win_conditions: [
      { id: "niche_share", description: "Доля в нише > 30%", metric_check: "topClientConcentration <= 0.5" },
      { id: "referral", description: "Более 40% клиентов — по рекомендации", metric_check: "ltvCacRatio >= 3" },
    ],
    failure_patterns: [
      { id: "niche_shrink", description: "Ниша сжимается — спрос падает", warning_signal: "revenueGrowthRate < -0.05" },
    ],
  },
];
