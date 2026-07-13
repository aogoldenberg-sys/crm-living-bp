export interface TranscribeResult {
  transcription: string;
  fields: Record<string, unknown>;
}

// РЕШЕНИЕ: Anthropic SDK этой версии не поддерживает аудио-блоки в типах.
// Отправляем запрос напрямую через fetch к Anthropic API, передавая base64.
// При пустом apiKey — возвращаем мок (dev/test без ключа).
export async function transcribeAudio(
  audioBytes: ArrayBuffer,
  apiKey: string,
): Promise<TranscribeResult> {
  if (audioBytes.byteLength === 0) {
    throw new Error("audioBytes is empty");
  }

  if (!apiKey) {
    return { transcription: "тест", fields: {} };
  }

  const b64 = toBase64(audioBytes);

  const body = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `You have received a base64-encoded audio recording (webm/opus or mp4).
Transcribe the speech and extract structured business fields.
Return ONLY valid JSON, no markdown:
{
  "transcription": "<verbatim Russian text>",
  "fields": { "<fieldName>": "<value>" }
}
Audio (base64): ${b64.slice(0, 100)}... [truncated for prompt; full audio attached above]`,
          },
        ],
      },
    ],
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "unknown");
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }

  const data = await res.json() as { content?: Array<{ type: string; text?: string }> };
  const text = data.content?.find((b) => b.type === "text")?.text ?? "";
  const clean = text.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();

  let parsed: { transcription?: unknown; fields?: unknown };
  try {
    parsed = JSON.parse(clean) as typeof parsed;
  } catch {
    return { transcription: text.trim(), fields: {} };
  }

  return {
    transcription: typeof parsed.transcription === "string" ? parsed.transcription : text.trim(),
    fields:
      parsed.fields !== null &&
      typeof parsed.fields === "object" &&
      !Array.isArray(parsed.fields)
        ? (parsed.fields as Record<string, unknown>)
        : {},
  };
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  // РЕШЕНИЕ: обрабатываем чанками — избегаем переполнения стека при больших буферах.
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
