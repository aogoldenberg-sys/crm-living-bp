import type { AnthropicClient } from "../client.js";
import type { DocMappedSection, SourceDocKind } from "@crm/schemas";
import { z } from "zod";
import { ok, err } from "@crm/core";
import type { Result } from "@crm/core";

const PageMappingSchema = z.array(
  z.object({
    pageNum: z.number().int().positive(),
    sectionId: z.string().min(1),
    confidence: z.number().min(0).max(1),
    excerpt: z.string().max(500),
  })
).catch([]);

// Промпт версионируется — изменение требует нового суффикса _V2
const EXTRACT_PROMPT_V1 = `Ты — аналитик документов. Тебе дан текст постранично.
Задача: определить к какому разделу бизнес-плана относится каждая страница.

Известные разделы (sectionId):
executive_summary, problem, solution, market_size, target_audience, value_proposition,
competitors, business_model, pricing, product_roadmap, go_to_market, sales_channels,
marketing_strategy, team, operations, finances, unit_economics, risks, legal,
kpi_metrics, funding_ask, exit_strategy.

Формат ответа — JSON массив:
[{"pageNum": 1, "sectionId": "finances", "confidence": 0.9, "excerpt": "краткая выдержка"}]

Верни ТОЛЬКО валидный JSON. Если страница не относится ни к одному разделу — не включай.`;

export async function extractDocsPages(
  client: AnthropicClient,
  pages: Array<{ pageNum: number; text: string }>,
  docKind: SourceDocKind,
): Promise<Result<DocMappedSection[]>> {
  if (pages.length === 0) return ok([]);

  const pagesText = pages
    .map(p => `[Страница ${p.pageNum}]\n${p.text.slice(0, 800)}`)
    .join("\n\n");

  let responseText: string;
  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system: EXTRACT_PROMPT_V1,
      messages: [{ role: "user", content: `Вид документа: ${docKind}\n\n${pagesText}` }],
    });
    const first = msg.content[0];
    if (!first || first.type !== "text") {
      return err({ code: "STORAGE_ERROR", message: "Empty Claude response" });
    }
    responseText = first.text;
  } catch (e) {
    return err({ code: "STORAGE_ERROR", message: e instanceof Error ? e.message : String(e) });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(responseText);
  } catch {
    // Try to extract JSON from markdown code block
    const match = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    try { raw = match ? JSON.parse(match[1]!) : []; } catch { raw = []; }
  }

  const parsed = PageMappingSchema.safeParse(raw);
  if (!parsed.success) return ok([]); // graceful fallback

  return ok(parsed.data.map(p => ({
    sectionId: p.sectionId,
    pageRange: [p.pageNum, p.pageNum] as [number, number],
    confidence: p.confidence,
  })));
}
