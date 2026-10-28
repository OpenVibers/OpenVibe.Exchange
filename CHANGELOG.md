# Changelog

What changed in OpenVibe.Exchange, newest first.

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
