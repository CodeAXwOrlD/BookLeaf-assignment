import { CATEGORIES, maxPriority, type Category, type Priority } from '../domain/constants';
import { fmtDate, inr, type BookFacts } from '../domain/facts';

/**
 * Everything in this file works with NO network and NO API key.
 *  - ruleClassify: keyword scoring + priority heuristics, used when every LLM provider is down.
 *  - applyPolicyFloors: deterministic business rules applied on top of the LLM too (the KB says
 *    ISBN errors are always high priority; a never-paid royalty past the window is never "Low").
 *  - templateDraft: a policy-accurate reply built purely from facts, so an admin never faces a blank box.
 */

export interface Classification {
  category: Category;
  priority: Priority;
  reasoning: string;
}

type Rule = [RegExp, number];

const CATEGORY_RULES: Record<Exclude<Category, 'General Inquiry'>, Rule[]> = {
  'Royalty & Payments': [
    [/royalt/i, 3], [/payout/i, 3], [/payment|paid|unpaid/i, 2], [/bank (transfer|account|details)/i, 2],
    [/earning|earned/i, 2], [/threshold/i, 2], [/commission/i, 1], [/\b(rs\.?|inr|₹)\s?\d/i, 1],
  ],
  'ISBN & Metadata Issues': [
    [/isbn/i, 4], [/metadata/i, 2], [/barcode/i, 2], [/wrong (title|author|cover|description|name)/i, 2], [/duplicate/i, 1],
  ],
  'Printing & Quality': [
    [/print(ing|ed)?\b/i, 2], [/quality/i, 2], [/blurry|blur/i, 3], [/misalign|misprint/i, 3], [/binding/i, 3],
    [/defect|damaged|torn/i, 3], [/reprint/i, 3], [/author copies/i, 2], [/colou?r/i, 1],
  ],
  'Distribution & Availability': [
    [/unavailable/i, 3], [/not (showing|available|listed|visible)/i, 3], [/out of stock/i, 2], [/listing|listed/i, 2],
    [/distribution/i, 2], [/amazon|flipkart/i, 1], [/stock/i, 1], [/platform/i, 1],
  ],
  'Book Status & Production Updates': [
    [/typesett/i, 3], [/cover design/i, 3], [/proofread/i, 3], [/editing/i, 2], [/production/i, 2],
    [/status of my book/i, 3], [/when (will|is)/i, 2], [/delay/i, 2], [/still in/i, 2], [/\beta\b/i, 2], [/how long/i, 1],
  ],
};

const score = (text: string, rules: Rule[]) => rules.reduce((n, [re, w]) => n + (re.test(text) ? w : 0), 0);

export function ruleClassify(subject: string, description: string): Classification {
  const text = `${subject}\n${description}`;
  let best: Category = 'General Inquiry';
  let bestScore = 1; // need at least 2 to leave General
  for (const cat of CATEGORIES) {
    if (cat === 'General Inquiry') continue;
    const s = score(text, CATEGORY_RULES[cat]);
    if (s > bestScore) {
      best = cat;
      bestScore = s;
    }
  }
  return { category: best, priority: rulePriority(best, text), reasoning: 'Keyword rules (AI unavailable).' };
}

function rulePriority(category: Category, text: string): Priority {
  const months = Number(/(\d+)\s*(?:months?|mahine)/i.exec(text)?.[1] ?? 0);
  if (/lawyer|legal (action|notice)|consumer (court|forum)|fraud|scam|cheat(ed|ing)|police|\bsue\b/i.test(text)) return 'Critical';
  const urgent = /urgent|asap|immediately|emergency/i.test(text);
  let p: Priority;
  switch (category) {
    case 'Royalty & Payments':
      if (/not (yet )?(received|got|paid)|haven'?t (received|been paid|got)|never (received|got|paid)|no royalt|zero|missing/i.test(text)) {
        p = months >= 6 ? 'Critical' : 'High';
      } else p = 'Medium';
      break;
    case 'ISBN & Metadata Issues':
      p = /wrong|different|duplicate|mismatch|incorrect|not match|another book/i.test(text) ? 'High' : /update|change|edit/i.test(text) ? 'Low' : 'Medium';
      break;
    case 'Printing & Quality':
      p = /terrible|blurry|misalign|damaged|defect|torn|misprint|binding/i.test(text) ? 'High' : 'Medium';
      break;
    case 'Distribution & Availability':
      p = /unavailable|not (showing|available)|can'?t (buy|find)/i.test(text) ? 'High' : 'Medium';
      break;
    case 'Book Status & Production Updates':
      p = months >= 2 || /delay|weeks/i.test(text) ? 'Medium' : 'Low';
      break;
    default:
      p = 'Low';
  }
  return urgent && p === 'Low' ? 'Medium' : p;
}

