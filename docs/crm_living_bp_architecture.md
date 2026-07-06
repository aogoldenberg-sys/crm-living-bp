# CRM Kairos — Living Architecture

> Документ обновляется при каждом значимом изменении архитектуры.
> Последнее обновление: 2026-07-02

---

## §1 Монорепо

```
crm/
├── apps/
│   ├── web/          — React SPA (Vite, Firebase Auth, React Query)
│   └── workers/
│       └── ingest/   — Cloudflare Worker (события, intake, external)
├── packages/
│   ├── core/         — доменная логика (forecast, intake, risk, types)
│   ├── schemas/      — Zod-схемы + TypeScript типы (BusinessEvent и др.)
│   ├── ai-kit/       — Claude API, ExtractedPlanSchema, AssessmentOutputSchema
│   ├── firestore-adapter/ — REST-клиент Firestore, saveEvents, loadForecast
│   └── worker-notify/ — уведомления из Worker
└── tools/
    └── generate-prompts.mjs — prebuild: prompts/*.md → prompts.generated.ts
```

Сборка: pnpm workspaces + Turborepo. CF Workers деплой — через VPS (Mac несовместим).

---

## §2 Принципы

- **Result вместо throw**: ядро (`@crm/core`) никогда не бросает исключений. Все ошибки — `Result<T>` с типизированным `DomainError`.
- **Явные ошибки**: все коды ошибок перечислены в `packages/core/src/types.ts`.
- **Промпты — единственный источник**: `packages/ai-kit/prompts/*.md` → `tools/generate-prompts.mjs` → `apps/workers/ingest/src/prompts.generated.ts`. Файл генерируется и коммитится (VPS не запускает prebuild).
- **businessId ≠ uid**: uid Firebase → `users/{uid}.businessId` в Firestore.

---

## §3 Аутентификация

| Маршрут | Auth |
|---------|------|
| `POST /` | `x-api-secret` (HMAC timing-safe) |
| `POST /intake` | Firebase ID Token (`Authorization: Bearer`) |
| `POST /events-user` | Firebase ID Token (`Authorization: Bearer`) |
| `POST /external` | `x-api-secret` |

Firebase ID Token верифицируется через Google JWK (WebCrypto). Проверяются: подпись, `iss`, `aud`, `exp`, `iat` (не позже now+5s), `email_verified`.

---

## §4 Схема событий (`@crm/schemas`)

Дискриминированный union `BusinessEvent` по полю `type`:

- `revenue` — выручка
- `expense` — расход
- `external_signal` — сигнал из внешнего источника (SHA-256 dedup)
- `balance_anchor` — привязка фактического остатка (источник: bank/manual/accounting)

---

## §5 Forecast

Monte Carlo, 1000 итераций. Выходы:

| Поле | Описание |
|------|---------|
| `gapDate` | первый день где p50 < 0 |
| `hardGapDate` | первый день где p90 < 0 (даже оптимистичный сценарий отрицателен) |
| `pessimisticGapDate` | первый день где p10 < 0 |

`balance_anchor` события используются как `initialBalance` (последний по дате).

Pipeline сделки (`ForecastPlan.pipeline`): если не пусты — стохастическая win/loss по `probability`; иначе Poisson-фоллбэк (алгоритм Кнута для λ≤30).

---

## §6 Intake pipeline (`POST /intake`)

```
Документ (PDF/DOCX/XLSX/TXT/MD/RTF)
  → извлечение текста (mammoth / ArrayBuffer)
  → Claude EXTRACT  (→ ExtractedPlan, Zod .strict())
  → mapToSections   (→ MappedSection[22])
  → Claude ASSESS   (→ AssessmentOutput, Zod .strict())
  → gateIntake      (→ verdict: skip|ask_human; потолок A3)
  → acceptIntake    (Firestore: plans/{businessId}/intake/{planId})
```

Ошибки Zod на Claude-ответе → 502 (не 500): Claude вернул невалидный JSON.
Лимит файла: 15 МБ. `max_tokens`: 16 000.
§20.4: disclaimer безусловный. §20.6: `act` недостижим на intake.

---

## §7 Firestore Security Rules

`isOwner(businessId)`:
```javascript
get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == "owner"
&& belongsTo(businessId)
```

После любого изменения rules — немедленно `firebase deploy --only firestore:rules`.

---

