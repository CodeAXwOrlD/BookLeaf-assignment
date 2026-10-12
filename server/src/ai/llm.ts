import type { Config } from '../config';
import { geminiProvider } from './providers/gemini';
import { groqProvider } from './providers/groq';
import {
  LlmUnavailableError,
  ProviderError,
  type LlmRequest,
  type LlmResult,
  type Provider,
} from './types';

/**
 * Resilient LLM gateway. Callers say what they want; this decides who answers.
 *
 *  - Providers are tried in LLM_PROVIDERS order (default: Groq, then Gemini).
 *  - Per provider: timeout, retry with exponential backoff + jitter on 429/5xx/network
 *    (honouring Retry-After), and no retry on 4xx client errors.
 *  - Circuit breaker: after 3 consecutive failures a provider is skipped for 60s
 *    (10 min on 401/403, since a bad key will not fix itself). Stops us hammering a dead API
 *    and keeps ticket creation fast.
 *  - A small semaphore caps concurrent calls so we stay inside free-tier requests-per-minute.
 *  - If everything fails we throw LlmUnavailableError; callers degrade to rules/templates.
 */

interface Breaker {
  failures: number;
  openUntil: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Semaphore {
  private waiting: (() => void)[] = [];
  private active = 0;
  constructor(private readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

export interface LlmGateway {
  /** Names of providers that have an API key configured. */
  configured(): string[];
  generate(req: LlmRequest): Promise<LlmResult>;
  getStats(): { todayCalls: number; dailyCap: number; enabled: boolean };
  setTodayCalls(n: number): void;
}

export function createLlm(config: Config['llm'], providersOverride?: Provider[]): LlmGateway {
  const registry: Record<string, Provider> = {
    groq: groqProvider(config.groq),
    gemini: geminiProvider(config.gemini),
  };
  const providers =
    providersOverride ?? config.providers.map((n) => registry[n]).filter((p): p is Provider => !!p);
  const breakers = new Map<string, Breaker>();
  const gate = new Semaphore(config.concurrency);

  let todayCalls = 0;
  let currentDay = new Date().toISOString().slice(0, 10);

  const checkDay = () => {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== currentDay) {
      currentDay = today;
      todayCalls = 0;
    }
  };

  const breaker = (name: string) => {
    let b = breakers.get(name);
    if (!b) breakers.set(name, (b = { failures: 0, openUntil: 0 }));
    return b;
  };

  async function callWithRetry(p: Provider, req: LlmRequest): Promise<LlmResult> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), config.timeoutMs);
      const started = Date.now();
      try {
        const out = await p.call(req, ctrl.signal);
        return { ...out, provider: p.name, latencyMs: Date.now() - started };
      } catch (e) {
        lastErr = e;
        const err = e instanceof ProviderError ? e : new ProviderError(`${(e as Error).name}: ${(e as Error).message}`, null, true);
        lastErr = err;
        if (!err.retryable || attempt === config.maxRetries) break;
        const backoff = err.retryAfterMs ?? Math.min(400 * 2 ** attempt, 4000) + Math.random() * 250;
        await sleep(backoff);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  }

  const isEnabled = () => config.enabled !== false;
  const getDailyCap = () => config.dailyCap ?? 500;

  return {
    configured: () => {
      checkDay();
      if (!isEnabled() || todayCalls >= getDailyCap()) return [];
      return providers.filter((p) => p.isConfigured()).map((p) => p.name);
    },

    getStats: () => {
      checkDay();
      return { todayCalls, dailyCap: getDailyCap(), enabled: isEnabled() };
    },

    setTodayCalls: (n: number) => {
      todayCalls = n;
    },

    async generate(req) {
      checkDay();
      if (!isEnabled()) {
        throw new LlmUnavailableError('AI kill switch is active (LLM_ENABLED=false)', ['kill switch active']);
      }
      if (todayCalls >= getDailyCap()) {
        throw new LlmUnavailableError(`Daily AI cap reached (${getDailyCap()} calls per day)`, ['daily cap reached']);
      }

      const attempts: string[] = [];
      for (const p of providers) {
        if (!p.isConfigured()) {
          attempts.push(`${p.name}: no API key`);
          continue;
        }
        const b = breaker(p.name);
        if (Date.now() < b.openUntil) {
          attempts.push(`${p.name}: circuit open`);
          continue;
        }
        try {
          const result = await gate.run(() => callWithRetry(p, req));
          b.failures = 0;
          todayCalls++;
          return result;
        } catch (e) {
          const err = e as ProviderError;
          b.failures++;
          if (err.status === 401 || err.status === 403) b.openUntil = Date.now() + 10 * 60_000;
          else if (b.failures >= 3) b.openUntil = Date.now() + 60_000;
          attempts.push(`${p.name}: ${err.message}`);
        }
      }
      throw new LlmUnavailableError('All LLM providers failed or are unavailable', attempts);
    },
  };
}
