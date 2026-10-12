export type Tier = 'fast' | 'draft';

export interface LlmRequest {
  system: string;
  user: string;
  json?: boolean;
  maxTokens: number;
  temperature?: number;
  /** fast = classification (small/cheap model), draft = reply writing (bigger model). */
  tier: Tier;
}

export interface LlmResult {
  text: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
}

/** Error from a single HTTP call to a provider; `retryable` drives the backoff loop. */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly retryable: boolean,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

export interface Provider {
  name: string;
  isConfigured(): boolean;
  modelFor(tier: Tier): string;
  call(req: LlmRequest, signal: AbortSignal): Promise<Omit<LlmResult, 'latencyMs' | 'provider'>>;
}

/** Thrown when every provider failed or none is configured. Callers fall back to rules/templates. */
export class LlmUnavailableError extends Error {
  constructor(message: string, public readonly attempts: string[]) {
    super(message);
  }
}
