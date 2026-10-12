import type { Category } from '../domain/constants';

/**
 * BookLeaf knowledge base, split by category so each LLM call only carries the slice it needs
 * (cost control: ~150-250 tokens of policy instead of the whole ~1.2k-token document).
 * Wording is condensed from the assignment brief; numbers and policies are unchanged.
 */

export const KB_SHARED = `BookLeaf Publishing is a self-publishing company in India and the US. Packages: Standard Free (no upfront cost) and Bestseller Breakthrough (paid, with marketing and distribution add-ons). BookLeaf handles cover design, typesetting, ISBN assignment, printing, distribution and royalty management. In-house printing facility and warehouse are in Delhi; print partners are Repro India and Epitome Books.`;

export const KB_BY_CATEGORY: Record<Category, string> = {
  'Royalty & Payments': `ROYALTY POLICY
- 80/20 split: 80% of net profit per book goes to the author, 20% to BookLeaf.
- Net profit = MRP minus printing cost, platform commission (Amazon/Flipkart) and shipping charges.
- Royalties are calculated quarterly and paid within 45 days of the quarter ending.
- Minimum payout threshold is Rs 1,000. Below it, royalties roll over to the next quarter.
- Payouts go by bank transfer to the account linked in the author's dashboard.
- The dashboard shows a detailed royalty breakdown with sales per platform.
GUIDANCE
- Never paid / late: acknowledge the frustration, explain the quarterly cycle and 45-day window, ask them to confirm bank details are linked, give the specific next payout date. If genuinely overdue, own it and escalate with a 48-hour resolution timeline.
- "Royalty too low": explain net profit (MRP minus printing, platform commission, shipping), offer a detailed line-by-line breakdown, do not be defensive.`,

  'ISBN & Metadata Issues': `ISBN POLICY
- Every book gets a unique ISBN assigned by BookLeaf, registered under BookLeaf's publisher imprint. An author who wants an ISBN under their own imprint must obtain it independently.
- An ISBN error (duplicate, wrong book linked, mismatch between retailer and physical copy) is HIGH priority and is escalated to the production team.
- Metadata updates (description, etc.) can be submitted via the dashboard or by emailing the BookLeaf team and reflect on platforms within 3-5 business days.
GUIDANCE
- ISBN error: acknowledge it is a serious data issue, confirm escalation to the production team immediately, give a 48-hour resolution timeline.`,

  'Printing & Quality': `PRINTING POLICY
- In-house printing handles most orders; overflow or special formats go to Repro India or Epitome Books.
- Standard print turnaround is 5-7 business days from order confirmation.
- Quality issues (misprints, binding defects, colour inconsistency): BookLeaf arranges a free reprint after verification. The author may need to share photos of the defective copy.
GUIDANCE
- Apologise sincerely, ask for photos of the defective copies, confirm a free reprint once verified, give 5-7 business days for the reprint.`,

  'Distribution & Availability': `DISTRIBUTION POLICY
- Books are listed on Amazon India, Flipkart, Amazon US, Amazon UK and the BookLeaf Store (each book only on the platforms recorded for it).
- New listings go live within 7-10 business days after publication is complete.
- A book showing "unavailable" on a platform is usually a stock sync issue; BookLeaf can trigger a re-sync within 24-48 hours.
GUIDANCE
- "Currently Unavailable": explain it is typically a stock sync issue, confirm you are triggering a re-sync with the distribution team, set 24-48 hours.
- If the author asks about a platform that is not in the book's recorded platforms, say so plainly and offer to look into adding it.`,

  'Book Status & Production Updates': `PRODUCTION STAGES
Manuscript Received, Editing (if opted), Cover Design, Typesetting, Proofreading, ISBN Assignment, Printing, Distribution Setup, Published & Live. Authors get an email at each stage.
- Delays typically happen at Cover Design (waiting for author approval) and Proofreading (revision rounds).
GUIDANCE
- Use the real stage from the facts. If delayed, be honest about why, frame any author-side wait collaboratively (never blame), and give a specific updated timeline. If no dates are recorded, promise a confirmed ETA within 48 hours rather than inventing a date.`,

  'General Inquiry': `GENERAL
- Metadata updates (e.g. book description on Amazon after going live) can be submitted through the dashboard or by emailing the BookLeaf team; changes typically reflect on platforms within 3-5 business days.
- Authors can see royalty breakdowns and book status in their dashboard.
GUIDANCE
- Answer directly and briefly. If it needs another team, say who and when.`,
};

export const kbFor = (category: Category) => `${KB_SHARED}\n\n${KB_BY_CATEGORY[category]}`;
