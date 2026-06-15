import { describe, it, expect } from "vitest";
import { LeadCaptured } from "./lead.js";

const valid = {
  type: "lead_captured" as const,
  eventId: "550e8400-e29b-41d4-a716-446655440020",
  ts: "2026-06-12T08:00:00Z",
  leadId: "550e8400-e29b-41d4-a716-446655440021",
  channel: "yandex_direct",
  utmSource: "yandex",
  utmMedium: "cpc",
  utmCampaign: "citycar_june",
  contactPhone: "+79001234567",
  contactEmail: "client@example.com",
  source: "ads_api" as const,
  businessId: "opentgp",
};

describe("LeadCaptured", () => {
  it("принимает валидное событие", () => {
    expect(LeadCaptured.parse(valid)).toEqual(valid);
  });
  it("принимает null UTM-поля", () => {
    expect(
      LeadCaptured.parse({
        ...valid,
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        contactPhone: null,
        contactEmail: null,
      }),
    ).toBeTruthy();
  });
  it("отклоняет невалидный email", () => {
    expect(() => LeadCaptured.parse({ ...valid, contactEmail: "not-an-email" })).toThrow();
  });
  it("отклоняет пустой channel", () => {
    expect(() => LeadCaptured.parse({ ...valid, channel: "" })).toThrow();
  });
  it("отклоняет лишние поля (.strict)", () => {
    expect(() => LeadCaptured.parse({ ...valid, adId: "123" })).toThrow();
  });
  it("отклоняет некорректный ts", () => {
    expect(() => LeadCaptured.parse({ ...valid, ts: "12-06-2026" })).toThrow();
  });
  it("отклоняет событие без businessId", () => {
    const { businessId: _, ...withoutBusinessId } = valid;
    expect(LeadCaptured.safeParse(withoutBusinessId).success).toBe(false);
  });
});
