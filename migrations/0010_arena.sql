-- phase: expand
-- The Arena (2026-11-06): one prompt, two models answering blind side by side, one vote, then both names and
-- their receipts. Each vote is also a Bench human_pairwise judgement (server/bench.js); these rows keep what the
-- person saw and which vote was theirs, so a refresh never asks the models again and a round is never counted twice.
-- Also the daily catalogue snapshot behind the model changelog on /status.

CREATE TABLE IF NOT EXISTS exchange_arena_rounds (
    id             text COLLATE "C" PRIMARY KEY,              -- exa_ + 26 Crockford base32 characters (ULID)
    owner          text COLLATE "C" NOT NULL,                 -- usr_…
    prompt         text NOT NULL,
    category       text COLLATE "C" NOT NULL,                 -- code | writing | chat | reasoning | translation | analysis
    models         text COLLATE "C" NOT NULL DEFAULT '[]',    -- JSON: the two answers with their receipts
    bench_round_id text COLLATE "C",                          -- brd_… in OpenVibe.Bench
    bench_left     text COLLATE "C",                          -- bte_… the left answer's Bench entry
    bench_right    text COLLATE "C",                          -- bte_… the right answer's Bench entry
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT exchange_arena_rounds_owner CHECK (owner ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT exchange_arena_rounds_prompt CHECK (length(prompt) BETWEEN 1 AND 8000),
    CONSTRAINT exchange_arena_rounds_category CHECK (category ~ '^[a-z0-9-]{1,40}$')
);
CREATE INDEX IF NOT EXISTS exchange_arena_rounds_owner ON exchange_arena_rounds (owner, created_at DESC);

CREATE TABLE IF NOT EXISTS exchange_arena_votes (
    round_id          text COLLATE "C" NOT NULL REFERENCES exchange_arena_rounds (id) ON DELETE CASCADE,
    owner             text COLLATE "C" NOT NULL,              -- usr_… the voter
    outcome           text COLLATE "C" NOT NULL,              -- left | right | tie | both_bad
    bench_judgement_id text COLLATE "C",                      -- bju_… in OpenVibe.Bench
    created_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (round_id, owner),
    CONSTRAINT exchange_arena_votes_owner CHECK (owner ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT exchange_arena_votes_outcome CHECK (outcome IN ('left', 'right', 'tie', 'both_bad'))
);
CREATE INDEX IF NOT EXISTS exchange_arena_votes_owner ON exchange_arena_votes (owner, created_at DESC);

-- One row per model per UTC day: what it cost and where it was served, so /status can say new, gone or repriced
-- without keeping a second catalogue. Rows are only ever added.
CREATE TABLE IF NOT EXISTS exchange_model_snapshots (
    day        date NOT NULL,
    slug       text COLLATE "C" NOT NULL,                    -- deepseek/deepseek-chat
    name       text COLLATE "C" NOT NULL,
    family     text COLLATE "C",
    price_in   double precision,
    price_out  double precision,
    context    integer,
    provider   text COLLATE "C",
    community  boolean NOT NULL DEFAULT false,
    seen_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (day, slug)
);
CREATE INDEX IF NOT EXISTS exchange_model_snapshots_slug ON exchange_model_snapshots (slug, day DESC);
