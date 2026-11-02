-- phase: expand
-- A theme listing carries the preview palette it was imported with: at most six plain #rrggbb colours, drawn as
-- small swatches on the card and the listing page. It is public metadata, written only by the first-party refresh
-- (a person's listing has no palette); the store and the page accept a colour only when it matches ^#[0-9a-f]{6}$.

ALTER TABLE exchange_listings ADD COLUMN palette jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE exchange_listings ADD CONSTRAINT exchange_listings_palette
    CHECK (jsonb_typeof(palette) = 'array');
