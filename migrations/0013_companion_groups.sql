-- phase: expand
-- Group chats and the voices (Opus's design, 2026-11-06, steps 5 and 6). Expand-only: nothing here changes an
-- existing table.
--
-- A group chat is two to five characters and the person. The characters take turns by a simple rule: the one
-- the person named, round-robin, or "let them talk" for a number of turns. Every character keeps its own
-- memory (the notes of its own M2 scope, project:companions-<character id>) and its own voice.
--
-- The voice clips are the sound of an answer, read aloud in the character's own voice by OpenVibe.Chat. The
-- bytes are kept here so the browser can play them from this site's own origin (a strict CSP needs no
-- exception for the media).

CREATE TABLE IF NOT EXISTS exchange_group_chats (
    id            text COLLATE "C" PRIMARY KEY,        -- exc_ + 26 Crockford base32 characters (ULID)
    owner         text COLLATE "C" NOT NULL,            -- usr_...
    title         text NOT NULL DEFAULT 'Group chat',
    mode          text COLLATE "C" NOT NULL DEFAULT 'round_robin',   -- named | round_robin | free
    turns         integer NOT NULL DEFAULT 1,           -- "let them talk": how many times each character answers
    model         text,
    preset        text,
    temperature   real,
    context_size  integer,
    persona       text,
    speak         boolean NOT NULL DEFAULT true,        -- read the answers aloud
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    ended_at      timestamptz,
    CONSTRAINT exchange_group_chats_owner CHECK (owner ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT exchange_group_chats_mode CHECK (mode IN ('named', 'round_robin', 'free'))
);

-- The characters of a group, in the order they joined. Two to five of them.
CREATE TABLE IF NOT EXISTS exchange_group_members (
    group_id      text COLLATE "C" NOT NULL REFERENCES exchange_group_chats (id) ON DELETE CASCADE,
    character_id  text COLLATE "C" NOT NULL,            -- exc_...
    position      integer NOT NULL DEFAULT 0,
    created_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, character_id)
);
CREATE INDEX IF NOT EXISTS exchange_group_members_group ON exchange_group_members (group_id, position);

-- One message of a group chat: the person's own words, or a character's answer.
CREATE TABLE IF NOT EXISTS exchange_group_messages (
    id            text COLLATE "C" PRIMARY KEY,        -- exg_ + 26 Crockford base32 characters (ULID)
    group_id      text COLLATE "C" NOT NULL REFERENCES exchange_group_chats (id) ON DELETE CASCADE,
    owner         text COLLATE "C" NOT NULL,
    role          text COLLATE "C" NOT NULL,            -- user | assistant
    character_id  text,                                -- exc_... when the role is 'assistant'
    content       text,
    turn_id       text,                                -- the person's message the answers belong to
    seq           integer NOT NULL DEFAULT 0,          -- the order inside the turn
    model         text,
    meta          text NOT NULL DEFAULT '{}',          -- the JSON meta: the run, the receipt, the voice clip
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT exchange_group_messages_owner CHECK (owner ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT exchange_group_messages_role CHECK (role IN ('user', 'assistant'))
);
CREATE INDEX IF NOT EXISTS exchange_group_messages_group ON exchange_group_messages (group_id, seq, id);

-- The sound of an answer, read aloud in the character's own voice. The bytes are base64 so they travel
-- through every database this service runs on (PostgreSQL and the embedded one) the same way.
CREATE TABLE IF NOT EXISTS exchange_voice_clips (
    id            text COLLATE "C" PRIMARY KEY,        -- exv_ + 26 Crockford base32 characters (ULID)
    owner         text COLLATE "C" NOT NULL,
    message_id    text,                                -- the message the clip is the voice of
    character_id  text,                                -- exc_...: the character it was read in
    voice         text,                                -- the voice id the card names
    mime_type     text NOT NULL DEFAULT 'audio/mpeg',
    audio         text NOT NULL,                      -- the base64 audio
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT exchange_voice_clips_owner CHECK (owner ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
);
CREATE INDEX IF NOT EXISTS exchange_voice_clips_message ON exchange_voice_clips (message_id);

-- The one-on-one chats can be read aloud too, and the person can say no.
ALTER TABLE exchange_companion_chats ADD COLUMN IF NOT EXISTS speak boolean NOT NULL DEFAULT true;
