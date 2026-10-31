# OpenVibe.Exchange

> Trade what people make.

**Status:** v1 written and tested (see [STATUS.json](STATUS.json)).
**Domain:** `openvibe.exchange` · **Port:** 5150 · **Service id:** `exchange` · **Env prefix:** `EXCHANGE`
**License:** AGPL-3.0-only (same as every OpenVibe service).

OpenVibe.Exchange is the OpenVibe marketplace for agents, MCP tools, templates (Website, Report, Space), design
themes and kits, game assets and creator services. v1 is **free and swap only**: every listing shows a permission
passport, can be tried in a sandbox, is installed with the passport snapshot, and is revoked in one tap. There is no
money anywhere in v1 — no price, no Billing, no Vibes, no cash — and a passport may not declare a spend.

## Purpose

- **Listings with passports.** A listing names its kind, mode (`free` or `swap`), licence (SPDX), version and
  manifest. Its passport declares exactly what it can read, write, spend and contact. `spends` is always empty in v1,
  enforced by the form, the API and the table's check constraint.
- **Conformance tests for this version.** Submitting a listing runs four tests — `manifest`, `passport`, `licence`,
  `no_money` — and stores one row per version. Only the owner can publish a draft, and only when every test passed.
- **Try before install.** A sandbox trial is a manifest and passport dry run. It records its checks and gives a
  one-hour pass; a passed trial is consumed by the install. v1 **does not execute a listing's code**: Run has no
  sandbox today, and the page, the API and the tests say so.
- **Install and revoke.** An install keeps the exact passport it was made with, so a later listing edit cannot widen
  an old install. A revoke marks it revoked on the spot and is idempotent. In v1 the Exchange install record is the
  entitlement; the Network grant write/revoke is listed under "Grants it will need".
- **Free and swap.** A free listing takes claims; a swap listing says what it wants in return and takes offers with
  what the other person gives. Accepting one closes the listing as `given` or `swapped`, declines the other open
  offers and tombstone its Search document. There is no escrow and no payment.
- **Safety.** A fixed prohibited-items list (weapons, illegal drugs, malware/stolen access, sexual services or
  content, forged documents, live animals, money) is applied to every listing and offer. The safety page carries the
  local-swap rules.
- **No AI.** v1 writes no model-generated text and holds no AI capability. `server/text/no-looks.js` is the shared
  `noLooks` helper (the same rule as Live, Community, MediaHub and Meme) for the day a generated summary or sandbox
  line is added; a maker's own words are never rewritten.

## Owns

| Table | Holds | Migration |
|---|---|---|
| `exchange_listings` | `exl_` + ULID, unique slug (`/listings/<slug>`), title, kind `agent\|mcp_tool\|template\|theme\|game_asset\|service`, mode `free\|swap`, summary/description/wants, SPDX licence + URL, version, public creator name, owner `usr_…`, status `draft\|listed\|hidden\|closed`, manifest jsonb, passport jsonb (spends must be `[]`), revision, listed/closed timestamps | `migrations/0001_initial.sql` |
| `exchange_listing_tests` | one conformance test row per (listing, version, name): `manifest\|passport\|licence\|no_money`, `passed\|failed`, detail, ran_at | `0001_initial.sql` |
| `exchange_listing_events` | every status change: from, to, reason, who, when | `0001_initial.sql` |
| `exchange_sandbox_trials` | `exs_` + ULID, listing, subject, version, `passed\|failed`, passport snapshot, checks jsonb, created/expires/consumed | `0001_initial.sql` |
| `exchange_installs` | `exi_` + ULID, listing, subject, version, passport snapshot, `active\|revoked`, installed/revoked, revision; one active per (listing, subject) | `0001_initial.sql` |
| `exchange_offers` | `exo_` + ULID, listing, from subject and display name, `claim\|swap`, body, give, `open\|accepted\|declined\|withdrawn`, timestamps; one open per (listing, sender) | `0001_initial.sql` |
| `exchange_outbox` | the Search document queue (`evt_` id, topic, payload, attempts, lease) | `0001_initial.sql` |
| `account_data_events` | openvibe-sdk/account-data's export/deletion receipts | `0001_initial.sql` |
| `telemetry_samples` | aggregated request telemetry, pruned after 14 days | `0001_initial.sql` |

There is deliberately **no price, currency, amount or Billing id column**. v2 adds paid listings through Billing;
v1 cannot represent one.

## Does not own

- **Identity, roles and grants** — OpenVibe.Network. Exchange verifies session tokens against its JWKS; a staff route
  asks for `global_mod` or above. A passport is enforced by Network grants in the plan; v1 cannot create one (see
  "Grants it will need").
