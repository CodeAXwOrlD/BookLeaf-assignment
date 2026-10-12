import type { Config } from '../../config';
import { ProviderError, type Provider } from '../types';
import { parseRetryAfter, readErrorBody } from './http';

/** Groq exposes an OpenAI-compatible chat completions API. Plain fetch: no SDK, no extra dependency. */
export function groqProvider(cfg: Config['llm']['groq']): Provider {
  const isReasoning = (m: string) => m.startsWith('openai/gpt-oss');
  return {
    name: 'groq',
    isConfigured: () => !!cfg.apiKey,
    modelFor: (tier) => (tier === 'fast' ? cfg.modelFast : cfg.modelDraft),
    async call(req, signal) {
      const model = req.tier === 'fast' ? cfg.modelFast : cfg.modelDraft;
      const body: Record<string, unknown> = {
        model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        temperature: req.temperature ?? 0.3,
        // gpt-oss models spend part of the budget on hidden reasoning, so leave headroom.
        max_completion_tokens: req.maxTokens + (isReasoning(model) ? 900 : 0),
      };
      if (req.json) body.response_format = { type: 'json_object' };
      if (isReasoning(model) && cfg.reasoningEffort) body.reasoning_effort = cfg.reasoningEffort;

      let res: Response;
      try {
        res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify(body),
        });
      } catch (e) {
        throw new ProviderError(`network error: ${(e as Error).message}`, null, true);
      }
      if (!res.ok) {
        const detail = await readErrorBody(res);
        throw new ProviderError(`groq ${res.status}: ${detail}`, res.status, res.status === 429 || res.status >= 500, parseRetryAfter(res));
      }
      const data: any = await res.json();
      const text = data?.choices?.[0]?.message?.content ?? '';
      if (!text) throw new ProviderError('groq returned empty content', res.status, true);
      return {
        text,
        model,
        promptTokens: data?.usage?.prompt_tokens ?? 0,
        completionTokens: data?.usage?.completion_tokens ?? 0,
      };
    },
  };
}
