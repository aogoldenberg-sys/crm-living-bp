import { describe, it, expect } from "vitest";
import { CallLogged } from "./call.js";

const valid = {
  type: "call_logged" as const,
  eventId: "550e8400-e29b-41d4-a716-446655440030",
  ts: "2026-06-12T14:00:00Z",
  leadId: "550e8400-e29b-41d4-a716-446655440031",
  dealId: null,
  managerId: "550e8400-e29b-41d4-a716-446655440032",
  direction: "inbound" as const,
  durationSeconds: 180,
  recordingUrl: "https://pbx.example.com/rec/001.mp3",
  outcome: "answered" as const,
  source: "telephony" as const,
  businessId: "opentgp",
};

describe("CallLogged", () => {
  it("принимает валидное событие", () => {
    expect(CallLogged.parse(valid)).toEqual(valid);
  });
  it("принимает null leadId и dealId", () => {
    expect(CallLogged.parse({ ...valid, leadId: null, dealId: null })).toBeTruthy();
  });
  it("принимает нулевую длительность (звонок отклонён)", () => {
    expect(CallLogged.parse({ ...valid, durationSeconds: 0, outcome: "missed" })).toBeTruthy();
  });
  it("отклоняет float в durationSeconds", () => {
    expect(() => CallLogged.parse({ ...valid, durationSeconds: 180.5 })).toThrow();
  });
  it("отклоняет отрицательную длительность", () => {
    expect(() => CallLogged.parse({ ...valid, durationSeconds: -1 })).toThrow();
  });
  it("отклоняет невалидный URL записи", () => {
    expect(() => CallLogged.parse({ ...valid, recordingUrl: "not-a-url" })).toThrow();
  });
  it("отклоняет неизвестный outcome", () => {
    expect(() => CallLogged.parse({ ...valid, outcome: "rejected" })).toThrow();
  });
  it("отклоняет лишние поля (.strict)", () => {
    expect(() => CallLogged.parse({ ...valid, notes: "hello" })).toThrow();
  });
  it("отклоняет событие без businessId", () => {
    const { businessId: _, ...withoutBusinessId } = valid;
    expect(CallLogged.safeParse(withoutBusinessId).success).toBe(false);
  });
});
