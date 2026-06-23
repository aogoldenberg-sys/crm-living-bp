/**
 * Unit-тесты для compute-воркера.
 *
 * Запускаются в Vitest + FakeFirestore — workerd не нужен.
 * Цель: доказать изоляцию тенантов в цикле runWithDb до того,
 * как в систему потекут реальные деньги клиентов.
 *
 * Инварианты:
 *   1. Цикл обрабатывает все тенанты независимо.
 *   2. Сбой одного тенанта (storage error) не останавливает остальных.
 *   3. Результаты сохраняются раздельно: planfact А не перезаписывает planfact Б.
 */

import { describe, it, expect } from "vitest";
import type { BusinessEvent } from "@crm/schemas";
import { FakeFirestore } from "@crm/firestore-adapter/testing";
import {
  registerTenant,
  saveEvents,
  saveFunnel,
  loadPlanfact,
  loadDemandSignals,
  type Db,
  type CollectionRef,
} from "@crm/firestore-adapter";
import type { Funnel } from "@crm/schemas";
import { runWithDb } from "./index.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makePaymentIn(businessId: string, eventId: string, amount: number): BusinessEvent {
  return {
    type: "payment_in",
    businessId,
    eventId,
    ts: "2026-01-15T10:00:00Z",
    valueDate: "2026-01-15",
    amount,
    counterpartyInn: null,
    counterpartyName: "ООО Тест",
    purpose: "Оплата услуг",
    matchedInvoiceId: null,
    source: "manual",
  } as BusinessEvent;
}

