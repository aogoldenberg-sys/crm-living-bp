/// <reference types="vitest/globals" />
// @vitest-environment jsdom
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { VoiceInput } from "./VoiceInput.js";

// ── Mock import.meta.env ─────────────────────────────────────────────────────
// vite injections are not available in vitest jsdom — provide a stub value.
vi.stubGlobal("import", {
  meta: { env: { VITE_INGEST_WORKER_URL: "http://localhost:8787", BASE_URL: "/" } },
});

// ── Mock MediaRecorder ────────────────────────────────────────────────────────
// jsdom doesn't implement MediaRecorder; we need a minimal stub.

interface MockRecorderInstance {
  ondataavailable: ((e: { data: { size: number } }) => void) | null;
  onstop: (() => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

const mockRecorderInstances: MockRecorderInstance[] = [];

class MockMediaRecorder {
  ondataavailable: ((e: { data: { size: number } }) => void) | null = null;
  onstop: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => {
    // Simulate async stop + onstop callback
    setTimeout(() => this.onstop?.(), 0);
  });

  static isTypeSupported = vi.fn(() => true);

  constructor(_stream: unknown, _opts?: unknown) {
    mockRecorderInstances.push(this);
  }
}

vi.stubGlobal("MediaRecorder", MockMediaRecorder);

// ── Mock navigator.mediaDevices ───────────────────────────────────────────────
const mockGetUserMedia = vi.fn().mockResolvedValue({
  getTracks: () => [{ stop: vi.fn() }],
} as unknown as MediaStream);

Object.defineProperty(navigator, "mediaDevices", {
  value: { getUserMedia: mockGetUserMedia },
  writable: true,
});

// ── Mock fetch ────────────────────────────────────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ─────────────────────────────────────────────────────────────────────────────

describe("VoiceInput", () => {
  beforeEach(() => {
    mockRecorderInstances.length = 0;
    mockFetch.mockReset();
    mockGetUserMedia.mockClear();
  });

  it("renders Говорить button", () => {
    const onResult = vi.fn();
    render(<VoiceInput businessId="biz-1" onResult={onResult} />);
    expect(screen.getByRole("button", { name: /начать запись/i })).toBeDefined();
    expect(screen.getByText("Говорить")).toBeDefined();
  });

  it("click → recording state with timer visible", async () => {
    const onResult = vi.fn();
    render(<VoiceInput businessId="biz-1" onResult={onResult} />);

    const btn = screen.getByRole("button", { name: /начать запись/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(screen.getByText(/Запись \d+ с/)).toBeDefined();
    });

    expect(mockGetUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(mockRecorderInstances).toHaveLength(1);
    expect(mockRecorderInstances[0].start).toHaveBeenCalled();
  });

  it("mock fetch resolves → onResult called with data", async () => {
    const responseData = { transcription: "тест", fields: { amount: 500 } };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => responseData,
    });

    const onResult = vi.fn();
    render(<VoiceInput businessId="biz-1" onResult={onResult} />);

    // Start recording
    fireEvent.click(screen.getByRole("button", { name: /начать запись/i }));
    await waitFor(() => expect(mockRecorderInstances).toHaveLength(1));

    // Trigger data + stop
    const rec = mockRecorderInstances[0];
    rec.ondataavailable?.({ data: { size: 100 } });

    // Stop recording
    fireEvent.click(screen.getByRole("button", { name: /остановить запись/i }));

    // Wait for onstop to fire and upload to complete
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(onResult).toHaveBeenCalledWith(responseData);
  });
});