- **The sandbox runtime** — OpenVibe.Run. v1's sandbox is a dry run; a real execution needs a Run capability.
- **Search** — OpenVibe.Search. Exchange produces `search.index-document@1` documents in its own outbox; the relay
  is not wired because `exchange` has no `search.document.write` grant yet.
- **Billing, transfers, cashouts** — OpenVibe.Billing. Not used at all in v1.
- **The listings engine and local safety rules** — OpenVibe.Rent. Exchange borrows the shape of the rules (no street
  addresses, a fixed prohibited list, staff hide) but has its own table; it does not call Rent.
- **Events, the host and the database** — OpenVibe.Events, OpenVibe.Host.

## Depends on

Environment variable names are in [.env.example](.env.example); no value is committed.

- **OpenVibe.Network** — sign-in (OAuth client `exchange`, PKCE S256, cookies
  `exchange_at`/`exchange_rt`/`exchange_oauth`), JWKS, token exchange/refresh/revoke, account export/deletion, staff
  roles: `OV_NETWORK_URL`, `OV_NETWORK_INTERNAL_URL`, `OV_NETWORK_ISSUER`, `OV_OAUTH_CLIENT_ID`,
  `OV_OAUTH_CLIENT_SECRET`, `OV_OAUTH_REDIRECT_URI`, `OV_SESSION_AUDIENCE`, `EXCHANGE_AUDIENCE`.
- **OpenVibe.Events** — account deliveries: `EXCHANGE_EVENTS_SECRET`, `EXCHANGE_EVENTS_URL`,
  `EXCHANGE_EVENTS_ENDPOINT`.
- **PostgreSQL** — `DATABASE_URL` (through PgBouncer) and `DATABASE_DIRECT_URL` (migrations); embedded PGlite in
  `EXCHANGE_PGLITE_DIR` for development.
- **Valkey** — optional `VALKEY_URL`, `VALKEY_PREFIX` (readiness lists it; the limits in v1 count in-process).
- **Packages** — `openvibe-contracts` v0.229.0, `openvibe-sdk` v0.74.0, `openvibe-shared` v4.59.0, the same tags
  OpenVibe.Meme pins.

## API

Everything is JSON under `/api/v1`; errors are `application/problem+json` with a `code`. A person is the
`exchange_at` session cookie or `Authorization: Bearer <Network user token>`, verified offline with the Network
JWKS. A write made with the session cookie must come from `https://openvibe.exchange`
(403 `exchange.cross_site`). A signed-in account also gets per-actor minute/hour limits (`EXCHANGE_LIMITS_MINUTE`,
`EXCHANGE_LIMITS_HOUR`).

| Route | What it does |
|---|---|
| `GET /listings?limit=&cursor=&mode=&kind=&q=` | public listings, newest first; opaque keyset cursor; `Cache-Control: public, max-age=60` |
| `GET /listings/:slug` | one listing with passport, manifest, licence, tests and counters; a draft/hidden/closed one is 404 unless it is yours or you are staff |
| `GET /listings/:slug/passport` | the exact passport, manifest, licence, version and tests an installer accepts |
| `GET /listings/:slug/tests` | the conformance tests for the version the listing names |
| `GET /listings/:slug/offers` | owner or staff: the open claims/offers |
| `GET /me/listings` | every listing of yours, all statuses |
| `POST /listings` | signed in: create a draft; `spends` must be empty and a credential-looking manifest is refused |
| `POST /listings/:slug/list` | owner: publish after every conformance test for the version passed |
| `POST /listings/:slug/close` | owner: `{ reason: "withdrawn"\|"given"\|"swapped" }`; tombstones the Search document |
| `POST /listings/:slug/sandbox` | signed in: run a manifest dry run; a passed trial is consumed by an install |
| `GET /sandbox/:id` | your trial and its checks |
| `POST /listings/:slug/install` | signed in: install with the passport snapshot; 409 `exchange.sandbox_required` without a fresh passed trial |
| `GET /installs` | your installations, active and revoked |
| `POST /installs/:id/revoke` | revoke in one tap; idempotent |
| `POST /listings/:slug/offers` | signed in: `{ body, give? }` — a claim on a free listing or a swap offer with what you give |
| `GET /offers` | the offers you sent and received |
| `POST /offers/:id/accept\|decline\|withdraw` | owner accepts/declines; sender withdraws; accepting closes the listing |
| `POST /listings/:slug/hide` | staff: hide a listing and tombstone it |

