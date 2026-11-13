# OpenVibe.Exchange

> Every AI model, one account.

**Live site:** https://openvibe.exchange · **API docs:** https://openvibe.services · **For AI:** https://openvibe.exchange/llms.txt
**Run it:** `npm ci && npm run dev` (Node 22 or newer) · **Tests:** `npm test`

**Status:** the remake (2026-11-06) — see [STATUS.json](STATUS.json).
**Domain:** `openvibe.exchange` · **Port:** 5150 · **Service id:** `exchange` · **Env prefix:** `EXCHANGE`
**License:** AGPL-3.0-only (same as every OpenVibe service).

OpenVibe.Exchange is the network's AI front: every model OpenVibe can run, with the live price, speed and uptime
of every offer that serves it, one chat that puts up to three models side by side, and one OpenAI- and
Anthropic-compatible endpoint. It reads OpenVibe.AI — the catalog, the aggregate usage and the runs a chat makes
for a person — and keeps only two things of its own: a person's chats and their 18+ confirmation.

## Pages

| Path | What |
|---|---|
| `/` | "Every AI model, one account": search, popular now, cheapest per million, uncensored, community machines, the endpoint, AI in OpenVibe. Every number is live. |
| `/models`, `/m/<org>/<model>` | Every model and every offer that serves it: price in, out and cached per million, measured p50/p95, uptime, data policy, a **Try it** box, curl and the SDK line. |
| `/chat` and `/chat/*` | 301 to `https://openvibe.chat/vibe`, carrying `?models=` and mapping old `@vN` model ids. Model pages' Try it links go there directly. |

| `/api` | The endpoint, model ids (`deepseek/deepseek-chat`, `openvibe/auto`), keys from Network, aggregate usage, and the link to AI's own provider-keys page (`/you`, a session page). |
| `/start` | Start building: one key, one endpoint, the OpenAI/Anthropic samples, four steps, AI's six operations, and the sandbox and production limits. |
| `/why` | Why this model: the routing rule and a signed-in demo that shows a real run's explain — the objective, the selected offer, and every candidate with its cost, latency and reason. |
| `/faq` | The merged questions: the endpoint, SDKs, models, prices, privacy, keys, selling compute, the uncensored tier and the move from ai.openvibe.services. |
| `/sell` | OpenVibe Link's "Offer to the network", "Pool your machines" for a signed-in person (the four steps: choose the machines, what fits, approve on each, offer it), the dashboard, and what is **not** sold here (personal plans, personal API keys), said plainly. |
| `/uncensored` | The 18+ gate on the account, the abliterated models and the hard floor. |
| `/ai` | Which OpenVibe products run which models through the same router, and what each costs a day, with the product's own mark. |
| `/status` | Uptime per offer, the model changelog and incidents. |
| `/code` | GitHub repositories through OpenVibe.Sources: a deep repository search, Trending today / This week / Hot / New / Top, twelve language chips and one card per repository (stars, the week's gain, forks, language, topics, updated). `/api/v1/code/repos` and `/api/v1/code/search` are its public JSON. |
| `/decisions` | OpenVibe.AI's Decisions API: yes/no (`noul`), one-of-a-list (`choice`) and rubric (`score`) questions about one input, a full request and answer, and who answers — Google's `gemini-decision-1` when a Gemini key is set, otherwise the router's cheapest structured model with `calibrated: false`. |

The old chat rows remain for a person's one-time import into Chat. `GET /internal/exchange/chat/export` requires Chat's service token with `exchange.chat.export` and the authenticated person's `x-ov-subject`; it returns only that person's unsealed chats.

Every page is server-rendered with openvibe-shared/kit and complete without JavaScript. A page rendered for a
signed-in person is `private, no-store`; a public page is `public, max-age=60`.

## What it reads

- `GET https://ai.openvibe.services/api/v1/exchange/catalog` — the models, grouped, with every live offer: price
  (rate cards), measured speed and uptime (`provider_stats_daily`), and `metadata.data_policy` on the provider
  when somebody recorded it. Prepaid capacity carries no price (`free: true`); BYOK and restricted capacity is
  never an offer.
- `GET .../api/v1/exchange/usage?days=30` — aggregate requests, tokens and spend by day, model and product
  (`usage_daily`; never a prompt, an answer or a person).
- `POST .../api/v1/runs` with `workflow: ai.complete` and `on_behalf_of` — one chat
  turn or Try it, on the person's allowance, with this service's token (`ai.run.create`, namespace `ai.complete`).
- `GET .../api/v1/community/offers` — the live community offers; a pool says how many machines serve it (never
  which ones), so the offer card can say "Community pool (N machines)" without naming a machine.
- `GET http://127.0.0.1:4720/api/v1/code/repos` and `/api/v1/code/search` — the GitHub repositories
  OpenVibe.Sources keeps (the `github` source, category `code`) and its live GitHub search, with this
  service's `sources.item.read` grant. Exchange never calls GitHub itself.
- `GET https://openvibe.network/api/v1/machines` and `/api/v1/machine-pools` — the person's own machines, their
  pools and the machines they can pool, with the person's Network token: names, free VRAM and RAM, the local
  network key, and each member's approval and readiness. `POST /api/v1/machine-pools` proposes a pool and
  `POST /api/v1/machine-pools/:id/revoke` stops it. Link measures the links and the fit; Exchange shows what
  Network carries and says "not measured yet" when it carries nothing.

AI unreachable is said, not papered over: the catalog read keeps the last good copy for five minutes and the
pages carry an honest notice; no number is invented.

## Money and free use

A small daily message allowance comes with an account (`EXCHANGE_CHAT_PER_DAY`), and AI's own free allowance
applies per person because the run is `on_behalf_of` them. Paid use and seller payouts arrive when the owner turns
money on; this site shows cost, never charges.

## Exchange v1, retired

v1 was a free and swap marketplace for agents, MCP tools, templates, themes and game assets. It is retired
(design 2026-11-06): every v1 path answers **410** with a pointer (agents and MCP tools → Codes and Connect,
templates → Space and Report, themes → Design), the v1 JSON API answers 410 `exchange.retired`, and its tables
stay in place, read-only. v1's tests are kept, unrun, in `test/retired/`.

## Run

```sh
npm ci
npm start                      # development: embedded PGlite in data/pglite
npm test -- <file|word>        # e.g. npm test -- pages chat retirement
```

`DATABASE_URL` serves, `DATABASE_DIRECT_URL` migrates; `OV_OAUTH_CLIENT_SECRET` makes the sign-in and the AI
client-credentials token work. See [.env.example](.env.example).

## License

AGPL-3.0-only. See [LICENSE](LICENSE).

<!-- versions:start -->
- openvibe-contracts: v0.419.0
- openvibe-sdk: v0.162.0
- openvibe-shared: v4.237.0
- openvibe-publishing: v1.7.0
<!-- versions:end -->

`/own` also previews GPU quotes without sign-in or a rental. Choose Cheapest, Fastest or
Automatic for a rental; Most private and On my machine explain when a Link/OpenVibe machine
is required. The preview uses AI's cached public GPU quote API and never takes a Balance hold.
Provider keys, monthly caps, provisioning and the journal remain in AI; desktop/browser pools
and their operator view remain in Run. The Exchange keeps no provider credentials.
