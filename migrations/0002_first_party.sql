-- phase: expand
-- OpenVibe.Exchange: first-party listings of the free things the network makes (Design themes and token files, the
-- Live OBS scenes and alerts, public Games worlds). They are listed by the network, not by a person: owner is NULL,
-- official is true, and a source/source_id pair makes the periodic refresh idempotent. home_url is where the thing
-- really lives, so a listing is never a dead end.
--
-- The official flag may only be set on a network-owned row. A person's row is never official, which is what stops a
-- seeded listing from wearing a maker's name.

ALTER TABLE exchange_listings ADD COLUMN home_url text;
ALTER TABLE exchange_listings ADD COLUMN official boolean NOT NULL DEFAULT false;
ALTER TABLE exchange_listings ADD COLUMN source text COLLATE "C";
ALTER TABLE exchange_listings ADD COLUMN source_id text COLLATE "C";

ALTER TABLE exchange_listings ADD CONSTRAINT exchange_listings_home_url
    CHECK (home_url IS NULL OR home_url ~ '^https://');
ALTER TABLE exchange_listings ADD CONSTRAINT exchange_listings_official
    CHECK (NOT official OR owner IS NULL);

CREATE UNIQUE INDEX exchange_listings_source_key
    ON exchange_listings (source, source_id)
    WHERE source IS NOT NULL AND source_id IS NOT NULL;
CREATE INDEX exchange_listings_by_source ON exchange_listings (source, source_id);
