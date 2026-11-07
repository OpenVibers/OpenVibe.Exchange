-- phase: expand
-- A person's default audience per kind (design 2026-11-06, rule 1: a default per product, with a per-item
-- override). The product page reads "New chats: Only me ▾"; the Share sheet still changes one item. Without a row
-- the default is Only me. Expand-only.

CREATE TABLE IF NOT EXISTS exchange_share_defaults (
    owner      text COLLATE "C" NOT NULL,
    kind       text COLLATE "C" NOT NULL CHECK (kind IN ('character', 'chat', 'arena-round')),
    audience   text COLLATE "C" NOT NULL CHECK (audience IN ('public', 'link', 'people', 'private')),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (owner, kind)
);