/** Business rules that always hold, whether the classification came from a model or from rules. */
export function applyPolicyFloors(
  c: Classification,
  text: string,
  focus: BookFacts | undefined,
): Classification {
  let { priority } = c;
  const notes: string[] = [];
  if (c.category === 'ISBN & Metadata Issues' && /wrong|different|duplicate|mismatch|incorrect|not match|another book/i.test(text)) {
    priority = maxPriority(priority, 'High');
    notes.push('policy: ISBN errors are high priority');
  }
  if (c.category === 'Royalty & Payments' && focus?.royalty.code === 'never_paid_overdue') {
    priority = maxPriority(priority, 'High');
    notes.push('records show an overdue first payout');
  }
  if (c.category === 'Distribution & Availability' && /unavailable|not (showing|available)/i.test(text)) {
    priority = maxPriority(priority, 'High');
    notes.push('published book cannot be bought');
  }
  return notes.length ? { ...c, priority, reasoning: `${c.reasoning} (${notes.join('; ')})` } : { ...c, priority };
}

// ------------------------------------------------------------------ template drafts

export interface TemplateCtx {
  firstName: string;
  subject: string;
  description: string;
  focus: BookFacts | undefined;
}

const SIGN = 'Warm regards,\nBookLeaf Author Support';

export function templateDraft(category: Category, ctx: TemplateCtx): string {
  const { firstName: fn, focus: b, description } = ctx;
  const title = b ? `"${b.title}"` : 'your book';
  const body = (() => {
    switch (category) {
      case 'Royalty & Payments':
        return royaltyBody(ctx, title);
      case 'ISBN & Metadata Issues':
        return `Thank you for flagging this, and I'm sorry for the worry. An ISBN that doesn't match across Amazon and the printed copy is a serious data issue, so I'm treating it as high priority.${b?.isbn ? ` The ISBN we hold on record for ${title} is ${b.isbn}.` : ''} I'm escalating it to our production team right now, and we will confirm what is wrong and how we are fixing it within 48 hours.\n\nIt would help if you could reply with a screenshot of the Amazon listing and a photo of the ISBN on the physical copy.`;
      case 'Printing & Quality':
        return `I'm sorry your author copies didn't meet the standard we hold ourselves to. We'll arrange a free reprint once we've verified the problem.\n\nCould you reply with a few clear photos of the affected pages and the cover (blurry images, misaligned pages, binding)? Once we have them, the reprint takes 5-7 business days from confirmation, and I'll send you the date as soon as it is booked.`;
      case 'Distribution & Availability':
        return distributionBody(ctx, title);
      case 'Book Status & Production Updates':
        return productionBody(b, title);
      default:
        return /description|bio|metadata|update|change/i.test(description)
          ? `Yes, this is possible. Metadata updates such as the book description can be submitted through your dashboard or by emailing the BookLeaf team. Changes typically show up on the platforms within 3-5 business days.\n\nSend us the new text and the book title, and we'll take it from there.`
          : `Thanks for getting in touch. I've read your note and our team is looking into it; you will hear back from us within 48 hours with a clear answer.\n\nIf there is anything else that would help us respond faster, such as screenshots or the book title, just reply here.`;
    }
  })();
  return `Hi ${fn},\n\n${body}\n\n${SIGN}`;
}

