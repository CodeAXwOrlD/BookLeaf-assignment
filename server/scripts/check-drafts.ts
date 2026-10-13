import { createDb } from '../src/db';
import { loadConfig, todayISO } from '../src/config';
import { createLlm } from '../src/ai/llm';
import { getDraft } from '../src/ai/drafter';
import { Hub } from '../src/realtime/hub';
import type { Ctx } from '../src/context';
import { loadTicketContext } from '../src/lib/ticketData';
import { factsToPrompt } from '../src/domain/facts';
import { kbFor } from '../src/ai/kb';
import type { Category } from '../src/domain/constants';

interface CheckResult {
  ticketId: number;
  author: string;
  book: string;
  run: number;
  provider: string;
  flagged: string[];
  passed: boolean;
}

// Canonical sample test queries
const SAMPLE_TICKETS = [
  { author: 'AUTH003', book: 'BK005', desc: 'Ananya (BK005 - overdue royalty)' },
  { author: 'AUTH006', book: 'BK010', desc: 'Arjun (BK010 - royalty calculation)' },
  { author: 'AUTH001', book: 'BK001', desc: 'Priya (BK001 - ISBN mismatch)' },
  { author: 'AUTH002', book: 'BK003', desc: 'Rohit (BK003 - print quality)' },
  { author: 'AUTH007', book: 'BK013', desc: 'Sneha (BK013 - cover design stage)' },
  { author: 'AUTH009', book: 'BK016', desc: 'Kavita (BK016 - below threshold rollover)' },
];

const STANDARD_POLICY_TOKENS = new Set([
  '80', '20', '80/20', '45', '1000', '1,000',
  '5', '7', '5-7', '10', '7-10',
  '24', '48', '24-48', '3', '3-5',
  '1', '2', '4', '6', '8', '9', // stage numbering (1 of 9, etc.)
  '2024', '2025', '2026',
]);

function extractNumbersAndAmounts(text: string): string[] {
  const matches: string[] = [];
  // Rupee amounts
  const rupeeMatches = text.match(/(?:₹|Rs\.?|INR)\s*[\d,]+/gi) || [];
  for (const m of rupeeMatches) matches.push(m.replace(/\s+/g, ''));
  // Plain numbers
  const plainNumMatches = text.match(/\b\d+(?:,\d+)?\b/g) || [];
  for (const m of plainNumMatches) matches.push(m);
  return Array.from(new Set(matches));
}

function normalizeNum(s: string): string {
  return s.replace(/^[^\d]+/, '').replace(/,/g, '').trim();
}

async function main() {
  console.log('===============================================================');
  console.log('BookLeaf Automated Draft Integrity & Fact Grounding Audit');
  console.log('===============================================================\n');

  const config = loadConfig();
  const db = await createDb(config);
  const hub = new Hub();

  const ctx: Ctx = {
    config,
    db,
    hub,
    llm: createLlm(config.llm),
    today: () => todayISO(config),
    log: { info() {}, warn() {}, error() {} },
  };

  const configuredProviders = ctx.llm.configured();
  if (configuredProviders.length === 0) {
    console.error('ERROR: No LLM providers configured in environment.');
    process.exit(1);
  }
  console.log(`Configured Providers: ${configuredProviders.join(', ')}\n`);

  const results: CheckResult[] = [];
  let allPassed = true;

  for (const item of SAMPLE_TICKETS) {
    const [tRow] = await db.query<{ id: number; subject: string; description: string; category: string }>(
      'SELECT id, subject, description, category FROM tickets WHERE author_id = $1 AND book_id = $2 LIMIT 1',
      [item.author, item.book],
    );

    if (!tRow) {
      console.warn(`[SKIP] Ticket for ${item.author} (${item.book}) not found in database.`);
      continue;
    }

    const loaded = await loadTicketContext(db, tRow.id, ctx.today());
    if (!loaded) continue;

    // Build the Ground Truth Token Set
    const factsText = factsToPrompt(loaded.facts, item.book, ctx.today());
    const kbSlice = kbFor(tRow.category as Category);
    const thread = await db.query<{ id: number; body: string }>(
      'SELECT id, body FROM ticket_messages WHERE ticket_id = $1 AND is_internal = FALSE ORDER BY id',
      [tRow.id],
    );
    const threadText = thread.slice(-4).map((m) => m.body).join('\n');
    const groundTruthRaw = `${factsText}\n${kbSlice}\n${tRow.subject}\n${tRow.description}\n${threadText}`;

    const allowedNums = new Set<string>();
    for (const token of STANDARD_POLICY_TOKENS) allowedNums.add(normalizeNum(token));
    for (const num of extractNumbersAndAmounts(groundTruthRaw)) {
      allowedNums.add(normalizeNum(num));
    }

    for (const provider of configuredProviders) {
      const providerLlm = createLlm({ ...config.llm, providers: [provider] });
      const testCtx: Ctx = { ...ctx, llm: providerLlm };

      for (let run = 1; run <= 3; run++) {
        const draft = await getDraft(testCtx, tRow.id, { force: true });
        if (!draft) {
          results.push({
            ticketId: tRow.id,
            author: item.author,
            book: item.book,
            run,
            provider,
            flagged: ['Failed to generate draft'],
            passed: false,
          });
          allPassed = false;
          continue;
        }

        const flagged: string[] = [];
        const lower = draft.body.toLowerCase();

        // 1. Department name checks
        if (lower.includes('finance team') || lower.includes('finance department')) {
          flagged.push('Invented "finance team"');
        }
        if (lower.includes('accounts team') || lower.includes('accounts department')) {
          flagged.push('Invented "accounts team"');
        }

        // 2. Numbers & Amounts checks
        const extracted = extractNumbersAndAmounts(draft.body);
        for (const itemStr of extracted) {
          const norm = normalizeNum(itemStr);
          if (!norm) continue;
          if (!allowedNums.has(norm)) {
            flagged.push(`Ungrounded number/amount: "${itemStr}"`);
          }
        }

        const passed = flagged.length === 0;
        if (!passed) allPassed = false;

        results.push({
          ticketId: tRow.id,
          author: item.author,
          book: item.book,
          run,
          provider: draft.provider ?? provider,
          flagged,
          passed,
        });
      }
    }
  }

  // Print results table
  console.log('| Ticket | Author | Book | Run | Provider | Status | Flagged Items |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of results) {
    const status = r.passed ? 'PASS ✓' : 'FAIL ✗';
    const issues = r.flagged.length ? r.flagged.join('; ') : 'None';
    console.log(`| #${r.ticketId} | ${r.author} | ${r.book} | ${r.run} | ${r.provider} | ${status} | ${issues} |`);
  }

  console.log('\n===============================================================');
  if (allPassed) {
    console.log('AUDIT RESULT: PASS ✓ - All drafts grounded in facts with 0 hallucinations.');
    console.log('===============================================================');
    await db.close();
    hub.close();
    process.exit(0);
  } else {
    console.error('AUDIT RESULT: FAIL ✗ - Some drafts contained ungrounded numbers or team names.');
    console.log('===============================================================');
    await db.close();
    hub.close();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal audit error:', err);
  process.exit(1);
});
