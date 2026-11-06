-- phase: expand
-- Memory notes and lorebooks (Opus's design, 2026-11-06, stages 3 and 4). Expand-only: nothing here
-- changes an existing table.
--
-- The note TEXT is not here: it lives in the person's OpenVibe memory, the M2 store in OpenVibe.AI
-- (server/memory/index.js), under the scope project:companions-<character id>. This table is the index:
-- one row per note, saying which character the note belongs to, what kind it is, whether the person
-- pinned it, who wrote it, and which M2 item holds the text. The pin has no home in M2 (an item has a
-- kind, a status and a source, but no pin), so the pin is ours.

CREATE TABLE IF NOT EXISTS exchange_companion_notes (
    id            text COLLATE "C" PRIMARY KEY,        -- exn_ + 26 Crockford base32 characters (ULID)
    owner         text COLLATE "C" NOT NULL,            -- usr_…
    character_id  text COLLATE "C" NOT NULL,            -- exc_…: the character the notes are about
    m2_id         text COLLATE "C" NOT NULL,            -- mem_…: the M2 item that holds the note's text
    kind          text COLLATE "C" NOT NULL,            -- fact | preference | event
    pinned        boolean NOT NULL DEFAULT false,       -- the person pinned it: it is read first
    sealed        boolean NOT NULL DEFAULT false,       -- sealed with the person's Locker keys: OpenVibe cannot read it
    origin        text COLLATE "C" NOT NULL,            -- model | person
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT exchange_companion_notes_owner CHECK (owner ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT exchange_companion_notes_kind CHECK (kind IN ('fact', 'preference', 'event')),
    CONSTRAINT exchange_companion_notes_origin CHECK (origin IN ('model', 'person'))
);
CREATE UNIQUE INDEX IF NOT EXISTS exchange_companion_notes_owner_m2 ON exchange_companion_notes (owner, m2_id);
CREATE INDEX IF NOT EXISTS exchange_companion_notes_character ON exchange_companion_notes (owner, character_id);

-- A lorebook: a set of entries the person keeps. It hangs off a character, a chat, or the person
-- themselves (their world).
CREATE TABLE IF NOT EXISTS exchange_lorebooks (
    id            text COLLATE "C" PRIMARY KEY,        -- exb_ + 26 Crockford base32 characters (ULID)
    owner         text COLLATE "C" NOT NULL,            -- usr_…
    name          text NOT NULL DEFAULT '',
    scope         text COLLATE "C" NOT NULL,            -- character | chat | person
    character_id  text COLLATE "C",                     -- exc_… when the scope is 'character'
    chat_id       text COLLATE "C",                     -- exc_… when the scope is 'chat'
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT exchange_lorebooks_owner CHECK (owner ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT exchange_lorebooks_scope CHECK (scope IN ('character', 'chat', 'person'))
);
CREATE INDEX IF NOT EXISTS exchange_lorebooks_owner ON exchange_lorebooks (owner, scope);

-- One entry: the keys that call it in, and what it says. The keys are a JSON array; the priority is
-- the order the entries join the context in (the highest first).
CREATE TABLE IF NOT EXISTS exchange_lorebook_entries (
    id            text COLLATE "C" PRIMARY KEY,        -- exe_ + 26 Crockford base32 characters (ULID)
    lorebook_id   text COLLATE "C" NOT NULL,            -- exb_…
    owner         text COLLATE "C" NOT NULL,            -- usr_…
    name          text NOT NULL DEFAULT '',             -- what the entry is called, for the panel
    keys          text COLLATE "C" NOT NULL DEFAULT '[]',   -- the keys, as a JSON array
    content       text NOT NULL DEFAULT '',
    priority      integer NOT NULL DEFAULT 0,
    constant      boolean NOT NULL DEFAULT false,       -- always in the context (the World Info word for it)
    enabled       boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT exchange_lorebook_entries_owner CHECK (owner ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
);
CREATE INDEX IF NOT EXISTS exchange_lorebook_entries_lorebook ON exchange_lorebook_entries (lorebook_id, priority DESC);

-- The Locker, per person and character: when a character is locked, its notes and the chats of it are
-- sealed with the person's own Locker keys, and OpenVibe cannot read them at rest. The fingerprint says which
-- keys sealed it, so a key change is visible.
CREATE TABLE IF NOT EXISTS exchange_companion_locks (
    owner        text COLLATE "C" NOT NULL,            -- usr_…
    character_id text COLLATE "C" NOT NULL,            -- exc_…
    fingerprint  text,                                -- the eight words of the key that sealed it
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner, character_id),
    CONSTRAINT exchange_companion_locks_owner CHECK (owner ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
);

-- The chat's own settings for the locked mode: when a chat is locked, its notes and its history are
-- sealed with the person's Locker keys, and OpenVibe cannot read them at rest. The sealed bytes live in the
-- message column (meta says so), not in a column of their own.
ALTER TABLE exchange_companion_chats ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;
ALTER TABLE exchange_companion_chats ADD COLUMN IF NOT EXISTS locker_fingerprint text;
