import type { Config } from '../../config';
import { ProviderError, type Provider } from '../types';
import { parseRetryAfter, readErrorBody } from './http';

/** Google AI Studio (Gemini API) via REST. The key is sent in a header, never in the URL, so it can't leak into logs. */
export function geminiProvider(cfg: Config['llm']['gemini']): Provider {
  return {
    name: 'gemini',
    isConfigured: () => !!cfg.apiKey,
    modelFor: (tier) => (tier === 'fast' ? cfg.modelFast : cfg.modelDraft),
    async call(req, signal) {
      const model = req.tier === 'fast' ? cfg.modelFast : cfg.modelDraft;
      const generationConfig: Record<string, unknown> = {
        temperature: req.temperature ?? 0.3,
        maxOutputTokens: req.maxTokens,
      };
      if (req.json) generationConfig.responseMimeType = 'application/json';
      if (cfg.thinkingBudget !== '' && !model.includes('-lite')) {
        generationConfig.thinkingConfig = { thinkingBudget: Number(cfg.thinkingBudget) };
      }

      let res: Response;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey! },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: req.system }] },
            contents: [{ role: 'user', parts: [{ text: req.user }] }],
            generationConfig,
          }),
        });
      } catch (e) {
        throw new ProviderError(`network error: ${(e as Error).message}`, null, true);
      }
      if (!res.ok) {
        const detail = await readErrorBody(res);
        throw new ProviderError(`gemini ${res.status}: ${detail}`, res.status, res.status === 429 || res.status >= 500, parseRetryAfter(res));
      }
      const data: any = await res.json();
      const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
      const text = parts.map((p) => p?.text ?? '').join('').trim();
      if (!text) throw new ProviderError(`gemini returned no text (finish: ${data?.candidates?.[0]?.finishReason ?? 'unknown'})`, res.status, true);
      return {
        text,
        model,
        promptTokens: data?.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: data?.usageMetadata?.candidatesTokenCount ?? 0,
      };
    },
  };
}
