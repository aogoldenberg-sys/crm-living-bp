import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiFetch, PaywallError } from "./apiFetch";

// ── apiFetch ──────────────────────────────────────────────────────────────────

describe("apiFetch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns response on 200", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("{}", { status: 200 }),
    ));
    const res = await apiFetch("/test");
    expect(res.status).toBe(200);
  });

  it("throws PaywallError on 402 with parsed fields", async () => {
    const bodyObj = { reason: "Нет доступа", requiredTier: "operator", requiredProduct: "scenario" };
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(bodyObj), {
        status: 402,
        headers: { "Content-Type": "application/json" },
      })),
    ));

    let caught: unknown;
    try {
      await apiFetch("/gated");
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(PaywallError);
    const pe = caught as PaywallError;
    expect(pe.reason).toBe("Нет доступа");
    expect(pe.requiredTier).toBe("operator");
    expect(pe.requiredProduct).toBe("scenario");
  });

  it("throws PaywallError on 402 with fallback when body is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() =>
      Promise.resolve(new Response("not json", { status: 402 })),
    ));

    let caught: unknown;
    try {
      await apiFetch("/gated");
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(PaywallError);
    const pe = caught as PaywallError;
    expect(typeof pe.reason).toBe("string");
    expect(pe.reason.length).toBeGreaterThan(0);
  });

  it("does not throw on 4xx other than 402", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("{}", { status: 403 }),
    ));
    const res = await apiFetch("/forbidden");
    expect(res.status).toBe(403);
  });
});
