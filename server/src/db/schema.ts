/**
 * Single-file schema, idempotent. For a bigger team I'd move to versioned migrations
 * (node-pg-migrate / Prisma Migrate); for this scope one file is easier to review.
 *
 * Design notes
 *  - tickets.category / priority hold the *effective* value. ai_category / ai_priority keep what the
 *    model suggested, and *_overridden says whether an admin changed it. That gives us override-rate
 *    metrics for free (a proxy for classification accuracy).
 *  - Internal notes live in ticket_messages with is_internal = TRUE. Author-facing queries always
 *    filter on is_internal = FALSE at the SQL level (not in the UI).
 *  - ai_drafts caches one draft per ticket; ai_usage records every LLM call for cost tracking.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS authors (
  author_id   TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  phone       TEXT,
  city        TEXT,
  joined_date DATE
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('author','admin')),
  author_id     TEXT REFERENCES authors(author_id),
  CHECK ((role = 'author' AND author_id IS NOT NULL) OR (role = 'admin' AND author_id IS NULL))
);

CREATE TABLE IF NOT EXISTS books (
  book_id                  TEXT PRIMARY KEY,
  author_id                TEXT NOT NULL REFERENCES authors(author_id),
  title                    TEXT NOT NULL,
  isbn                     TEXT,
  genre                    TEXT,
  publication_date         DATE,
  status                   TEXT NOT NULL,
  mrp                      INTEGER,
  author_royalty_per_copy  INTEGER,
  total_copies_sold        INTEGER NOT NULL DEFAULT 0,
  total_royalty_earned     INTEGER NOT NULL DEFAULT 0,
  royalty_paid             INTEGER NOT NULL DEFAULT 0,
  royalty_pending          INTEGER NOT NULL DEFAULT 0,
  last_royalty_payout_date DATE,
  print_partner            TEXT,
  available_on             JSONB NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_books_author ON books(author_id);

CREATE TABLE IF NOT EXISTS tickets (
  id                  SERIAL PRIMARY KEY,
  author_id           TEXT NOT NULL REFERENCES authors(author_id),
  book_id             TEXT REFERENCES books(book_id),
  subject             TEXT NOT NULL,
  description         TEXT NOT NULL,
  attachments         JSONB NOT NULL DEFAULT '[]',
  status              TEXT NOT NULL DEFAULT 'Open'
                        CHECK (status IN ('Open','In Progress','Resolved','Closed')),
  category            TEXT NOT NULL DEFAULT 'General Inquiry'
                        CHECK (category IN ('Royalty & Payments','ISBN & Metadata Issues','Printing & Quality',
                          'Distribution & Availability','Book Status & Production Updates','General Inquiry')),
  priority            TEXT NOT NULL DEFAULT 'Medium'
                        CHECK (priority IN ('Critical','High','Medium','Low')),
  ai_category         TEXT,
  ai_priority         TEXT,
  ai_reasoning        TEXT,
  ai_status           TEXT NOT NULL DEFAULT 'pending' CHECK (ai_status IN ('pending','llm','rules')),
  category_overridden BOOLEAN NOT NULL DEFAULT FALSE,
  priority_overridden BOOLEAN NOT NULL DEFAULT FALSE,
  assignee_id         INTEGER REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tickets_queue ON tickets(status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_tickets_author ON tickets(author_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id            SERIAL PRIMARY KEY,
  ticket_id     INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  sender_id     INTEGER NOT NULL REFERENCES users(id),
  sender_role   TEXT NOT NULL CHECK (sender_role IN ('author','admin')),
  body          TEXT NOT NULL,
  is_internal   BOOLEAN NOT NULL DEFAULT FALSE,
  ai_draft_used BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (NOT is_internal OR sender_role = 'admin')
);
CREATE INDEX IF NOT EXISTS idx_messages_ticket ON ticket_messages(ticket_id, id);

CREATE TABLE IF NOT EXISTS ticket_events (
  id         SERIAL PRIMARY KEY,
  ticket_id  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  actor_id   INTEGER REFERENCES users(id),
  type       TEXT NOT NULL,
  detail     JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_ticket ON ticket_events(ticket_id, id);

CREATE TABLE IF NOT EXISTS ai_drafts (
  ticket_id        INTEGER PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
  body             TEXT NOT NULL,
  source           TEXT NOT NULL CHECK (source IN ('llm','template')),
  provider         TEXT,
  model            TEXT,
  based_on_message INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_usage (
  id                SERIAL PRIMARY KEY,
  ticket_id         INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  kind              TEXT NOT NULL,
  provider          TEXT,
  model             TEXT,
  prompt_tokens     INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms        INTEGER NOT NULL DEFAULT 0,
  ok                BOOLEAN NOT NULL,
  error             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tracks when each user last read each ticket, so unread state persists across devices.
CREATE TABLE IF NOT EXISTS ticket_reads (
  ticket_id  INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, user_id)
);
`;
