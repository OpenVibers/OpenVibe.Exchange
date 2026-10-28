-- phase: expand
-- OpenVibe.Exchange v1: listings with a permission passport, a sandbox, install/revoke, and free/swap only. There is
-- no money here: no price, no Billing id, and a passport may not declare a spend. A listing's manifest is public
-- metadata (name, entry, runtime) and never a credential. An install keeps the exact passport it was installed
-- with, so a later listing edit cannot widen an old install.

CREATE TABLE exchange_listings (
    id            text COLLATE "C" PRIMARY KEY,               -- exl_ + 26 Crockford base32 characters (ULID)
    slug          text COLLATE "C" NOT NULL UNIQUE,           -- /listings/<slug>
    title         text NOT NULL,
    kind          text COLLATE "C" NOT NULL,                  -- agent | mcp_tool | template | theme | game_asset | service
    mode          text COLLATE "C" NOT NULL,                  -- free | swap (v1: no money)
    summary       text NOT NULL,
    description   text,
    wants         text,                                       -- what a swap would like in return; NULL for free
    license       text COLLATE "C" NOT NULL,                  -- SPDX identifier
    license_url   text,
    version       text COLLATE "C" NOT NULL,                  -- semver, the version the tests and passport belong to
    creator       text NOT NULL,                              -- the maker's public display name, never their subject id
    owner         text COLLATE "C",                           -- usr_…; NULL after an account deletion anonymises it
    status        text COLLATE "C" NOT NULL DEFAULT 'draft',  -- draft | listed | hidden | closed
    manifest      jsonb NOT NULL,                             -- { name, entry, runtime } only; never a secret
    passport      jsonb NOT NULL,                             -- { reads, writes, spends, contacts }
    revision      bigint NOT NULL DEFAULT 1,                  -- +1 on every change; the Search revision
    listed_at     timestamptz,
    closed_at     timestamptz,
    closed_reason text COLLATE "C",                           -- given | swapped | withdrawn
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT exchange_listings_id CHECK (id ~ '^exl_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT exchange_listings_slug CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND length(slug) <= 80),
    CONSTRAINT exchange_listings_title CHECK (length(title) BETWEEN 3 AND 120),
    CONSTRAINT exchange_listings_kind CHECK (kind IN ('agent', 'mcp_tool', 'template', 'theme', 'game_asset', 'service')),
    CONSTRAINT exchange_listings_mode CHECK (mode IN ('free', 'swap')),
    CONSTRAINT exchange_listings_summary CHECK (length(summary) BETWEEN 3 AND 600),
    CONSTRAINT exchange_listings_description CHECK (description IS NULL OR length(description) <= 4000),
    CONSTRAINT exchange_listings_wants CHECK (
        (mode = 'free' AND wants IS NULL) OR (mode = 'swap' AND length(wants) BETWEEN 3 AND 300)
    ),
    CONSTRAINT exchange_listings_license CHECK (license ~ '^[A-Za-z0-9][A-Za-z0-9.+-]{1,63}$'),
    CONSTRAINT exchange_listings_license_url CHECK (license_url IS NULL OR license_url ~ '^https://'),
    CONSTRAINT exchange_listings_version CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
    CONSTRAINT exchange_listings_creator CHECK (length(creator) BETWEEN 1 AND 80),
    CONSTRAINT exchange_listings_owner CHECK (owner IS NULL OR owner ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT exchange_listings_status CHECK (status IN ('draft', 'listed', 'hidden', 'closed')),
    CONSTRAINT exchange_listings_closed_reason CHECK (closed_reason IS NULL OR closed_reason IN ('given', 'swapped', 'withdrawn')),
    CONSTRAINT exchange_listings_listed_at CHECK (status <> 'listed' OR listed_at IS NOT NULL),
    CONSTRAINT exchange_listings_manifest CHECK (
        jsonb_typeof(manifest) = 'object'
        AND jsonb_typeof(manifest->'name') = 'string'
        AND jsonb_typeof(manifest->'entry') = 'string'
    ),
    CONSTRAINT exchange_listings_passport CHECK (
        jsonb_typeof(passport) = 'object'
        AND jsonb_typeof(passport->'reads') = 'array'
        AND jsonb_typeof(passport->'writes') = 'array'
        AND jsonb_typeof(passport->'contacts') = 'array'
        AND passport->'spends' = '[]'::jsonb
    ),
    CONSTRAINT exchange_listings_revision CHECK (revision > 0)
);
CREATE INDEX exchange_listings_public ON exchange_listings (status, listed_at DESC, id DESC);
CREATE INDEX exchange_listings_by_kind ON exchange_listings (status, kind, listed_at DESC);
CREATE INDEX exchange_listings_by_mode ON exchange_listings (status, mode, listed_at DESC);
CREATE INDEX exchange_listings_by_owner ON exchange_listings (owner, created_at DESC);

-- The conformance tests run when a listing is submitted, one row per version. A listing is not public until all
-- of them pass for the version it names. (A Run sandbox executes the listing's own tests in v2; v1 checks the
-- manifest, passport, licence and the no-money rule.)
CREATE TABLE exchange_listing_tests (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    listing_id text COLLATE "C" NOT NULL REFERENCES exchange_listings (id) ON DELETE CASCADE,
    version    text COLLATE "C" NOT NULL,
    name       text COLLATE "C" NOT NULL,                     -- manifest | passport | licence | no_money
    status     text COLLATE "C" NOT NULL,                     -- passed | failed
    detail     text,
    ran_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT exchange_listing_tests_status CHECK (status IN ('passed', 'failed')),
    CONSTRAINT exchange_listing_tests_name CHECK (name IN ('manifest', 'passport', 'licence', 'no_money')),
    CONSTRAINT exchange_listing_tests_unique UNIQUE (listing_id, version, name)
);
CREATE INDEX exchange_listing_tests_by_listing ON exchange_listing_tests (listing_id, version, ran_at DESC);

-- A sandbox trial is a manifest dry run: the passport is checked and the result recorded, but no listing code is
-- executed (Run has no sandbox today). A passed trial expires; an install needs one for the same version.
CREATE TABLE exchange_sandbox_trials (
    id         text COLLATE "C" PRIMARY KEY,                  -- exs_ + ULID
    listing_id text COLLATE "C" NOT NULL REFERENCES exchange_listings (id) ON DELETE CASCADE,
    subject    text COLLATE "C" NOT NULL,                     -- usr_…
    version    text COLLATE "C" NOT NULL,
    status     text COLLATE "C" NOT NULL,                     -- passed | failed
    passport   jsonb NOT NULL,
    checks     jsonb NOT NULL,                                -- array of { name, status, detail }
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    CONSTRAINT exchange_sandbox_trials_id CHECK (id ~ '^exs_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT exchange_sandbox_trials_subject CHECK (subject ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT exchange_sandbox_trials_status CHECK (status IN ('passed', 'failed')),
    CONSTRAINT exchange_sandbox_trials_window CHECK (expires_at > created_at)
);
CREATE INDEX exchange_sandbox_trials_by_subject ON exchange_sandbox_trials (subject, created_at DESC);
CREATE INDEX exchange_sandbox_trials_for_install ON exchange_sandbox_trials (listing_id, subject, version, status, expires_at);

-- One active installation per person and listing. The passport column is the snapshot the install was made with.
-- v1 has no Network grant to create; this record is the entitlement, and revoke removes it everywhere in Exchange.
CREATE TABLE exchange_installs (
    id           text COLLATE "C" PRIMARY KEY,                -- exi_ + ULID
    listing_id   text COLLATE "C" NOT NULL REFERENCES exchange_listings (id) ON DELETE CASCADE,
    subject      text COLLATE "C" NOT NULL,                   -- usr_…
    version      text COLLATE "C" NOT NULL,
    passport     jsonb NOT NULL,
    status       text COLLATE "C" NOT NULL DEFAULT 'active',  -- active | revoked
    installed_at timestamptz NOT NULL DEFAULT now(),
    revoked_at   timestamptz,
    revision     bigint NOT NULL DEFAULT 1,
    CONSTRAINT exchange_installs_id CHECK (id ~ '^exi_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT exchange_installs_subject CHECK (subject ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT exchange_installs_status CHECK (status IN ('active', 'revoked')),
    CONSTRAINT exchange_installs_revoked CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
    CONSTRAINT exchange_installs_revision CHECK (revision > 0)
);
CREATE UNIQUE INDEX exchange_installs_active ON exchange_installs (listing_id, subject) WHERE status = 'active';
CREATE INDEX exchange_installs_by_subject ON exchange_installs (subject, installed_at DESC);

-- A free claim or a swap offer. kind follows the listing's mode; a person has at most one open offer per listing.
CREATE TABLE exchange_offers (
    id           text COLLATE "C" PRIMARY KEY,                -- exo_ + ULID
    listing_id   text COLLATE "C" NOT NULL REFERENCES exchange_listings (id) ON DELETE CASCADE,
    from_subject text COLLATE "C" NOT NULL,                   -- usr_…
    from_name    text NOT NULL,
    kind         text COLLATE "C" NOT NULL,                   -- claim | swap
    body         text NOT NULL,
    give         text,                                       -- what a swap offers in return
    status       text COLLATE "C" NOT NULL DEFAULT 'open',    -- open | accepted | declined | withdrawn
    created_at   timestamptz NOT NULL DEFAULT now(),
    decided_at   timestamptz,
    CONSTRAINT exchange_offers_id CHECK (id ~ '^exo_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT exchange_offers_subject CHECK (from_subject ~ '^usr_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT exchange_offers_name CHECK (length(from_name) BETWEEN 1 AND 80),
    CONSTRAINT exchange_offers_kind CHECK (kind IN ('claim', 'swap')),
    CONSTRAINT exchange_offers_body CHECK (length(body) BETWEEN 3 AND 1000),
    CONSTRAINT exchange_offers_give CHECK (give IS NULL OR length(give) BETWEEN 3 AND 1000),
    CONSTRAINT exchange_offers_status CHECK (status IN ('open', 'accepted', 'declined', 'withdrawn'))
);
CREATE UNIQUE INDEX exchange_offers_one_open ON exchange_offers (listing_id, from_subject) WHERE status = 'open';
CREATE INDEX exchange_offers_by_listing ON exchange_offers (listing_id, status, created_at);
CREATE INDEX exchange_offers_by_sender ON exchange_offers (from_subject, created_at DESC);

-- Every status change a listing makes (draft, listed, hidden, closed), for staff and the owner's audit.
CREATE TABLE exchange_listing_events (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    listing_id  text COLLATE "C" NOT NULL REFERENCES exchange_listings (id) ON DELETE CASCADE,
    from_status text COLLATE "C",
    to_status   text COLLATE "C" NOT NULL,
    reason      text,
    changed_by  text COLLATE "C",                             -- usr_…, account-deletion or service:exchange
    changed_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT exchange_listing_events_from CHECK (from_status IS NULL OR from_status IN ('draft', 'listed', 'hidden', 'closed')),
    CONSTRAINT exchange_listing_events_to CHECK (to_status IN ('draft', 'listed', 'hidden', 'closed'))
);
CREATE INDEX exchange_listing_events_by_listing ON exchange_listing_events (listing_id, changed_at DESC);

-- The Search Fabric outbox (Today's shape). A document for a listed listing is written with this fixed evt_ id in
-- the same transaction as the change; a draft, hidden or closed listing writes a tombstone. No service grant is
-- needed to queue it, and the rows wait until OpenVibe.Search's document writer is configured.
CREATE TABLE exchange_outbox (
    event_id       text COLLATE "C" PRIMARY KEY,
    topic          text COLLATE "C" NOT NULL,
    payload        jsonb NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    published_at   timestamptz,
    attempts       integer NOT NULL DEFAULT 0,
    last_error     text,
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    claimed_at     timestamptz,
    claimed_by     text
);
CREATE INDEX exchange_outbox_pending ON exchange_outbox (next_attempt_at) WHERE published_at IS NULL;

-- openvibe-sdk/account-data keeps its own idempotency here (ADR-033): a redelivered export or deletion changes
-- nothing. It holds an export_id or deletion_id, the subject and the counts sent to Network; it is not a secret.
CREATE TABLE account_data_events (
    id         text PRIMARY KEY,
    kind       text NOT NULL,
    subject    text NOT NULL,
    outcome    jsonb,
    applied_at timestamptz NOT NULL DEFAULT now(),
    sent_at    timestamptz
);

-- Request telemetry (openvibe-sdk/telemetry): one row per aggregated sample, pruned after 14 days.
CREATE TABLE telemetry_samples (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    at                    timestamptz NOT NULL,
    service               text NOT NULL,
    project               text,
    subject               text,
    resource              text,
    provider              text,
    node                  text,
    cell                  text,
    region                text,
    operation             text NOT NULL,
    latency_ms            double precision,
    queue_delay_ms        double precision,
    ttfb_ms               double precision,
    throughput_per_second double precision,
    bytes                 bigint,
    status                text,
    cache_status          text,
    cost_estimate         double precision,
    route_epoch           bigint,
    trace_id              text,
    extra                 jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX telemetry_samples_at_idx ON telemetry_samples (at);
CREATE INDEX telemetry_samples_service_idx ON telemetry_samples (service, operation, at);
