import Anthropic from "@anthropic-ai/sdk";
import { VoiceExtractResult } from "@crm/schemas";

// Prompt embedded inline — CF Workers can't use fs/readFileSync
const SYSTEM_PROMPT = `# Voice Intent Extractor v1

You are extracting structured business intent from a voice transcript.

## Output format (JSON only, no markdown):
{
  "intent": "update_deal" | "add_expense" | "market_insight" | "adjust_plan",
  "diff": { ... intent-specific fields ... },
  "confidence": 0.0-1.0,
  "needsClarification": true/false,
  "clarificationQuestion": "..." // only if needsClarification=true
}

## Intent rules:
- update_deal: modifying deal amount, payment terms, or stage. diff must include dealId.
- add_expense: recording expense/cost. diff must include category and amount.
- market_insight: market observation, competitor info, trend. diff must include text.
- adjust_plan: roadmap change, milestone update. diff must include description.

## Confidence rules:
- 0.9+ = clear, unambiguous
- 0.7-0.9 = likely correct but some ambiguity
- <0.8 = set needsClarification=true and ask ONE specific question

## Examples of clarification questions:
- Ambiguous amount: "800 тысяч или 800 миллионов?"
- Missing deal: "По какой сделке обновить сумму?"
- Unclear category: "Это операционный расход или капитальные затраты?"

Return ONLY valid JSON. No explanation, no markdown.`;

export async function extractVoiceIntent(
  transcript: string,
  apiKey: string,
): Promise<VoiceExtractResult> {
  const client = new Anthropic({ apiKey });

  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001", // fast + cheap for voice
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: `Transcript: ${transcript}` }],
  });

  const text = msg.content.find((b) => b.type === "text")?.text ?? "";
  // Strip ```json``` if present
  const clean = text.replace(/^```json\s*/i, "").replace(/\s*```$/, "").trim();
  const raw = JSON.parse(clean) as Record<string, unknown>;

  // Validate with schema
  const result = VoiceExtractResult.parse({
    ...raw,
    rawTranscript: transcript,
  });

  // Enforce: confidence < 0.8 → needsClarification = true
  if (result.confidence < 0.8 && !result.needsClarification) {
    return {
      ...result,
      needsClarification: true,
      clarificationQuestion:
        (raw["clarificationQuestion"] as string | undefined) ??
        "Уточните, пожалуйста.",
    };
  }

  return result;
}
