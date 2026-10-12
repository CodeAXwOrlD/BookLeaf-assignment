import { describe, expect, it } from 'vitest';
import { buildBookFacts, nextPayoutDue, lastCompletedQuarterEnd, type BookRow } from '../src/domain/facts';

const base: BookRow = {
  book_id: 'B', author_id: 'A', title: 'T', isbn: 'x', genre: 'g', publication_date: '2024-07-05', status: 'Published & Live',
  mrp: 400, author_royalty_per_copy: 30, total_copies_sold: 10, total_royalty_earned: 300, royalty_paid: 0, royalty_pending: 300,
  last_royalty_payout_date: null, print_partner: 'In-House', available_on: ['Amazon India'],
};

describe('payout dates', () => {
  it('uses quarter end + 45 days', () => {
    expect(lastCompletedQuarterEnd('2026-10-10')).toBe('2026-09-30');
    expect(nextPayoutDue('2026-10-10')).toBe('2026-11-14');
  });
  it('rolls to the next quarter once the window has passed', () => {
    expect(nextPayoutDue('2026-11-20')).toBe('2027-02-14');
  });
});

describe('royalty status edge cases from the sample data', () => {
  const asOf = '2026-10-10';
  it('never paid with pending above threshold is overdue', () => {
    const f = buildBookFacts({ ...base, royalty_pending: 2546, total_royalty_earned: 2546 }, asOf);
    expect(f.royalty.code).toBe('never_paid_overdue');
  });
  it('pending below 1000 rolls over and is not late', () => {
    const f = buildBookFacts({ ...base, royalty_pending: 850, total_royalty_earned: 850 }, asOf);
    expect(f.royalty.code).toBe('below_threshold');
    expect(f.royalty.note).toContain('NOT a late payment');
  });
  it('books in production have no royalties and expose the stage', () => {
    const f = buildBookFacts({ ...base, status: 'In Production - Cover Design', mrp: null, publication_date: null, total_copies_sold: 0, royalty_pending: 0, total_royalty_earned: 0 }, asOf);
    expect(f.royalty.code).toBe('not_published');
    expect(f.production?.stage).toBe('Cover Design');
    expect(f.production?.position).toBe(3);
  });
  it('fully paid books are settled', () => {
    expect(buildBookFacts({ ...base, royalty_pending: 0, royalty_paid: 300, last_royalty_payout_date: '2026-09-01' }, asOf).royalty.code).toBe('settled');
  });
});
