# Write-up: BookLeaf Author Support & Communication Portal

## What I prioritised
The brief weights AI integration and architecture highest, so I spent the time there and kept the UI deliberately simple but considered.

1. **AI that cannot embarrass the company.** The model never calculates or looks anything up. Royalty position, payout dates and production stage are computed in code (`domain/facts.ts`) and injected as facts; the model only writes the words. Deterministic policy floors from the knowledge base sit on top of its classification (an ISBN error is never below High). A human always reviews the draft.
2. **It must work when the AI does not.** Ticket creation never waits on a model. Providers fail over (Groq, then Gemini) behind timeouts, backoff and a circuit breaker, and with no provider at all the app classifies by keyword rules and offers policy-accurate template drafts.
3. **Cost-conscious by construction.** Drafts are generated lazily, cached, de-duplicated, and built from only the relevant KB slice and book facts. A small model triages; a larger one drafts. Every call is logged with tokens.
4. **The ticket lifecycle end to end**: author submit, auto-triage, prioritised queue with SLA flags, override tracking, internal notes, replies appearing live for the author via Server-Sent Events, reopen on author reply.
5. **The dataset's edge cases**: never-paid royalties, a below-threshold rollover, books still in production.

## Trade-offs
- SSE with an in-memory hub instead of WebSockets or Redis: right-sized for one process, one interface to swap later.
- Embedded Postgres (PGlite) for zero-setup review, real Postgres via the same adapter in production.
- Attachments are metadata only, as the brief allows; I chose to polish triage and drafts instead.
- One idempotent schema file instead of migrations; stateless JWT sessions without revocation.

## How I would evolve it
Durable job queue (BullMQ or pg-boss) and Postgres `LISTEN/NOTIFY` for scale-out; real object-storage uploads; email notifications; password reset and SSO; versioned migrations. For AI quality: a labelled evaluation set, tracking classification accuracy, draft edit-distance and override rate over time, retrieval over a larger knowledge base once it outgrows a prompt slice, and a paid provider tier with a no-training agreement before real author data goes through it.
