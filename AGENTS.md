# AGENTS.md — OpenVibe.Exchange

## Project overview

"Every AI model, one account." Exchange is the network's AI front: every model OpenVibe can run with the
live price, speed and uptime of every offer that serves it, one chat that puts up to three models side by
side, the OpenAI- and Anthropic-compatible endpoint, community machines, the uncensored tier, companions
and the AI arena. It **reads OpenVibe.AI** (catalog, aggregate usage, and the runs a chat makes for a
person) and keeps only two things of its own: a person's chats and their 18+ confirmation. Node.js/
Express, PostgreSQL (PGlite in development), CommonJS, **no build step**.

- Service id `exchange`, port `5150`, origin `https://openvibe.exchange`, unit
  `openvibe-exchange.service`, release root `/opt/openvibe.exchange`.
- The v1 marketplace is retired: `/api/v1/*` answers `410`, and its tables stay as they are, read-only.
  Every old chat row remains for a one-time import into Chat.

## What it owns

- The pages and their live numbers: `/` (every model, popular, cheapest, uncensored, community machines,
  endpoint), `/models`, `/m/<org>/<model>` (price in/out/cached per million, p50/p95, uptime, data policy,
  Try it, curl and the SDK line), `/api` (endpoint, model ids, keys, aggregate usage), `/start`, `/why`
  (a real run's explain), `/faq`, `/sell` (Link machines and pools; what is **not** sold), `/uncensored`,
  `/ai`, `/status`.
- A person's chats (`server/chat/store.js`) and their 18+ confirmation; companions, lorebooks, notes,
  memory and the Locker; the arena and compare surfaces; the deep-dive/analysis pages.
- The one-time import contract: `GET /internal/exchange/chat/export` requires Chat's service token with
  `exchange.chat.export` and the authenticated person's `x-ov-subject`; it returns only that person's
  unsealed chats.
- The `/chat` redirect: 301 to `https://openvibe.chat/vibe`, carrying `?models=` and mapping old `@vN`
  model ids. Model pages' Try it links go there directly.
- Its own PostgreSQL state, migrations and account-data receipts.

Not owned: the catalog/prices/usage and the model runs (AI), the models and provider keys (AI/Network),
identity, chat itself (Chat), ratings (Bench), machines and pools (Network/Link), money (Billing), Media.

## What it reads (AI and Network)

- `GET https://ai.openvibe.services/api/v1/exchange/catalog` — models grouped, with every live offer:
  price (rate cards), measured speed/uptime, `metadata.data_policy` where recorded. Prepaid capacity has
  no price (`free: true`); **BYOK and restricted capacity are never an offer**.
- `GET .../api/v1/exchange/usage?days=30` — aggregate requests, tokens and spend by day/model/product
  (`usage_daily`; never a prompt, answer or person).
- `POST .../api/v1/runs` with `workflow: ai.complete` and `on_behalf_of` — one chat turn or Try it, on the
  person's allowance, with Exchange's token (`ai.run.create`, namespace `ai.complete`).
- `GET .../api/v1/community/offers` — live community offers; a pool says **how many** machines serve it,
  never which ones ("Community pool (N machines)").
- `GET https://openvibe.network/api/v1/machines` and `/machine-pools` — the person's machines, pools and
  poolable machines, with their Network token (names, free VRAM/RAM, local network key, approvals,
  readiness); `POST /api/v1/machine-pools` proposes, `.../:id/revoke` stops. Link measures links and fit;
  Exchange shows what Network carries and says "not measured yet" when it carries nothing.
- AI unreachable is **said, not papered over**: the catalog read keeps the last good copy for five minutes
  and pages carry an honest notice; no number is invented.

## Repository map

- **Entry:** [server/index.js](server/index.js) — `createApp()`, listen, graceful stop.
- **App:** [server/app.js](server/app.js) — helmet/CSP, `/auth`, `/internal/events`, `/shared`,
  `/api/v1/arena`, `/api/v1/analysis`, `/api/v1/compare`, `/api/v1`, pages, machine endpoints.
- **Reads:** [server/ai.js](server/ai.js), [server/network.js](server/network.js),
  [server/bench.js](server/bench.js), [server/compare.js](server/compare.js),
  [server/model-directory.js](server/model-directory.js), [server/model-search.js](server/model-search.js),
  [server/compute-prices.js](server/compute-prices.js), [server/catalog-history.js](server/catalog-history.js),
  [server/analysis.js](server/analysis.js).
- **Person state:** [server/chat/store.js](server/chat/store.js), [server/companions/](server/companions/)
  (`store.js`, `group.js`, `voice.js`, `adult.js`, `memory.js`, `lorebook.js`, `locker.js`, `taking-notes.js`),
  [server/actor.js](server/actor.js), [server/sharing.js](server/sharing.js).
- **Arena:** [server/arena/store.js](server/arena/store.js), `category.js`; HTTP in
  [server/http/arena.js](server/http/arena.js), `compare.js`, `compare-site.js`, `analysis.js`,
  `deep-dive.js`, `dashboard.js`, `search.js`.
- **Pages/API:** [server/http/pages.js](server/http/pages.js), `api.js`, `console.js`, `companions.js`,
  `principal.js`, `router.js`, [server/openapi.js](server/openapi.js); [server/render/](server/render/).
- **Config/db:** [server/config.js](server/config.js), [server/db.js](server/db.js).
- **Deploy:** [deploy/systemd/openvibe-exchange.service](deploy/systemd/openvibe-exchange.service),
  [deploy/nginx/openvibe.exchange.conf](deploy/nginx/openvibe.exchange.conf).

## Commands

```bash
npm ci
npm start                  # development: PGlite in data/pglite, http://localhost:5150
npm test                   # test/run.js, PGlite, mock Network/AI
npm test -- pages chat retirement   # filter by word
npm run test:pg            # same on PostgreSQL (EXCHANGE_TEST_STORE=pg)
npm run seed:proof         # scripts/seed-proof.js
ov test                    # the harness's sharded run of what the change reaches
```

`DATABASE_URL` serves, `DATABASE_DIRECT_URL` migrates; `OV_OAUTH_CLIENT_SECRET` makes sign-in and the AI
client-credentials token work. See `.env.example`.

## Database and migrations

Exchange's own PostgreSQL database (ADR-035; PGlite under `data/pglite` in development). Async through
`openvibe-sdk/db`; migrations `migrations/NNNN_*.sql` applied at boot; never edit an applied migration, add
a new number. **Exchange v1's tables are read-only**: nothing is written to them any more, and the old chat
rows exist only for the one-time import. A new column for the current product goes in a new migration.

## Auth, privacy and the 18+ gate

- People sign in through Network SSO (OAuth client `exchange`, PKCE). Exchange's AI calls use its own
  client-credentials token with `on_behalf_of` the person, so the run is theirs (allowance, receipt).
- A page rendered for a signed-in person is `private, no-store`; a public page is `public, max-age=60`.
  Do not cache a signed-in page publicly.
- The 18+ confirmation is on the **account**, not a cookie: `/uncensored` explains the abliterated models
  and the hard floor. Do not move the gate into client state.
- The old-chat export is service-only: Chat's token (`exchange.chat.export`) plus `x-ov-subject`; it
  returns only that person's unsealed chats. Never expose it publicly.
- Service callers need a Network service token audience `openvibe.exchange` and the route's capability;
  account export/deletion goes through `/internal/events`.

## Frontend loading model

Every page is **server-rendered with `openvibe-shared/kit` and complete without JavaScript**; there is no
SPA, bundler or transpiler. `openvibe-shared` supplies the Frame/kit/legal/SEO and `/shared/*` from the
pinned node_modules. The pages negotiate cleanly for agents (JSON/llms) and their numbers come from the
same AI reads. CSP is in [server/app.js](server/app.js).

## Deploy

Unit [deploy/systemd/openvibe-exchange.service](deploy/systemd/openvibe-exchange.service) runs
`/opt/openvibe.exchange/server/index.js` on `127.0.0.1:5150`, env `/etc/openvibe/exchange.env`; vhost
[deploy/nginx/openvibe.exchange.conf](deploy/nginx/openvibe.exchange.conf). The README does not document
an `ovhost deploy exchange` command — use the host's own service installer. Migrations run at boot; no
secret in a command line, file or log.

## Tests

`npm test` runs each `test/*.test.js` in its own process with PGlite and in-process Network/AI mocks. It
pins the pages and their numbers, the catalog/usage reads and the "last good copy for five minutes" rule,
the `/chat` redirect and old `@vN` mapping, the v1 retirement (`410`), the 18+ gate, companions/arena/
compare, the internal chat export (subject-scoped), account export/deletion and discovery. `ov test` runs
the same.

## Conventions

- CommonJS, 4-space indent, single quotes, semicolons; reads live in `server/ai.js`/`server/network.js`,
  person state in `server/*/store.js`, HTTP in `server/http/`.
- A number shown to a person comes from AI or Network and carries its freshness; a missing number is said,
  never defaulted. Prices are per million tokens with the currency and the offer.
- Errors are problem+json with stable codes; an AI/Network failure is a clear notice, not a 500 page.
- The v1 surface is retired: do not revive `/api/v1` marketplace routes; keep the `410`.

## Pitfalls

- **Never invent a price, a model or an uptime.** If AI does not answer, keep the last good catalog for at
  most five minutes and show the notice; a page with no data says so.
- **BYOK and restricted capacity are not offers**, and prepaid capacity is `free: true`; do not list them
  as purchasable.
- **A community pool never names its machines**, only the count.
- **Person state is private:** chats, companions, notes and the 18+ flag are per subject; a signed-in page
  is `no-store`. The old-chat export is the only cross-service read and is subject-scoped by Chat.
- **Do not write Exchange v1's tables.** They are the migration's archive; the old chat rows are for the
  one-time import only.
- **`/chat` is a 301 to Chat/Vibe** with `?models=` and the old `@vN` mapping; do not rebuild a local chat
  page.
- **Money is AI's/Billing's**; Exchange charges a turn to the person's allowance through AI, never a local
  ledger.
- **No fabricated "selling compute"**: `/sell` says plainly what is not sold (personal plans, personal API
  keys); machines/pools are Network's truth.
- **A unit description that says "trade what people make" is stale** (the remake is the AI front); do not
  use it as the product description.

## Documentation

- [README.md](README.md) — pages, what it reads, money/free use, the retired v1, run.
- [STATUS.json](STATUS.json) — the remake's state.
- [docs/](docs/) — platform review, shared analysis, C2 notes and screenshots.
- OpenVibe.Contracts holds `exchange.*`/`ai.*` shapes; AI and Network own their upstream APIs.
