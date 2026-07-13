import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock global fetch ─────────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { transcribeAudio } = await import("./transcribe.js");

// ─────────────────────────────────────────────────────────────────────────────

function anthropicResponse(payload: object) {
  return {
    ok: true,
    json: async () => ({ content: [{ type: "text", text: JSON.stringify(payload) }] }),
  };
}

describe("transcribeAudio", () => {
  beforeEach(() => mockFetch.mockReset());

  it("empty audioBytes → throws", async () => {
    await expect(transcribeAudio(new ArrayBuffer(0), "key")).rejects.toThrow("audioBytes is empty");
  });

  it("small mock bytes + empty apiKey → returns mock response without calling API", async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const result = await transcribeAudio(bytes, "");
    expect(result.transcription).toBe("тест");
    expect(result.fields).toEqual({});
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("with apiKey + valid JSON response → returns parsed result", async () => {
    mockFetch.mockResolvedValueOnce(
      anthropicResponse({
        transcription: "запиши аренду 50 тысяч",
        fields: { category: "Аренда", amount: 50000 },
      }),
    );

    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const result = await transcribeAudio(bytes, "test-key");

    expect(result.transcription).toBe("запиши аренду 50 тысяч");
    expect(result.fields).toEqual({ category: "Аренда", amount: 50000 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("with apiKey + non-JSON response → falls back to raw text", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: "Это не JSON" }] }),
    });

    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const result = await transcribeAudio(bytes, "test-key");

    expect(result.transcription).toBe("Это не JSON");
    expect(result.fields).toEqual({});
  });
});
