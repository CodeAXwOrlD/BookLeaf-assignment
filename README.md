# BookLeaf Author Support & Communication Portal

Two portals on one codebase. **Authors** log in, see their books and royalties, raise support queries and watch replies arrive live. **BookLeaf's ops team** works a prioritised queue where every ticket is auto-classified, scored for urgency, and comes with a policy-accurate AI draft reply that a human edits before sending.

## Live demo and credentials

Live URL: `https://bookleaf-assignment-llzw.onrender.com`  
Demo video: `<add link here>`

| Role | Email | Password |
|---|---|---|
| Admin | `admin@bookleaf.in` | `admin123` |
| Admin | `ops@bookleaf.in` | `admin123` |
| Author (any of the 10) | e.g. `ananya.reddy@email.com` | `bookleaf123` |

With `DEMO_MODE=true` the login screen has dropdowns that fill these in. Author emails are the ones in the sample JSON.

Good records to try:
- **Ananya Reddy** (`BK005`): never paid, ₹2,546 pending, overdue. The draft owns it and escalates with a 48-hour timeline.
- **Kavita Deshmukh** (`BK016`): ₹850 pending, below the ₹1,000 threshold. The draft explains the rollover and does not call it late.
- **Sneha Kulkarni** (`BK013`) and **Kavita** (`BK015`): books still in production. The books page shows a stage tracker instead of royalty fields.

---

## Run it locally

Requirements: Node 20+ (tested on 22). **No database to install.** With no `DATABASE_URL` the server runs an embedded Postgres (PGlite) stored in `server/data/pgdata`.

```bash
npm run setup                      # installs server + web
cp server/.env.example server/.env # then add GROQ_API_KEY and/or GEMINI_API_KEY (optional)

npm run dev:server                 # API on http://localhost:4000, seeds on first boot
npm run dev:web                    # UI on http://localhost:5173 (proxies /api to :4000)
```

Open http://localhost:5173.

Production-style single process (API + built UI on one port):

```bash
npm run build && npm start         # http://localhost:4000
```

Other commands: `npm test`, `npm run typecheck`, `npm run seed -- --reset` (wipe and reseed).

