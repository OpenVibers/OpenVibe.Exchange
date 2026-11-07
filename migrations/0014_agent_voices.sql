-- phase: expand
-- An agent's voice published here (actor.voice@1): the document itself, the author, and the lifecycle a listing
-- has — listed, hidden by staff, closed by its author. Exchange v1's listings table is retired and read-only, so
-- the voice has its own table and its own event log, with the same shape: every status change is an event row.
CREATE TABLE IF NOT EXISTS exchange_agent_voices (
    id text COLLATE "C" PRIMARY KEY,
    slug text COLLATE "C" NOT NULL UNIQUE,
    owner text COLLATE "C" NOT NULL,
    name text COLLATE "C" NOT NULL,
    bio text,
    level text COLLATE "C" NOT NULL DEFAULT 'ask',
    rules jsonb NOT NULL DEFAULT '[]'::jsonb,
    voice jsonb NOT NULL,
    status text COLLATE "C" NOT NULL DEFAULT 'listed',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT exchange_agent_voices_status CHECK (status IN ('listed', 'hidden', 'closed'))
);
CREATE INDEX IF NOT EXISTS exchange_agent_voices_status_idx ON exchange_agent_voices (status, created_at DESC);
CREATE TABLE IF NOT EXISTS exchange_agent_voice_events (
    id text COLLATE "C" PRIMARY KEY,
    voice_id text COLLATE "C" NOT NULL REFERENCES exchange_agent_voices(id) ON DELETE CASCADE,
    from_status text COLLATE "C",
    to_status text COLLATE "C" NOT NULL,
    reason text,
    changed_by text COLLATE "C" NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
