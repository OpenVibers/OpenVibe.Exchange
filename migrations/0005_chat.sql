-- phase: expand
-- The Exchange remake (2026-11-06): a person's conversations with the network's models, and their 18+
-- confirmation for the uncensored tier. v1's tables stay as they are: read-only, never written again.

CREATE TABLE IF NOT EXISTS exchange_chats (
    id            text COLLATE "C" PRIMARY KEY,              -- exc_ + 26 Crockford base32 characters (ULID)
    owner         text COLLATE "C" NOT NULL,                  -- usr_…
    title         text NOT NULL DEFAULT 'New chat',
    models        text COLLATE "C" NOT NULL DEFAULT '[]',     -- the model slugs this chat compares (JSON array, 1-3)
    system_prompt text,
    temperature   double precision,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT exchange_chats_owner CHECK (owner ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT exchange_chats_title CHECK (length(title) BETWEEN 1 AND 120),
    CONSTRAINT exchange_chats_temperature CHECK (temperature IS NULL OR (temperature >= 0 AND temperature <= 2))
);
CREATE INDEX IF NOT EXISTS exchange_chats_owner ON exchange_chats (owner, updated_at DESC);

CREATE TABLE IF NOT EXISTS exchange_chat_messages (
    id         text COLLATE "C" PRIMARY KEY,                 -- exm_ + 26 Crockford base32 characters (ULID)
    chat_id    text COLLATE "C" NOT NULL REFERENCES exchange_chats (id) ON DELETE CASCADE,
    owner      text COLLATE "C" NOT NULL,                    -- denormalised for export and deletion
    role       text COLLATE "C" NOT NULL,                    -- user | assistant
    model      text COLLATE "C",                             -- the slug asked for (an assistant turn)
    content    text,
    error      text,                                         -- why a model's turn did not answer
    meta       text COLLATE "C" NOT NULL DEFAULT '{}',       -- run id, provider, cost, answered model
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT exchange_chat_messages_role CHECK (role IN ('user', 'assistant'))
);
CREATE INDEX IF NOT EXISTS exchange_chat_messages_chat ON exchange_chat_messages (chat_id, created_at);
CREATE INDEX IF NOT EXISTS exchange_chat_messages_owner ON exchange_chat_messages (owner, created_at);

CREATE TABLE IF NOT EXISTS exchange_adult_confirmations (
    subject      text COLLATE "C" PRIMARY KEY,               -- usr_…
    version      text COLLATE "C" NOT NULL,                  -- the floor's version the person confirmed
    confirmed_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT exchange_adult_confirmations_subject CHECK (subject ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$')
);