**The app works with no API key at all.** It then classifies with keyword rules and starts every reply from a policy template (see [graceful degradation](#error-handling-and-graceful-degradation)).

### Environment variables (`server/.env.example`)

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Signs session tokens. Required in production; the server refuses to boot with the dev default. |
| `DATABASE_URL` | Postgres URL. Empty means embedded PGlite. |
| `DEMO_MODE` | `true` shows one-click demo accounts on the login screen. |
| `APP_TODAY` | Pin "today" (`YYYY-MM-DD`) for payout-date maths. The sample data's last payouts are in Dec 2025, so for a coherent demo set e.g. `APP_TODAY=2025-12-15`. |
| `LLM_PROVIDERS` | Provider order. Default `gemini,groq`. |
| `LLM_DAILY_CAP` | Daily budget cap for LLM calls (default `500`). When exceeded, the system gracefully falls back to rules and templates without failing requests. |
| `LLM_ENABLED` | Global AI kill switch (`true`/`false`, default `true`). Set to `false` during provider outages or maintenance to route all triage and drafts to rule engines. |
| `GROQ_API_KEY`, `GEMINI_API_KEY` | Keys. Server-side only, never sent to the browser. |
| `GROQ_MODEL_FAST/DRAFT`, `GEMINI_MODEL_FAST/DRAFT` | Model names, configurable because providers retire models. |
| `LLM_TIMEOUT_MS`, `LLM_MAX_RETRIES`, `LLM_CONCURRENCY` | Resilience and rate-limit knobs. |

---

## Deploy

One service serves the API and the built UI, so the session cookie and the live stream stay same-origin (no CORS).

**Render + Neon (free tiers):**
1. Create a Postgres database on Neon and copy its connection string.
2. Create a Render Web Service from this repo (`render.yaml` is included). Set `DATABASE_URL`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `APP_TODAY=2025-12-15`, `LLM_PROVIDERS=gemini,groq`. `JWT_SECRET` is generated.
3. First boot creates the schema and seeds the sample data automatically.

Render's free tier sleeps when idle. A free UptimeRobot monitor pinging https://<your-service>.onrender.com/api/v1/health every 5 minutes keeps the service awake during review. Open the URL once before sharing.

---

## Architecture and why

```
web/ (React + Vite + TypeScript)      server/ (Fastify + TypeScript)
  pages/author, pages/admin             src/modules/*.routes.ts   thin HTTP layer + zod validation
  live.ts (EventSource)                 src/domain/               pure business rules (royalty/payout facts)
  api.ts (typed client)                 src/ai/                   prompts, providers, gateway, triage, drafter
                                        src/realtime/hub.ts       SSE fan-out
                                        src/db/                   Postgres adapter (pg or PGlite) + schema
```

| Decision | Why |
|---|---|
| Fastify + TypeScript, zod at every boundary | Fast, schema-first, and the error handler turns any validation failure into a structured 400 instead of a generic 500. |
| Services take an explicit `Ctx` (db, llm, hub, clock) | No globals, so tests swap any piece (the API tests run on in-memory Postgres with the AI off). |
| **Domain facts live in code, not in the prompt** | `domain/facts.ts` computes pending royalty, threshold rollover, next payout date (quarter end + 45 days) and production stage. The model only writes words around numbers it is handed. This is the main defence against hallucinated figures. |
| Postgres via one adapter, embedded PGlite for dev | Reviewers can run it with zero setup, and production uses real Postgres through the same SQL. |
| Cookie session (httpOnly JWT) | Not readable by JS, works with `EventSource`. `Authorization: Bearer` is also accepted for Postman and scripts. |
| **Server-Sent Events** for real time | Updates only flow server to browser; SSE reconnects by itself, passes through proxies and carries the cookie. Events contain only `{type, ticketId}`, so the client re-fetches through the normal access-checked API and nothing sensitive can leak onto a stream. A `resync` fires on every reconnect so missed events are recovered. |
| Single-process, same-origin deploy | Fewest moving parts for a 5-day scope. |
| Effective value + AI value stored side by side | `tickets.category` / `priority` are what the queue uses; `ai_category` / `ai_priority` keep the model's suggestion and `*_overridden` records admin changes. The override rate is a built-in accuracy metric (shown on the queue page). |

### Data model (summary)
`authors`, `users` (role author/admin), `books`, `tickets`, `ticket_messages` (`is_internal` flags notes), `ticket_events` (audit trail), `ai_drafts` (cache), `ai_usage` (every LLM call: tokens, latency, errors). See `server/src/db/schema.ts`.

### Access control
- All `/api/v1` routes pass an authentication hook except login, logout, demo-accounts and health.
- `/tickets/*` is author-only and every query is scoped by the author id **from the signed token**, never from the request. Another author's ticket returns **404**, not 403, so ids cannot be probed.
- `/admin/*` is admin-only. `/books` is role-aware.
- Internal notes are excluded **in SQL** (`is_internal = FALSE`) on every author endpoint, and the same filter is enforced by a test.
- Login is rate limited, uses one generic error for wrong password and unknown email, and compares against a dummy hash so timing does not reveal which emails exist.

---

## AI integration

### Model choice
**Gemini primary, Groq as automatic fallback, rules as the last resort.**

| | Role | Why |
|---|---|---|
| Gemini `3.5-flash-lite` / `3.5-flash` | Primary triage & reply drafting | Fast, free tier with a generous request quota; thinking disabled (budget=0) so output tokens are not spent on reasoning. |
| Groq `openai/gpt-oss-20b` | Fallback triage | Ultra-low latency, follows JSON schema well. Small model is plenty for a 6-way label. |
| Groq `openai/gpt-oss-120b` | Fallback drafting | Rich tone and instruction-following for polished author-facing drafts. |

Both have free tiers, which fits this assignment, and the code is provider-agnostic (`ai/types.ts` `Provider` interface). The earlier-generation Llama models on Groq were retired in August 2026, which is exactly why model names are environment variables. Free tiers have strict rate limits and may use data for product improvement; the sample data is synthetic, but a production system should use a paid tier with a no-training agreement.

### Two jobs, two prompts (`ai/prompts.ts`)
1. **Triage** (every ticket, JSON out): category list with hints, a written priority rubric, four few-shot examples, temperature 0, 160-token cap. Output is parsed leniently (fenced JSON, fuzzy category names) and validated; anything invalid falls back to rules.
2. **Draft** (only when an admin opens a ticket): persona and BookLeaf tone rules from the brief (acknowledge first, be specific, own mistakes, 48-hour timeline, end with a next step), strict rules (use only knowledge base and facts, no invented dates, amounts, or ungrounded team names), then the KB slice, the facts block and the ticket.

Prompt-injection stance: ticket text is fenced in tags and declared untrusted data in the system prompt. The AI never sends anything; a human always reviews.

### Policy floors
After the model answers, deterministic rules from the knowledge base are applied on top (`applyPolicyFloors`). An ISBN mismatch is never below High (the KB says so), a never-paid royalty past its window is never below High, and an unavailable published book is never below High. Model judgement plus guaranteed policy.

### Cost awareness
- **Lazy drafting**: nothing is generated until an admin opens the ticket.
- **Cached** per ticket; regenerated only if the author replied since, or on request.
- **De-duplicated**: two admins opening one ticket share a single in-flight call.
- **Small prompts**: only the KB slice for the ticket's category (~150-250 tokens instead of the whole document), only the relevant book's facts, last 4 messages, internal notes never included, output capped.
- **Right-sized models**: small model for triage, larger only for drafts.
- **Daily call cap & Kill switch**: `LLM_DAILY_CAP` (default 500/day) tracks daily usage in `ai_usage` and trips gracefully to rule-based fallback if reached. `LLM_ENABLED=false` provides an instant operational kill switch.
- **Route rate limits**: 10 tickets/hour for authors (`POST /tickets`), 30 redrafts/hour for admins (`POST /admin/tickets/:id/draft`) prevent abuse.
- **Measured**: every call is logged in `ai_usage`; the queue page shows 24-hour calls, tokens, failures, and daily cap status.

### Error handling and graceful degradation
- Per provider: timeout, retry with exponential backoff and jitter on 429/5xx/network (honours `Retry-After`), no retry on 4xx.
- **Circuit breaker**: 3 consecutive failures park a provider for 60 s (10 min on 401/403), so a dead API does not slow every request.
- Concurrency cap keeps free-tier requests-per-minute in check.
- **Provider chain**: Gemini, then Groq.
- If the daily cap is hit, all providers fail, or no keys are set: tickets are still created instantly (AI runs asynchronously after the response), classified by **keyword rules**, and the admin gets a **template draft** built from the same facts and policy. The UI says plainly which one it is ("Template draft: AI providers are unavailable").
- Tickets whose triage was interrupted by a restart are picked up again on boot.

### API key security
Keys are read from environment variables only, sent in headers (never URLs) and never reach the frontend. `.env` is git-ignored.

---

## API reference

Base path `/api/v1`. JSON in, JSON out. Auth is the `bl_token` cookie or `Authorization: Bearer <jwt>`.

Errors always look like `{ "error": { "code": "VALIDATION_ERROR", "message": "…", "details": [{ "field": "subject", "message": "…" }] } }`.
Codes: `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `TICKET_CLOSED` 409, `RATE_LIMITED` 429, `INTERNAL` 500.

### Auth and shared
| Method and path | Who | Notes |
|---|---|---|
| `POST /auth/login` | public | `{email, password}`; sets the cookie. Rate limited. |
| `POST /auth/logout` | public | Clears the cookie. |
| `GET /auth/me` | any | Current user. |
| `GET /auth/demo-accounts` | public | Only returns data when `DEMO_MODE=true`. |
| `GET /books` | any | Author: own books. Admin: all, or `?authorId=`. Includes computed royalty status and production stage. |
| `GET /stream` | any | Server-Sent Events: `ticket.created`, `ticket.updated`, `message.created` (and `note.created` for admins only). |
| `GET /health` | public | Status, DB engine, configured AI providers. |

### Author
| Method and path | Notes |
|---|---|
| `POST /tickets` | `{bookId?, subject, description, attachments[]}`. Returns 201 immediately; AI triage runs afterwards. Attachment bytes are not uploaded (metadata only, per brief). |
| `GET /tickets` | The author's tickets, most recently updated first. Includes server-tracked `unread` status. |
| `GET /tickets/:id` | Ticket with visible messages only (never internal notes). 404 if not theirs. |
| `POST /tickets/:id/messages` | `{body}`. Reopens a Resolved ticket; 409 if Closed. |

### Admin
| Method and path | Notes |
|---|---|
| `GET /admin/tickets` | Filters: `status`, `category`, `priority` (comma lists), `assignee` (`me`/`unassigned`/id), `from`, `to` (dates), `q`, `sort` (`urgency`\|`oldest`\|`newest`), `page`, `pageSize`. Default sort: unresolved first, then priority, then oldest. Each row has `overdue` (per-priority SLA) and `awaitingReply`. |
| `GET /admin/stats` | Queue counts and AI health: providers, override rates, 24 h token use and failures. |
| `GET /admin/tickets/:id` | Full ticket, internal notes, audit events, and the facts the AI sees. |
| `PATCH /admin/tickets/:id` | Any of `status`, `category`, `priority`, `assignee` (`"me"`, `null`, or numeric admin ID). Overrides are recorded against the AI suggestion. Assigning an Open ticket moves it to In Progress. |
| `POST /admin/tickets/:id/notes` | `{body}`. Internal; never visible to the author. |
| `POST /admin/tickets/:id/reply` | `{body, usedDraft, status?}`. Appears in the author's thread live. |
| `GET /admin/tickets/:id/draft` | Cached or freshly generated draft with `source` (`llm` or `template`), provider and model. |
| `POST /admin/tickets/:id/draft` | Regenerate, optionally with `{instruction}` such as "shorter, offer a call". |
| `POST /admin/tickets/:id/reclassify` | Re-run triage (202). Admin overrides are preserved. |
| `GET /admin/admins` | Operations team members for ticket re-assignment. |

SLA thresholds for "overdue": Critical 24 h, High 48 h, Medium 5 days, Low 10 days.

---

## Sample-data edge cases

- **Never paid, pending above ₹1,000** (Ananya, Arjun, Diya): flagged overdue, owned in the draft, escalated.
- **Pending below ₹1,000** (Kavita, ₹850): explained as a rollover, explicitly not late.
- **Books in production** (`BK013`, `BK015`): null MRP, date and royalty fields render as a stage tracker; drafts reference the real stage and never invent dates.
- **Payout dates are computed from policy**, not hard-coded, because the data's last payouts end in Dec 2025. Use `APP_TODAY` to pin the demo date.
- Royalty arithmetic in the dataset (copies × per-copy = earned; earned − paid = pending) was checked and is consistent. The brief describes an 80/20 net-profit split while the data stores a flat per-copy royalty, so drafts explain the policy and offer a line-by-line breakdown rather than asserting a calculation they cannot verify.
- Empty states: no books, no tickets, no matches for filters, no reply yet.

---

## Tests

`npm test` runs 41 tests (Vitest): payout-date maths and royalty edge cases, the six sample queries from the brief against the rules classifier, lenient parsing of model output, provider failover / total-outage / circuit-breaker behaviour with mock providers, route rate limits, daily call cap and kill switch behavior, and API tests on an in-memory Postgres covering authentication, role isolation, 404-not-403, validation, the full ticket lifecycle, override tracking, internal-note secrecy, and ticket reopening.

**Automated Live Edge-Case Verification (`npm run check:drafts`)**:
A dedicated verification script checks live Gemini and Groq outputs across 6 canonical prompt scenarios (3 runs per provider) against grounded facts and the BookLeaf knowledge base:
```bash
npm run check:drafts
```
It programmatically asserts across all runs:
For each run it flags any rupee amount, number or date in the draft that is not in the injected facts, the ticket text or the knowledge-base numbers, and flags invented team names such as 'finance team' or 'accounts team'. It exits non-zero on any flag. A labelled evaluation set is the next step.

---

## Known limitations and what I would do next

- **Shared free-tier quota**: On high traffic or public demo days, free-tier provider limits can be exhausted. The portal mitigates this with `LLM_DAILY_CAP` (default 500/day), per-route rate limits, and seamless fallback to deterministic keyword triage and template drafts so author requests never fail.
- **Attachments** are UI plus metadata only. Next: signed-URL upload to object storage with virus scanning.
- **SSE hub is in-memory**, so one server process. To scale out: Postgres `LISTEN/NOTIFY` or Redis pub/sub behind the same interface.
- **Triage queue is in-process** with a boot-time sweep. For production: BullMQ or pg-boss with retries and dead-lettering.
- **Sessions are stateless JWTs** with no server-side revocation. Add a session table, refresh rotation and password reset / SSO for real accounts.
- **Schema is one idempotent file.** Move to versioned migrations.
- **Email notifications** to authors on replies, plus per-author unread state stored server-side (currently `localStorage`).
- **Evaluation**: build a labelled ticket set and track classification accuracy and draft edit-distance over time; the override rate is a first proxy.
- **Bank-detail status** is not in the dataset, so drafts ask the author to confirm it rather than claim it.
- **SLA, canned replies and bulk actions** for the ops team.
- Dashboards and analytics on `ai_usage` and ticket events.
