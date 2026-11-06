-- phase: expand
-- Private AI (the plan of 2026-11-06, "Product lines and features", item 2): a strict privacy switch on a chat,
-- and a chat whose history is sealed in the person's Locker.
--
-- strict_privacy: the chat's requests name the private preset, so only an offer that keeps nothing and trains on
-- nothing may answer. The router refuses rather than falling back to another offer.
--
-- sealed: the conversation never reaches this database in plain text. The browser seals it with the person's
-- Locker (openvibe-sdk/locker, people-locked to the person) and Exchange keeps the envelope in
-- exchange_chat_seals. The title in exchange_chats is the neutral "Sealed chat": the real title is inside the
-- envelope, and only the person's browser can read it.

ALTER TABLE exchange_chats ADD COLUMN IF NOT EXISTS strict_privacy boolean NOT NULL DEFAULT false;
ALTER TABLE exchange_chats ADD COLUMN IF NOT EXISTS sealed boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS exchange_chat_seals (
    chat_id    text COLLATE "C" PRIMARY KEY REFERENCES exchange_chats (id) ON DELETE CASCADE,
    owner      text COLLATE "C" NOT NULL,                    -- denormalised for export and deletion
    envelope   text NOT NULL,                                -- base64 of a locker.envelope.v1 (people lock)
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT exchange_chat_seals_owner CHECK (owner ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
    -- 512 KiB of ciphertext: far more than a conversation needs, and never a place to store something else.
    CONSTRAINT exchange_chat_seals_size CHECK (length(envelope) <= 700000)
);
CREATE INDEX IF NOT EXISTS exchange_chat_seals_owner ON exchange_chat_seals (owner, updated_at DESC);