Validation refusals are `400 { code: "exchange.invalid" }`. Other codes: `exchange.no_money`,
`exchange.prohibited`, `exchange.manifest_secret`, `exchange.sandbox_required`, `exchange.sandbox_limit`,
`exchange.offer_exists`, `exchange.own_listing`, `exchange.owner_only`, `exchange.cross_site`,
`exchange.sign_in_required`, `exchange.staff_required`, `exchange.not_found`, `exchange.rate_limited`.

## The permission passport

A passport is public, declarative metadata:

```json
{
  "reads": ["search.read", "space.files.read"],
  "writes": ["space.files.write"],
  "spends": [],
  "contacts": ["https://openvibe.space"]
}
```

- Reads and writes are lower-case permission names; contacts are `https` origins; spends must be empty in v1.
- The manifest is `{ "name", "entry", "runtime" }` only. It is public metadata and never a credential: an unknown
  key or a value that looks like a secret is refused (`exchange.manifest_secret`).
- The listing page shows the passport before and after install; an install stores its own copy.

## The sandbox

`POST /listings/:slug/sandbox` runs four checks: the listing is public, every conformance test for this version
passed, the passport declares no spend, and the execution step is a dry run. The trial is `passed` when all four do;
it expires after `EXCHANGE_SANDBOX_TTL_MINUTES` (60 by default); a person may run at most
`EXCHANGE_SANDBOX_PER_DAY` (20) trials a day. A passed trial is **consumed** by the install, so installing again
needs a fresh one.

This is deliberately honest: v1 does not run a listing's code. A real sandbox needs Run's new capability (below).

## Search

Each public listing is one `search.index-document@1` (owner `exchange`, type `listing`, canonical page
`/listings/<slug>`) queued in `exchange_outbox` in the same transaction as the listing change. A draft writes
nothing; closing or hiding writes a tombstone. The outbox waits for `search.document.write`; the relay is not part of
v1.

## Deploy

`deploy/systemd/openvibe-exchange.service` (port 5150, `/opt/openvibe.exchange`,
`/etc/openvibe/exchange.env`) and `deploy/nginx/openvibe.exchange.conf` (TLS, www redirect, `/auth/me` on the API
zone, sign-in, API and a forms zone, `/metrics` and `/internal` 404 from outside). No proxy cache: the app decides
each response's cacheability.

`npm run seed:proof` creates the first proof through the same store functions as the API: a CC0-1.0 Website template
listed, tried in the sandbox, installed with its passport and revoked. It is idempotent.

## Grants it will need

v1 is written so each of these is a single call site; none is used today. They are external grants on other
services, requested from the main session (this service registers no capability of its own).

| Grant / scope | Service | Used for | State |
|---|---|---|---|
| `network.grants.write` | OpenVibe.Network | create the developer-app grant from the passport snapshot at install | **proposed**; not in contracts v0.229.0 yet |
| `network.grants.revoke` | OpenVibe.Network | revoke that grant everywhere at one-tap revoke | **proposed**; not in contracts v0.229.0 yet |
| `run.sandbox.execute` | OpenVibe.Run | execute a listing's entry point in a real sandbox and run its own tests | **proposed**; Run has no sandbox today. Existing `run.job.submit` could back it if Run adds a sandbox job class |
| `search.document.write` | OpenVibe.Search | relay the `exchange_outbox` documents | existing capability, not granted |
| `network.account.export.contribute` | OpenVibe.Network | push a person's listings/installs/trials/offers export | existing capability, not granted |
| `network.account.deletion.confirm` | OpenVibe.Network | confirm the erasure and counts | existing capability, not granted |
| `events.subscription.manage` | OpenVibe.Events | create the two account subscriptions | existing scope, client credentials |
| `billing.intent.create`, `billing.transfer.create`, `billing.entitlement.check`, `billing.cashout.manage`, `billing.usage.record` | OpenVibe.Billing | **v2 only**: paid listings, transfers, cashouts | not used in v1; no money |

No paid provider and no AI capability is used. No secret is stored in the database, rendered into a page or logged.

## Tests

`test/` boots the app on a temporary PGlite database with an in-process mock of OpenVibe.Network. The suite covers
migration and constraints, the API and validation, sandbox/install/revoke, free/swap offers, server-rendered pages
and cache headers, SSO/PKCE and readiness, the Search document, account export/deletion, noLooks and the safety list,
and the first proof.

```sh
npm test                 # every file, each in its own process
OV_ALLOW_SUITE=1 npm test
npm run test:pg          # the same files through PostgreSQL + PgBouncer containers
VERBOSE=1 npm test       # also print each file's output
```

## License

AGPL-3.0-only. See [LICENSE](LICENSE).

<!-- versions:start -->
- openvibe-contracts: v0.235.0
- openvibe-sdk: v0.74.0
- openvibe-shared: v4.59.0
<!-- versions:end -->
