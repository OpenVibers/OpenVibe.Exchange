-- phase: expand
-- openvibe.compare (plan 297/300/301): a reader's remark on a comparison becomes a pending benchmark case for
-- review. The remark is plain text and public metadata only: the person is stored as their Network subject when
-- they are signed in, and never as an address or a user agent. A case is reviewed by the owner; nothing here is
-- a credential and nothing is ever written to OpenVibe.Bench by this migration.

CREATE TABLE IF NOT EXISTS exchange_compare_remarks (
    id             text COLLATE "C" PRIMARY KEY,        -- excr_ + 26 Crockford base32 characters (ULID)
    kind_id        text COLLATE "C" NOT NULL DEFAULT 'ai.models',
    models         jsonb NOT NULL DEFAULT '[]'::jsonb,  -- the model slugs the remark is about
    comparison     text,                                -- the pair/comparison key, when the remark is on one
    field          text,                                -- price | speed | quality | privacy | other
    remark         text NOT NULL,
    proposed_prompt text,                               -- the benchmark prompt the reviewer would run
    source_url     text,
    status         text COLLATE "C" NOT NULL DEFAULT 'pending',
    subject        text,                                -- the signed-in person's usr_…, or null
    reviewer_note  text,
    reviewed_by    text,
    reviewed_at    timestamptz,
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT exchange_compare_remarks_status CHECK (status IN ('pending', 'accepted', 'rejected')),
    CONSTRAINT exchange_compare_remarks_field CHECK (field IS NULL OR field IN ('price', 'speed', 'quality', 'privacy', 'context', 'other')),
    CONSTRAINT exchange_compare_remarks_remark CHECK (length(remark) BETWEEN 10 AND 2000)
);
CREATE INDEX IF NOT EXISTS exchange_compare_remarks_pending ON exchange_compare_remarks (status, created_at);
CREATE INDEX IF NOT EXISTS exchange_compare_remarks_models ON exchange_compare_remarks USING gin (models);
