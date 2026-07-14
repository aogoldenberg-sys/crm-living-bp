import { describe, it, expect } from "vitest";
import { transcribeAudio } from "./transcribe.js";

const makeAi = (text: string) => ({
  run: async (_model: string, _input: Record<string, unknown>) => ({ text }),
});

describe("transcribeAudio", () => {
  it("пустые байты → throw", async () => {
    const ai = makeAi("test");
    await expect(transcribeAudio(new ArrayBuffer(0), ai)).rejects.toThrow("empty");
  });

  it("Whisper вернул текст → TranscribeResult", async () => {
    const ai = makeAi("платёж 50 тысяч от ООО Тест");
    const result = await transcribeAudio(new Uint8Array([1, 2, 3]).buffer, ai);
    expect(result.transcription).toBe("платёж 50 тысяч от ООО Тест");
  });

  it("Whisper вернул пустую строку → throw", async () => {
    const ai = makeAi("");
    await expect(transcribeAudio(new Uint8Array([1]).buffer, ai)).rejects.toThrow("empty transcription");
  });
});
