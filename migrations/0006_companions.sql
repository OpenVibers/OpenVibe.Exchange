-- phase: expand
-- Companions on OpenVibe.Exchange (Opus's design, 2026-11-06): character cards, the gallery and one-character
-- chats with a branching tree. Expand-only: nothing here changes an existing table.

CREATE TABLE IF NOT EXISTS exchange_characters (
    id                text COLLATE "C" PRIMARY KEY,        -- exc_ + 26 Crockford base32 characters (ULID)
    owner             text COLLATE "C" NOT NULL,            -- usr_…
    handle            text COLLATE "C" NOT NULL,            -- the creator's OpenVibe handle (the page's first path part)
    slug              text COLLATE "C" NOT NULL,            -- the character's own slug (the page's second path part)
    name              text NOT NULL,
    description       text NOT NULL DEFAULT '',
    personality       text NOT NULL DEFAULT '',
    scenario          text NOT NULL DEFAULT '',
    first_message     text NOT NULL DEFAULT '',
    example_dialogue  text NOT NULL DEFAULT '',
    avatar_url        text,
    tags              text COLLATE "C" NOT NULL DEFAULT '[]',   -- the tags, as a JSON array (the tag table is the queryable copy)
    rating            text COLLATE "C" NOT NULL DEFAULT 'everyone',
    age               integer,
    model             text,                                -- the model the card recommends ("works best on …")
    voice             text,
    audience          text COLLATE "C" NOT NULL DEFAULT 'private',  -- the sharing audience, kept in step with the share row
    allow_remix       boolean NOT NULL DEFAULT true,
    share_id          text,                                -- the openvibe-sdk/share resource id (the character id)
    remix_of          text,                                -- the character this one was remixed from
    original_author   text,                                -- the original creator's handle, credited on the copy
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT exchange_characters_owner CHECK (owner ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT exchange_characters_rating CHECK (rating IN ('everyone', 'adult')),
    CONSTRAINT exchange_characters_audience CHECK (audience IN ('private', 'unlisted', 'public')),
    CONSTRAINT exchange_characters_age CHECK (age IS NULL OR (age BETWEEN 0 AND 999)),
    CONSTRAINT exchange_characters_name CHECK (length(name) BETWEEN 1 AND 80)
);
CREATE UNIQUE INDEX IF NOT EXISTS exchange_characters_slug ON exchange_characters (handle, slug);
CREATE INDEX IF NOT EXISTS exchange_characters_gallery ON exchange_characters (audience, created_at DESC);
CREATE INDEX IF NOT EXISTS exchange_characters_owner ON exchange_characters (owner, updated_at DESC);
CREATE INDEX IF NOT EXISTS exchange_characters_remix ON exchange_characters (remix_of) WHERE remix_of IS NOT NULL;

CREATE TABLE IF NOT EXISTS exchange_character_tags (
    character_id text COLLATE "C" REFERENCES exchange_characters (id) ON DELETE SET NULL, -- the character may be deleted while somebody else's chat still points at it
    tag          text COLLATE "C" NOT NULL,
    PRIMARY KEY (character_id, tag)
);
CREATE INDEX IF NOT EXISTS exchange_character_tags_tag ON exchange_character_tags (tag);

CREATE TABLE IF NOT EXISTS exchange_character_views (
    id           bigserial PRIMARY KEY,
    character_id text COLLATE "C" NOT NULL REFERENCES exchange_characters (id) ON DELETE CASCADE,
    viewer       text COLLATE "C",
    viewed_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exchange_character_views_recent ON exchange_character_views (character_id, viewed_at DESC);

CREATE TABLE IF NOT EXISTS exchange_companion_chats (
    id           text COLLATE "C" PRIMARY KEY,             -- exc_ + 26 Crockford base32 characters (ULID)
    owner        text COLLATE "C" NOT NULL,
    character_id text COLLATE "C" NOT NULL REFERENCES exchange_characters (id) ON DELETE CASCADE,
    title        text NOT NULL DEFAULT 'New chat',
    model        text,                                    -- the model asked for (a slug), or null for the router's choice
    preset       text,                                    -- the preset asked for, when one is used
    temperature  double precision,
    context_size integer,                                 -- how much context the person wants the model to see
    persona      text,                                    -- the persona the person plays
    ended_at     timestamptz,                             -- set when the hard floor ended the chat
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT exchange_companion_chats_owner CHECK (owner ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT exchange_companion_chats_temperature CHECK (temperature IS NULL OR (temperature >= 0 AND temperature <= 2)),
    CONSTRAINT exchange_companion_chats_context CHECK (context_size IS NULL OR (context_size BETWEEN 512 AND 200000))
);
CREATE INDEX IF NOT EXISTS exchange_companion_chats_owner ON exchange_companion_chats (owner, updated_at DESC);

-- The chat's tree. Every message belongs to a turn group (turn_id); editing a message adds a variant to that
-- group and regenerating adds another answer to it, so the tree keeps every branch instead of overwriting one.
CREATE TABLE IF NOT EXISTS exchange_companion_messages (
    id        text COLLATE "C" PRIMARY KEY,                -- exm_ + 26 Crockford base32 characters (ULID)
    chat_id   text COLLATE "C" NOT NULL REFERENCES exchange_companion_chats (id) ON DELETE CASCADE,
    owner     text COLLATE "C" NOT NULL,                   -- denormalised for export and deletion
    role      text COLLATE "C" NOT NULL,                   -- user | assistant
    content   text,
    turn_id   text COLLATE "C" NOT NULL,                   -- the branch group this message belongs to
    variant   integer NOT NULL DEFAULT 0,                  -- which branch of the group this is
    parent_id text COLLATE "C",                            -- the user message an answer answers
    model     text,
    meta      text COLLATE "C" NOT NULL DEFAULT '{}',      -- the receipt, and what the model saw
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT exchange_companion_messages_role CHECK (role IN ('user', 'assistant')),
    CONSTRAINT exchange_companion_messages_variant CHECK (variant >= 0)
);
CREATE INDEX IF NOT EXISTS exchange_companion_messages_chat ON exchange_companion_messages (chat_id, turn_id, variant);
CREATE INDEX IF NOT EXISTS exchange_companion_messages_owner ON exchange_companion_messages (owner, created_at);
