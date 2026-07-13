import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Mock } from "vitest";

// --- мок firestore-adapter ---
const mockGet: Mock = vi.fn();
const mockSet: Mock = vi.fn();
const mockDoc: Mock = vi.fn(() => ({ get: mockGet, set: mockSet }));
const mockCollection: Mock = vi.fn(() => ({ doc: mockDoc }));
const mockDb = { collection: mockCollection };

const mockListTenants: Mock = vi.fn();
const mockLoadEvents: Mock = vi.fn();
const mockLoadForecast: Mock = vi.fn();

vi.mock("@crm/firestore-adapter", () => ({
  createFirestoreRestClient: vi.fn(() => mockDb),
  listTenants: (db: unknown) => mockListTenants(db),
  loadEvents: (db: unknown, id: unknown) => mockLoadEvents(db, id),
  loadForecast: (db: unknown, id: unknown) => mockLoadForecast(db, id),
}));

// --- мок @crm/core ---
const PERIOD_START = "2026-07-06";

const BASE_REPORT = {
  reportId: "r1",
  businessId: "biz1",
  periodStart: PERIOD_START,
  periodEnd: "2026-07-12",
  generatedAt: "2026-07-14T06:00:00Z",
  cash: { balance: 0, gapDate: null, gapAmount: null, confidence: 0.2 },
  topDeviations: [],
  recommendation: null,
  deliveredTo: [],
};

const mockBuildOwnerReport: Mock = vi.fn(() => ({ ...BASE_REPORT }));
const mockFormatTelegram: Mock = vi.fn(() => "full-report-text");
const mockFormatTelegramForRole: Mock = vi.fn(
  (_report: unknown, sections: unknown[]) =>
    sections.length === 0 ? "Нет доступных разделов" : `role-text:${sections.join(",")}`,
);

vi.mock("@crm/core", () => ({
  buildOwnerReport: (a: unknown, b: unknown, c: unknown, d: unknown) =>
    mockBuildOwnerReport(a, b, c, d),
  formatTelegram: (r: unknown) => mockFormatTelegram(r),
  formatTelegramForRole: (r: unknown, s: unknown[]) => mockFormatTelegramForRole(r, s),
}));

// stubGlobal fetch
const mockFetch: Mock = vi.fn(() =>
  Promise.resolve({ ok: true, text: () => Promise.resolve("") }),
);

import { runWeeklyReports } from "./weekly.js";

type FetchCall = [string, { body: string }];

function getChatIds(): string[] {
  return (mockFetch.mock.calls as unknown as FetchCall[]).map(
    ([, init]) => (JSON.parse(init.body) as { chat_id: string }).chat_id,
  );
}

function firstCallBody(): { chat_id: string; text: string } {
  const call = (mockFetch.mock.calls as unknown as FetchCall[])[0];
  if (!call) throw new Error("fetch not called");
  return JSON.parse(call[1].body) as { chat_id: string; text: string };
}

describe("runWeeklyReports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, text: () => Promise.resolve("") });
    vi.stubGlobal("fetch", mockFetch);

    mockListTenants.mockResolvedValue({ ok: true, value: ["biz1"] });
    mockLoadEvents.mockResolvedValue({ ok: true, value: { events: [] } });
    mockLoadForecast.mockResolvedValue({ ok: false, error: "no forecast" });

    // По умолчанию: отчёт не существует, нет подписок
    mockGet.mockResolvedValue({ exists: false });
    mockSet.mockResolvedValue(undefined);
  });

  it("идемпотентность: reportExists=true → sendTo и saveReport не вызываются", async () => {
    // Оба вызова get() (reportExists + loadSubscriptions) вернут exists:true,
    // но важен только первый — reportExists вернёт true и выйдет раньше
    mockGet.mockResolvedValue({ exists: true });

    await runWeeklyReports("sa-json", "tok", "default-chat", "2026-07-14T06:00:00Z");

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("первый прогон: saveReport вызван с periodStart, sendTo owner ровно 1 раз", async () => {
    mockGet
      .mockResolvedValueOnce({ exists: false })   // reportExists
      .mockResolvedValueOnce({ exists: false });   // loadSubscriptions

    await runWeeklyReports("sa-json", "tok", "default-chat", "2026-07-14T06:00:00Z");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(firstCallBody().chat_id).toBe("default-chat");

    expect(mockSet).toHaveBeenCalledTimes(1);
    const saved = (mockSet.mock.calls as unknown as [Record<string, unknown>][])[0]?.[0];
    expect(saved?.["periodStart"]).toBe(PERIOD_START);
  });

  it("подписки ролей: 2 роли → 3 отправки (owner + 2 роли), каждая со своим chatId", async () => {
    mockGet
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          ownerChatId: "owner-chat",
          roles: [
            { role: "sales", chatId: "sales-chat", sections: ["cash"] },
            { role: "ops", chatId: "ops-chat", sections: ["deviations"] },
          ],
        }),
      });

    await runWeeklyReports("sa-json", "tok", "owner-chat", "2026-07-14T06:00:00Z");

    expect(mockFetch).toHaveBeenCalledTimes(3);
    const chatIds = getChatIds();
    expect(chatIds).toContain("owner-chat");
    expect(chatIds).toContain("sales-chat");
    expect(chatIds).toContain("ops-chat");
  });

  it("нет подписок ролей → ровно 1 отправка (defaultChatId)", async () => {
    mockGet
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({ exists: false });

    await runWeeklyReports("sa-json", "tok", "default-chat", "2026-07-14T06:00:00Z");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(firstCallBody().chat_id).toBe("default-chat");
  });

  it("падение одного тенанта не валит остальных", async () => {
    mockListTenants.mockResolvedValue({ ok: true, value: ["bad-biz", "good-biz"] });

    mockBuildOwnerReport
      .mockReturnValueOnce({ ...BASE_REPORT, businessId: "bad-biz" })
      .mockReturnValueOnce({ ...BASE_REPORT, businessId: "good-biz" });

    // bad-biz: loadEvents бросает, runForTenant падает и перехватывается catch
    mockLoadEvents
      .mockRejectedValueOnce(new Error("Firestore down"))
      .mockResolvedValueOnce({ ok: true, value: { events: [] } });

    await runWeeklyReports("sa-json", "tok", "default-chat", "2026-07-14T06:00:00Z");

    // Только good-biz дошёл до sendTo
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(firstCallBody().chat_id).toBe("default-chat");
  });
});
