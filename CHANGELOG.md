# Changelog

What changed in OpenVibe.Exchange, newest first.

## Unreleased

- **Pooled machines (`/sell`).** Under the single-machine card, a signed-in person with two or more of their
  machines sees "Pool your machines": the four steps of the design as stacked cards. **Choose the machines** lists
  each machine with its GPU, free VRAM and RAM and Node's measured link in words ("2 ms, 940 Mb/s: good"; a failed
  link says the number and the limit, "40 ms; a pool needs under 5 ms"), and a machine on another network is
  greyed with its reason. **What fits** is Node's fit table: a measured speed, or "not measured yet". **Approve on
  each machine** says "Waiting for approval on Laptop" until that machine approves on itself. **Offer it** shows the
  same price, audience and idle-only controls as one machine, with the privacy sentence (the head sees the prompt,
  the others only numbers in transit), and nothing is offered until every member approves. "Stop pooling" says what
  it does. The machines, pools, links and fit come from Network and AI with the person's own token: Exchange
  measures nothing and keeps no pool. The offer card on model pages and `/models` says "Community pool (N
  machines)" and only the count; the owner sees the machine names on `/sell`.

- **Private AI.** Strict privacy is a switch on `/chat` and on the API page's keys. It sends AI the `private` preset:
  only offers that keep nothing and train on nothing (or OpenVibe's own deployments) may answer, the router refuses
  with a plain message when none can, and every answer's receipt carries its label (Private, No training, Anonymized,
  Community, Standard).
- **Sealed history.** A chat can be sealed with the person's Locker: the browser seals the whole conversation
  (`ov-locker.js`, people-locked to the person) and Exchange stores only the envelope. The chat list shows a neutral
  title until it is opened, the model still receives the turn it answers, and the page says so plainly. Account
  export carries the envelope and deletion erases it.
- **The Arena (`/arena`).** One prompt, two models answering side by side with no names, one vote (left, right, a
  tie, or both bad), then both names and their receipts. The pair is chosen from the live catalogue, free-tier
  capacity first and different families where possible, and each answer is a normal run on the person's own
  allowance. A vote is a Bench `human_pairwise` judgement for that person, filed under the prompt's task category
  (code, writing, chat, reasoning, translation, analysis), rate-limited per person and counted once per round.
- **Rankings (`/rankings`).** Bench's board by task category beside the cheapest live price per million in and
  out, the measured p50 and uptime, and a value column (rating points above 1000 per dollar of output). A
  products-and-apps panel shows which models OpenVibe's products run, and developers' apps as one unnamed row, from AI's aggregate usage
  and never a person.
- **Model changelog (`/status`).** A daily snapshot of the catalogue in `exchange_model_snapshots` names the
  models that arrived, left or changed their price between the last two recorded days, with the dates.
- **Account data.** A person's arena rounds and votes are exported and erased with their account.

- **Theme palettes.** A Design theme's listing keeps the preview palette from Design's public API (background,
  surface, text, accent and up to two more), in a new `palette` array on the API; the card and the listing page draw
  it as small swatches. Only `#rrggbb` values are stored and painted; a second refresh leaves the row untouched.

## 0.1.0 — 2026-10-28

The first version: trade what people make, free and swap only.

- **Listings.** `exchange_listings` with a unique slug, kind (`agent`, `mcp_tool`, `template`, `theme`, `game_asset`,
  `service`), free/swap mode, SPDX licence, semantic version, public manifest, permission passport and a revision
  that goes up on every change. There is no price, currency or Billing column; a passport's `spends` is `[]` and a
  table check, the form and the API all enforce it.
- **The passport.** Reads, writes, spends and contacts, declared in the manifest and shown before and after install.
  An install stores its own snapshot, so a later edit cannot widen an old install. A manifest that looks like a
  credential is refused.
- **Conformance tests.** Submitting a draft runs `manifest`, `passport`, `licence` and `no_money` for its version and
  stores one row each. Only the owner can publish, and only when all four passed.
- **Sandbox.** A trial is a manifest/passport dry run with four recorded checks, a 60-minute TTL and at most 20 a
  day. A passed trial is consumed by the install. v1 does not execute the listing's code; a real Run sandbox is the
  next version's job and the page says so.
- **Install and revoke.** `exchange_installs` with one active install per (listing, person), the passport snapshot,
  a version and a revision. Revoke is one tap, idempotent, and a fresh trial is needed to install again.
- **Free and swap.** A free listing takes claims (`exchange_offers` kind `claim`); a swap listing says what it wants
  in return and takes offers with a required `give`. The owner accepts or declines; the sender withdraws. Accepting
  closes the listing as `given` or `swapped`, declines the other open offers and tombstones its Search document.
- **Safety.** The fixed prohibited-items and no-money filter is applied to every listing and offer, in the form and
  the API alike; `/safety` carries the local-swap rules.
- **Search.** Each public listing is one `search.index-document@1` (owner `exchange`, type `listing`,
  `/listings/<slug>`) queued in `exchange_outbox` in the same transaction; closing or hiding writes a tombstone. The
  relay waits for the `search.document.write` grant.
- **Account data.** Listings, installs, sandbox trials and offers are exported and erased with an account. A deleted
  listing has its words replaced, is closed and is tombstoned in Search; a draft is deleted outright; other people's
  listings stay.
- **The service.** Network sign-in as OAuth client `exchange` (PKCE S256, `exchange_at`/`exchange_rt`/
  `exchange_oauth`), truthful readiness, Prometheus metrics on loopback, discovery, deploy files, and
  server-rendered pages with stable `ex-` ids. `public/css/exchange.css` and `public/js/exchange.js` are one-comment
  placeholders for the main session.
- **The first proof.** `scripts/seed-proof.js` lists a CC0-1.0 Website template, runs its conformance tests, tries it
  in the sandbox, installs it with its passport and revokes that install; it is idempotent.
- **Tests.** Migration and constraints, the API, sandbox/install/revoke, free/swap offers, pages and cache, SSO,
  Search, account export/deletion, noLooks, safety and the first proof — each file in its own process on a temporary
  PGlite database with a mock Network.