## §8 Деплой

**Cloudflare Worker (ingest)**:
1. `tar czf ingest.tar.gz apps/workers/ingest packages/...` (на Mac)
2. `scp ingest.tar.gz root@<VPS_IP>:/opt/crm/`
3. На VPS: распаковать, проверить симлинки в `node_modules/@crm/`, `wrangler deploy`

Симлинки в `node_modules/@crm/` создаются вручную на VPS (pnpm install не всегда создаёт их корректно).

**Firebase Rules**: `firebase deploy --only firestore:rules` (через REST API если нет CLI на VPS).

**Web (SPA)**: деплой через FTP (ftplib) на citycar36.ru или Vercel.

---

## §9 DomainError коды

```typescript
| { code: "INVALID_PERIOD" }
| { code: "NO_EVENTS" }
| { code: "NEGATIVE_BALANCE" }
| { code: "ZERO_PLAN" }
| { code: "STORAGE_ERROR" }    // I/O: Firestore, fs
| { code: "NOT_FOUND" }        // объект не найден в хранилище
| { code: "ALREADY_ACCEPTED" } // идемпотентный барьер
```

Источник: `packages/core/src/types.ts`.

---

## §10 Таксономия 22 разделов бизнес-плана

Источник: `packages/core/src/intake/sections.ts` → `REQUIRED_SECTIONS`.

Типы: **L** = Light (качественный, описательный) · **S** = Standard (структурированный) · **H** = Heavy (количественный, финансовый)

| # | sectionId | Тип | Описание |
|---|-----------|-----|---------|
| 1 | `executive_summary` | S | Резюме проекта — ключевые тезисы для инвестора |
| 2 | `problem` | L | Описание проблемы и боли клиента |
| 3 | `solution` | L | Предлагаемое решение |
| 4 | `market_size` | H | TAM/SAM/SOM, объём рынка в цифрах |
| 5 | `target_audience` | S | Портрет целевой аудитории, сегменты |
| 6 | `value_proposition` | L | УТП, ценностное предложение |
| 7 | `competitors` | S | Конкурентный анализ, матрица сравнения |
| 8 | `business_model` | S | Модель монетизации, потоки доходов |
| 9 | `pricing` | H | Ценообразование, тарифы, юнит-экономика цены |
| 10 | `product_roadmap` | S | Дорожная карта продукта, этапы |
| 11 | `go_to_market` | S | Стратегия выхода на рынок |
| 12 | `sales_channels` | S | Каналы продаж |
| 13 | `marketing_strategy` | S | Маркетинговая стратегия и бюджет |
| 14 | `team` | L | Команда, роли, опыт основателей |
| 15 | `operations` | S | Операционная модель, процессы |
| 16 | `finances` | H | P&L, балансовый прогноз, CF-модель |
| 17 | `unit_economics` | H | LTV, CAC, маржа, payback period |
| 18 | `risks` | S | Реестр рисков, митигация |
| 19 | `legal` | L | Правовая структура, IP, лицензии |
| 20 | `kpi_metrics` | H | Ключевые метрики, OKR, дашборд |
| 21 | `funding_ask` | H | Запрос финансирования, use of funds |
| 22 | `exit_strategy` | L | Стратегия выхода / горизонт инвестора |

**Правила извлечения (§10.1)**:
- Claude ищет разделы только по ключам из этой таблицы (snake_case, 22 штуки)
- Если раздел не найден — не включать в `rawSections`
- H-разделы → числовые `assumptions` обязательны при наличии данных
- L-разделы → `assumptions` могут быть пустыми, `rawSections.text` достаточно
- `confidence` = качество извлечения: 1.0 = явный раздел с данными, 0.3–0.6 = упоминание, <0.3 = не включать

---

## §11 Промпт-pipeline

```
packages/ai-kit/prompts/
├── intake_extract.md  — системный промпт EXTRACT (22 раздела, схема ExtractedPlan)
└── intake_assess.md   — системный промпт ASSESS (оценка §20.3)

↓ node tools/generate-prompts.mjs

apps/workers/ingest/src/prompts.generated.ts
  export const EXTRACT_SYSTEM = "...";
  export const ASSESS_SYSTEM  = "...";
```

Редактировать только `.md` файлы. После редактирования запустить `node tools/generate-prompts.mjs` и **закоммитить** `prompts.generated.ts`.
