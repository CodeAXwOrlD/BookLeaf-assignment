import { describe, expect, it } from 'vitest';
import { applyPolicyFloors, ruleClassify, templateDraft } from '../src/ai/fallback';
import { createLlm } from '../src/ai/llm';
import { parseTriageOutput } from '../src/ai/triage';
import { LlmUnavailableError, ProviderError, type Provider } from '../src/ai/types';
import { cleanDraft } from '../src/ai/prompts';

describe('rules fallback classifier (the 6 sample queries from the brief)', () => {
  const cases: [string, string, string][] = [
    ['I published my book 4 months ago and still have not received any royalty', 'Royalty & Payments', 'High'],
    ['My book is showing a different ISBN on Amazon than the physical copy', 'ISBN & Metadata Issues', 'High'],
    ['The print quality is terrible, images are blurry and pages are misaligned', 'Printing & Quality', 'High'],
    ['My book shows Currently Unavailable on Amazon', 'Distribution & Availability', 'High'],
    ['It has been 3 weeks and my book is still in typesetting. When will it be done?', 'Book Status & Production Updates', 'Medium'],
    ['Can I update the description of my book on Amazon?', 'General Inquiry', 'Low'],
  ];
  for (const [text, cat, pri] of cases) {
    it(text.slice(0, 50), () => {
      const r = ruleClassify(text, '');
      expect(r.category).toBe(cat);
      expect(r.priority).toBe(pri);
    });
  }
  it('flags 6+ months without royalty as Critical', () => {
    expect(ruleClassify('No royalty for 6 months', 'I have not received any royalty').priority).toBe('Critical');
  });
  it('policy floor lifts ISBN errors to at least High', () => {
    const r = applyPolicyFloors({ category: 'ISBN & Metadata Issues', priority: 'Low', reasoning: '' }, 'wrong isbn on amazon', undefined);
    expect(r.priority).toBe('High');
  });
});

describe('model output parsing', () => {
  it('accepts fenced / chatty JSON and fuzzy category names', () => {
    const r = parseTriageOutput('Sure! ```json\n{"category":"royalty","priority":"high","reasoning":"x"}\n```');
    expect(r).toEqual({ category: 'Royalty & Payments', priority: 'High', reasoning: 'x' });
  });
  it('rejects garbage', () => {
    expect(parseTriageOutput('no json here')).toBeNull();
    expect(parseTriageOutput('{"category":"banana","priority":"High"}')).toBeNull();
  });
  it('cleanDraft rejects too-short or AI-ish output', () => {
    expect(cleanDraft('ok')).toBeNull();
  });
});

describe('LLM gateway degradation', () => {
  const cfg = { providers: [], timeoutMs: 500, maxRetries: 1, concurrency: 2, dailyCap: 500, enabled: true, groq: {} as any, gemini: {} as any };
  const mk = (name: string, impl: () => Promise<any>): Provider => ({
    name, isConfigured: () => true, modelFor: () => 'm', call: impl,
  });
  const req = { system: 's', user: 'u', maxTokens: 10, tier: 'fast' as const };

  it('fails over to the second provider when the first is rate limited', async () => {
    const a = mk('a', async () => { throw new ProviderError('429', 429, true, 1); });
    const b = mk('b', async () => ({ text: 'hi', model: 'mb', promptTokens: 1, completionTokens: 1 }));
    const out = await createLlm(cfg, [a, b]).generate(req);
    expect(out.provider).toBe('b');
  });
  it('throws LlmUnavailableError when everything is down (callers then use fallbacks)', async () => {
    const a = mk('a', async () => { throw new ProviderError('500', 500, true, 1); });
    await expect(createLlm(cfg, [a]).generate(req)).rejects.toBeInstanceOf(LlmUnavailableError);
  });
  it('opens the circuit after repeated failures', async () => {
    let calls = 0;
    const a = mk('a', async () => { calls++; throw new ProviderError('400', 400, false); });
    const llm = createLlm(cfg, [a]);
    for (let i = 0; i < 5; i++) await llm.generate(req).catch(() => {});
    expect(calls).toBe(3);
  });
});

describe('template draft team naming', () => {
  it('never invents departments like finance team or accounts team', () => {
    const categories: ('Royalty & Payments' | 'ISBN & Metadata Issues' | 'Printing & Quality' | 'Distribution & Availability' | 'Book Status & Production Updates' | 'General Inquiry')[] = [
      'Royalty & Payments',
      'ISBN & Metadata Issues',
      'Printing & Quality',
      'Distribution & Availability',
      'Book Status & Production Updates',
      'General Inquiry',
    ];
    for (const cat of categories) {
      const draftWithoutBook = templateDraft(cat, {
        firstName: 'Ananya',
        subject: 'Payment overdue',
        description: 'Payment overdue, need help with accounts and finance breakdown',
        focus: undefined,
      });
      expect(draftWithoutBook.toLowerCase()).not.toContain('finance team');
      expect(draftWithoutBook.toLowerCase()).not.toContain('accounts team');
      expect(draftWithoutBook.toLowerCase()).not.toContain('payments team');

      const mockBook: any = {
        bookId: 'BK005',
        title: 'Between Two Temples',
        status: 'Published & Live',
        isPublished: true,
        platforms: ['Amazon India'],
        pending: 2546,
        earned: 2546,
        paid: 0,
        nextPayoutDue: '2025-11-15',
        lastPayoutDate: null,
        royalty: { code: 'never_paid_overdue', dueBy: '2024-11-15' },
      };
      const draftWithBook = templateDraft(cat, {
        firstName: 'Ananya',
        subject: 'Where is my money?',
        description: 'Where is my money?',
        focus: mockBook,
      });
      expect(draftWithBook.toLowerCase()).not.toContain('finance team');
      expect(draftWithBook.toLowerCase()).not.toContain('accounts team');
      expect(draftWithBook.toLowerCase()).not.toContain('payments team');
    }
  });
});
