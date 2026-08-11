import Anthropic from "@anthropic-ai/sdk";

// SDK 0.27.x doesn't declare thinking or betas params.
// We define the minimum callable surface so every caller stays fully typed.

export type ThinkingConfig = { type: "enabled"; budget_tokens: number };

type CacheControl = { type: "ephemeral" };
type SystemBlock = { type: "text"; text: string; cache_control?: CacheControl };

// Two known response block types. No catch-all: { type: string } breaks
// TypeScript discriminated-union narrowing (subsumes every literal).
// Unknown block types are handled at runtime by guards (b.type !== "text" → error).
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string };

type MessageResponse = { content: ContentBlock[] };

// content may be a string or an array of typed blocks (e.g. image + text for vision calls)
export type UserContentBlock = { type: string; [key: string]: unknown };
type MessageParam = { role: "user" | "assistant"; content: string | UserContentBlock[] };

type BaseParams = {
  model: string;
  max_tokens: number;
  messages: MessageParam[];
  system?: string | SystemBlock[];
};

interface Messages {
  create(params: BaseParams & { thinking?: ThinkingConfig }): Promise<MessageResponse>;
}

interface CachingMessages {
  create(params: BaseParams & { betas?: string[] }): Promise<MessageResponse>;
}

export interface AnthropicClient {
  messages: Messages;
  beta: {
    promptCaching: {
      messages: CachingMessages;
    };
  };
}

export function createAnthropicClient(apiKey: string): AnthropicClient {
  // SDK 0.27.x types don't expose thinking/betas; the runtime client accepts them.
  // РЕШЕНИЕ: single-step assertion to the correct surface, not type erasure.
  return new Anthropic({ apiKey }) as AnthropicClient;
}