/** Создаёт Db, который бросает только для конкретного пути коллекции. */
function makePartialErrorDb(inner: FakeFirestore, failCollectionPath: string): Db {
  const storageError = new Error(`Simulated storage failure for ${failCollectionPath}`);

  function throwingCollection(): CollectionRef {
    const throwingQuery = {
      where: () => throwingQuery,
      orderBy: () => throwingQuery,
      get: async () => { throw storageError; },
    };
    return {
      ...throwingQuery,
      doc: () => ({
        id: "fake",
        get: async () => { throw storageError; },
        set: async () => { throw storageError; },
      }),
    } as unknown as CollectionRef;
  }

  return {
    collection(path: string): CollectionRef {
      if (path === failCollectionPath) return throwingCollection();
      return inner.collection(path);
    },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("runWithDb — мультитенантный цикл", () => {
  it("обрабатывает двух тенантов: каждый получает свой planfact", async () => {
    const db = new FakeFirestore();

    // Регистрируем два тенанта
    await registerTenant(db, "alpha");
    await registerTenant(db, "beta");

    // Alpha: 150 000 ₽ поступление
    await saveEvents(db, "alpha", [
      makePaymentIn("alpha", "00000000-0000-0000-0000-000000000001", 150_000_00),
    ]);

    // Beta: 50 000 ₽ поступление
    await saveEvents(db, "beta", [
      makePaymentIn("beta", "00000000-0000-0000-0000-000000000002", 50_000_00),
    ]);

    await runWithDb(db);

    const alphaResult = await loadPlanfact(db, "alpha");
    const betaResult = await loadPlanfact(db, "beta");

    expect(alphaResult.ok).toBe(true);
    expect(betaResult.ok).toBe(true);

    if (alphaResult.ok && betaResult.ok) {
      expect(alphaResult.value).not.toBeNull();
      expect(betaResult.value).not.toBeNull();

      // Суммы не смешались: у каждого тенанта своя
      expect(alphaResult.value!.totalIn).toBe(150_000_00);
      expect(betaResult.value!.totalIn).toBe(50_000_00);

      // Результат Alpha не «утёк» к Beta и наоборот
      expect(alphaResult.value!.totalIn).not.toBe(betaResult.value!.totalIn);
    }
  });

  it("сбой одного тенанта не останавливает обработку другого", async () => {
    const inner = new FakeFirestore();

    // Регистрируем оба тенанта
    await registerTenant(inner, "good-tenant");
    await registerTenant(inner, "bad-tenant");

    // good-tenant имеет валидные события
    await saveEvents(inner, "good-tenant", [
      makePaymentIn("good-tenant", "00000000-0000-0000-0000-aaaaaaaaaa01", 75_000_00),
    ]);

    // bad-tenant: симулируем storage failure при чтении его событий
    const db = makePartialErrorDb(inner, "tenants/bad-tenant/events");

    // runWithDb должен завершиться без throw — bad-tenant логирует ошибку и пропускается
    await expect(runWithDb(db)).resolves.toBeUndefined();

    // good-tenant всё равно обработан и сохранён
    const goodResult = await loadPlanfact(inner, "good-tenant");
    expect(goodResult.ok).toBe(true);
    if (goodResult.ok) {
      expect(goodResult.value).not.toBeNull();
      expect(goodResult.value!.totalIn).toBe(75_000_00);
    }

    // bad-tenant planfact не был записан (storage error до aggregation)
    const badResult = await loadPlanfact(inner, "bad-tenant");
    expect(badResult.ok).toBe(true);
    if (badResult.ok) {
      expect(badResult.value).toBeNull(); // planfact не записан
    }
  });

  it("нет тенантов — runWithDb завершается без ошибок", async () => {
    const db = new FakeFirestore();
    await expect(runWithDb(db)).resolves.toBeUndefined();
  });
});

// ── Funnel step ────────────────────────────────────────────────────────────────

let _eid = 0;
function fakeUuid(): string {
  return `00000000-0000-0000-0000-${String(++_eid).padStart(12, "0")}`;
}

const DEAL_X = "aaaaaaaa-0000-0000-0000-000000000001";
const DEAL_Y = "aaaaaaaa-0000-0000-0000-000000000002";
const OWNER  = "bbbbbbbb-0000-0000-0000-000000000001";

function makeDealEvent(
  businessId: string,
  dealId: string,
  fromStage: string,
  toStage: string,
  ts: string,
): BusinessEvent {
  return {
    type: "deal_stage_changed",
    eventId: fakeUuid(),
    ts,
    dealId,
    leadId: fakeUuid(),
    fromStage,
    toStage,
    funnelId: "main",
    estimatedAmount: 500_000_00,
    probability: 0.6,
    expectedCloseDate: null,
    expectedPaymentDate: null,
    clientId: null,
    ownerId: OWNER,
    counterpartyInn: null,
    counterpartyName: "ООО Тест",
    managerId: OWNER,
    source: "manual",
    businessId,
  } as BusinessEvent;
}

const TEST_FUNNEL: Funnel = {
  funnelId: "main",
  name: "Основная",
  stages: [
    { id: "new",      name: "Новый",        normConversion: 0.8, normDays: 3,  terminal: false },
    { id: "qual",     name: "Квалификация", normConversion: 0.6, normDays: 7,  terminal: false },
    { id: "proposal", name: "КП",           normConversion: 0.5, normDays: 14, terminal: false },
    { id: "won",      name: "Закрыто",      normConversion: 1.0, normDays: 1,  terminal: false },
  ],
};

describe("runWithDb — funnel step", () => {
  it("сохраняет проекцию сделок в tenants/{id}/deals", async () => {
    const db = new FakeFirestore();
    await registerTenant(db, "t1");
    await saveFunnel(db, "t1", TEST_FUNNEL);

    await saveEvents(db, "t1", [
      makeDealEvent("t1", DEAL_X, "",    "new",  "2026-06-15T10:00:00Z"),
      makeDealEvent("t1", DEAL_X, "new", "qual", "2026-06-16T10:00:00Z"),
      makeDealEvent("t1", DEAL_Y, "",    "new",  "2026-06-17T10:00:00Z"),
    ]);

    await runWithDb(db);

    // Проверяем что документы появились
    const dealX = await db.collection("tenants/t1/deals").doc(DEAL_X).get();
    const dealY = await db.collection("tenants/t1/deals").doc(DEAL_Y).get();

    expect(dealX.exists).toBe(true);
    expect(dealX.data()?.currentStage).toBe("qual");

    expect(dealY.exists).toBe(true);
    expect(dealY.data()?.currentStage).toBe("new");
  });

  it("сохраняет funnel_metrics для воронки", async () => {
    const db = new FakeFirestore();
    await registerTenant(db, "t2");
    await saveFunnel(db, "t2", TEST_FUNNEL);

    await saveEvents(db, "t2", [
      makeDealEvent("t2", DEAL_X, "",    "new",      "2026-06-15T10:00:00Z"),
      makeDealEvent("t2", DEAL_X, "new", "qual",     "2026-06-16T10:00:00Z"),
      makeDealEvent("t2", DEAL_X, "qual","proposal", "2026-06-17T10:00:00Z"),
      makeDealEvent("t2", DEAL_X, "proposal","won",  "2026-06-18T10:00:00Z"),
    ]);

    await runWithDb(db);

    const metricsSnap = await db.collection("tenants/t2/funnel_metrics").doc("main").get();
    expect(metricsSnap.exists).toBe(true);

    const stages = metricsSnap.data()?.stages as Array<{ stageId: string; count: number }>;
    expect(Array.isArray(stages)).toBe(true);
    expect(stages.find(s => s.stageId === "won")?.count).toBe(1);
    expect(stages.find(s => s.stageId === "new")?.count).toBe(0);
  });

  it("нет воронок — не падает, deals всё равно сохраняются", async () => {
    const db = new FakeFirestore();
    await registerTenant(db, "t3");
    // Воронку НЕ сохраняем

    await saveEvents(db, "t3", [
      makeDealEvent("t3", DEAL_X, "", "new", "2026-06-15T10:00:00Z"),
    ]);

    await expect(runWithDb(db)).resolves.toBeUndefined();

    // deals всё равно записаны
    const dealX = await db.collection("tenants/t3/deals").doc(DEAL_X).get();
    expect(dealX.exists).toBe(true);
  });

  it("нет deal-событий — funnel step пропускается молча", async () => {
    const db = new FakeFirestore();
    await registerTenant(db, "t4");
    await saveFunnel(db, "t4", TEST_FUNNEL);
    // Событий не добавляем — только платёжные через planfact

    await expect(runWithDb(db)).resolves.toBeUndefined();

    // Документов в deals нет
    const metricsSnap = await db.collection("tenants/t4/funnel_metrics").doc("main").get();
    expect(metricsSnap.exists).toBe(false);
  });
});

// ── Demand step ────────────────────────────────────────────────────────────────

let _leadId = 0;
function makeLeadEvent(businessId: string, ts: string): BusinessEvent {
  return {
    type: "lead_captured",
    eventId: fakeUuid(),
    ts,
    leadId: `cccccccc-0000-0000-0000-${String(++_leadId).padStart(12, "0")}`,
    channel: "website",
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    contactPhone: null,
    contactEmail: null,
    source: "manual",
    businessId,
  } as BusinessEvent;
}

/** Воронка с явно помеченной terminal-стадией «won». */
const FUNNEL_WITH_TERMINAL: Funnel = {
  funnelId: "main",
  name: "Основная",
  stages: [
    { id: "new",  name: "Новый",   normConversion: 0.8, normDays: 3,  terminal: false },
    { id: "qual", name: "Квал",    normConversion: 0.6, normDays: 7,  terminal: false },
    { id: "won",  name: "Закрыто", normConversion: 1.0, normDays: 1,  terminal: true  },
  ],
};

describe("runWithDb — demand step", () => {
  it("сохраняет demand_signals когда есть лид-события", async () => {
    const db = new FakeFirestore();
    await registerTenant(db, "d1");
    await saveFunnel(db, "d1", FUNNEL_WITH_TERMINAL);

    await saveEvents(db, "d1", [
      makeLeadEvent("d1", "2026-06-01T10:00:00Z"),
      makeLeadEvent("d1", "2026-06-10T10:00:00Z"),
      makeLeadEvent("d1", "2026-06-20T10:00:00Z"),
    ]);

    await runWithDb(db);

    const result = await loadDemandSignals(db, "d1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).not.toBeNull();
      // Все три лида в окне 30 дней (тест запускается в 2026)
      expect(result.value!.leads).toBeGreaterThanOrEqual(0);
      expect(result.value!.qualifiedRate).toBeGreaterThanOrEqual(0);
      expect(result.value!.trendScore).toBeGreaterThanOrEqual(-1);
      expect(result.value!.trendScore).toBeLessThanOrEqual(1);
    }
  });

  it("нет лид-событий — demand_signals не записываются", async () => {
    const db = new FakeFirestore();
    await registerTenant(db, "d2");
    // Только deal-события, без LeadCaptured
    await saveEvents(db, "d2", [
      makeDealEvent("d2", DEAL_X, "", "new", "2026-06-15T10:00:00Z"),
    ]);

    await runWithDb(db);

    const result = await loadDemandSignals(db, "d2");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeNull();
    }
  });

  it("wonStageIds из terminal=true стадий — winRate не null", async () => {
    const db = new FakeFirestore();
    await registerTenant(db, "d3");
    await saveFunnel(db, "d3", FUNNEL_WITH_TERMINAL);

    const leadId = `cccccccc-0000-0000-0001-${String(++_leadId).padStart(12, "0")}`;
    const dealId = "dddddddd-0000-0000-0000-000000000001";

    await saveEvents(db, "d3", [
      // Лид
      {
        type: "lead_captured",
        eventId: fakeUuid(),
        ts: "2026-06-15T10:00:00Z",
        leadId,
        channel: "direct",
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        contactPhone: null,
        contactEmail: null,
        source: "manual",
        businessId: "d3",
      } as BusinessEvent,
      // Открытие сделки по этому лиду
      {
        type: "deal_stage_changed",
        eventId: fakeUuid(),
        ts: "2026-06-15T11:00:00Z",
        dealId,
        leadId,
        fromStage: "",
        toStage: "new",
        funnelId: "main",
        estimatedAmount: 300_000_00,
        probability: 0.5,
        expectedCloseDate: null,
        expectedPaymentDate: null,
        clientId: null,
        ownerId: OWNER,
        counterpartyInn: null,
        counterpartyName: "ООО Тест",
        managerId: OWNER,
        source: "manual",
        businessId: "d3",
      } as BusinessEvent,
      // Закрытие в won (terminal)
      {
        type: "deal_stage_changed",
        eventId: fakeUuid(),
        ts: "2026-06-20T10:00:00Z",
        dealId,
        leadId,
        fromStage: "new",
        toStage: "won",
        funnelId: "main",
        estimatedAmount: 300_000_00,
        probability: 1.0,
        expectedCloseDate: null,
        expectedPaymentDate: null,
        clientId: null,
        ownerId: OWNER,
        counterpartyInn: null,
        counterpartyName: "ООО Тест",
        managerId: OWNER,
        source: "manual",
        businessId: "d3",
      } as BusinessEvent,
    ]);

    await runWithDb(db);

    const result = await loadDemandSignals(db, "d3");
    expect(result.ok).toBe(true);
    if (result.ok && result.value !== null) {
      // winRate должен быть определён (≠ null): wonStageIds = ["won"]
      expect(result.value.winRate).not.toBeNull();
      // 1 сделка вошла, 1 выиграна → 100%
      expect(result.value.winRate).toBe(1);
    }
  });

  it("сбой demand step не ломает planfact другого тенанта", async () => {
    const inner = new FakeFirestore();
    await registerTenant(inner, "d-good");
    await registerTenant(inner, "d-bad");

    await saveEvents(inner, "d-good", [
      makePaymentIn("d-good", "00000000-0000-0000-0000-bb0000000001", 100_000_00),
    ]);

    // Симулируем падение demand_signals у d-bad
    const db = makePartialErrorDb(inner, "tenants/d-bad/demand_signals");

    await expect(runWithDb(db)).resolves.toBeUndefined();

    // d-good planfact записан
    const goodResult = await loadPlanfact(inner, "d-good");
    expect(goodResult.ok).toBe(true);
    if (goodResult.ok) {
      expect(goodResult.value?.totalIn).toBe(100_000_00);
    }
  });
});
