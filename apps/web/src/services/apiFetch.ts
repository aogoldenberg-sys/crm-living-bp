// Единая обёртка для fetch к гейтованным эндпоинтам.
// При HTTP 402 бросает PaywallError — не строку, не generic Error.

export class PaywallError extends Error {
  readonly reason: string;
  readonly requiredTier?: string;
  readonly requiredProduct?: string;

  constructor(body: { reason?: string; error?: string; requiredTier?: string; requiredProduct?: string }) {
    const msg = body.reason ?? body.error ?? "Требуется подписка";
    super(msg);
    this.name = "PaywallError";
    this.reason = msg;
    this.requiredTier = body.requiredTier;
    this.requiredProduct = body.requiredProduct;
  }
}

export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status === 402) {
    const body = await res.json().catch(() => ({})) as {
      reason?: string;
      error?: string;
      requiredTier?: string;
      requiredProduct?: string;
    };
    throw new PaywallError(body);
  }
  return res;
}
