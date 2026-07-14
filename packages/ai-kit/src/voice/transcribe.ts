// Workers AI Whisper STT — единственный корректный путь транскрипции.
// Anthropic API аудио не принимает; Claude без аудио будет галлюцинировать.
// Этот модуль не вызывается напрямую из core — только из ingest worker.

export interface TranscribeResult {
  transcription: string;
}

/**
 * Транскрибирует аудио через Cloudflare Workers AI (@cf/openai/whisper).
 * ai — binding из wrangler.toml [ai]. Нет ai = честная ошибка, не мок.
 */
export async function transcribeAudio(
  audioBytes: ArrayBuffer,
  ai: { run(model: string, input: Record<string, unknown>): Promise<unknown> },
): Promise<TranscribeResult> {
  if (audioBytes.byteLength === 0) {
    throw new Error("audioBytes is empty");
  }

  const b64 = toBase64(audioBytes);

  const result = await ai.run("@cf/openai/whisper", { audio: b64 }) as { text?: string };

  const transcription = result.text?.trim() ?? "";
  if (!transcription) {
    throw new Error("Whisper returned empty transcription");
  }

  return { transcription };
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
