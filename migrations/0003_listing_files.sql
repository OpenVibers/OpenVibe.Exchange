-- phase: expand
-- A theme is one listing with its token exports as downloads, not one listing per export. files is an array of
-- { format, label, url }, public metadata: the format id, the human label and the https file itself. Existing rows
-- get the empty array, and a user's listing may carry its own downloads through the same field.

ALTER TABLE exchange_listings ADD COLUMN files jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE exchange_listings ADD CONSTRAINT exchange_listings_files
    CHECK (jsonb_typeof(files) = 'array');