function royaltyBody({ description, focus: b }: TemplateCtx, title: string): string {
  const wantsBreakdown = /low|less|too little|seems|calculat|breakdown/i.test(description);
  const breakdown = `\n\nFor transparency: royalties follow an 80/20 split of net profit, where net profit is MRP minus printing cost, platform commission and shipping. I'm happy to send you a line-by-line breakdown for ${title} showing sales per platform; just say the word.`;
  if (!b) {
    return `Thank you for writing in about your royalties. We calculate royalties quarterly and pay within 45 days of quarter end, to the bank account linked in your dashboard, with a minimum payout of ${inr(1000)} (smaller amounts roll over). Could you tell me which book you are asking about so I can check the exact figures? I'll reply within 48 hours.${wantsBreakdown ? breakdown : ''}`;
  }
  const next = `The next payout is due by ${fmtDate(b.nextPayoutDue)}.`;
  switch (b.royalty.code) {
    case 'never_paid_overdue':
      return `Thank you for raising this, and I'm sorry: your first payout for ${title} is overdue, and that is on us. Our records show ${inr(b.pending)} pending and no payout since publication; it was due by ${fmtDate(b.royalty.dueBy)}. I'm escalating this to our team now and we will confirm your transfer date within 48 hours.\n\nPlease also check that your bank details are linked in your dashboard so nothing holds the transfer up.`;
    case 'stale_since_last_payout':
      return `Thank you for checking in. ${title} has ${inr(b.pending)} pending, and your last payout was on ${fmtDate(b.lastPayoutDate)}, which is longer than our normal quarterly cycle. I'm asking our team to verify whether a payout was missed, and we'll get back to you within 48 hours with the answer and a transfer date.${wantsBreakdown ? breakdown : ''}`;
    case 'below_threshold':
      return `Thank you for asking. ${title} has ${inr(b.pending)} in royalties so far, which is under our ${inr(1000)} minimum payout threshold, so it rolls over to the next quarter instead of being paid now. Nothing is late; once the total passes ${inr(1000)} it is paid within 45 days of that quarter's end. ${next}${wantsBreakdown ? breakdown : ''}`;
    case 'first_payout_due':
    case 'in_cycle':
      return `Thank you for asking. For ${title}, ${inr(b.pending)} is pending and sits inside our normal cycle: royalties are calculated quarterly and paid within 45 days of the quarter ending. ${next} Please confirm your bank details are linked in your dashboard so the transfer goes through on time.${wantsBreakdown ? breakdown : ''}`;
    case 'settled':
      return `Thank you for asking. For ${title}, all earned royalties (${inr(b.earned)}) have been paid, the last on ${fmtDate(b.lastPayoutDate)}. New sales are added each quarter. ${next}${wantsBreakdown ? breakdown : ''}`;
    case 'no_sales':
      return `Thank you for asking. ${title} is live but hasn't recorded sales yet, so there is no royalty to pay so far. I'm happy to go through where it is listed and what we can do to help it get discovered.`;
    default:
      return `Thank you for asking. ${title} isn't published yet, so there are no sales or royalties to report. Royalties begin accruing once it goes live, calculated quarterly and paid within 45 days of quarter end.`;
  }
}

function distributionBody({ description, focus: b }: TemplateCtx, title: string): string {
  if (b && !b.isPublished) {
    return `Thanks for checking. ${title} is still in production (${b.status.replace(/^In Production\s*-\s*/i, '')}), so it isn't on any platform yet. New listings go live 7-10 business days after publication is complete, and you'll get an email as soon as that happens.`;
  }
  const asked = /flipkart/i.test(description) ? 'Flipkart' : /amazon us/i.test(description) ? 'Amazon US' : /amazon uk/i.test(description) ? 'Amazon UK' : null;
  if (b && asked && !b.platforms.some((p) => p.toLowerCase() === asked.toLowerCase())) {
    return `Thanks for asking. ${title} is currently listed on ${b.platforms.join(', ')}, and ${asked} isn't one of them yet. I'm checking with our distribution team whether we can add it, and will reply within 48 hours with a clear yes or the steps involved.`;
  }
  return `I'm sorry the listing for ${title} is showing as unavailable. This is usually a stock sync issue between our system and the platform. I'm triggering a re-sync with our distribution team now; it normally takes 24-48 hours to go live again.${b ? ` We have it recorded as listed on ${b.platforms.join(', ')}.` : ''} If it is still unavailable after 48 hours, reply here and I'll chase it directly.`;
}

function productionBody(b: BookFacts | undefined, title: string): string {
  if (!b) {
    return `Thanks for checking in. Tell me which book you're asking about and I'll share exactly where it is in our process and when to expect the next update. You'll hear back within 48 hours.`;
  }
  if (b.production) {
    const delayNote = /^(Cover Design|Proofreading)$/i.test(b.production.stage)
      ? ` This is one of the stages where we often wait on a round of feedback, and we'll make that as easy as possible for you.`
      : '';
    return `Thanks for checking in on ${title}. It is currently at ${b.production.stage}, stage ${b.production.position} of ${b.production.total} in our process.${delayNote} After this come ${b.production.remaining.slice(0, 3).join(', ')} and then Published & Live. I'm confirming a firm date for the next milestone with the production team and will send it within 48 hours.`;
  }
  return `Thanks for checking in. ${title} is already ${b.status}, published on ${fmtDate(b.publicationDate)}, and listed on ${b.platforms.join(', ')}. If you were expecting something different, tell me what you're seeing and I'll look into it within 48 hours.`;
}
