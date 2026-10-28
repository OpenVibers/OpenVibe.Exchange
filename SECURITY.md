# Security policy

OpenVibe is run in the open, and we want to hear about security problems before anyone else does.

## Reporting a vulnerability

Email **contact@openvibe.network** with "security" in the subject. Please include what you found, where (URL,
repository, file), how to reproduce it, and what an attacker could do with it. Do not open a public GitHub issue for
a vulnerability, and do not test against other people's accounts, data or listings.

We reply within 7 days, keep you updated while we fix it, and credit you when the fix ships if you would like.

## Scope

Every OpenVibe service and site (openvibe.live, openvibe.network, openvibe.exchange, openvibe.meme, openvibe.today,
openvibe.tools, openvibe.media, openvibe.community, openvibe.games and the other openvibe.* domains) and every
repository under github.com/OpenVibers. Machine-readable contact details are at `/.well-known/security.txt` on each
site.

## What OpenVibe.Exchange holds

- Public listings: the title, summary, description, wants, kind, mode, licence, version, public creator name and
  revision, plus the manifest (`name`, `entry`, `runtime`) and the permission passport. None of it is a credential.
- Conformance tests for each listing version and the status events of a listing.
- A person's sandbox trials, installations and the claims/offers they made or received. These are exported and
  erased with an account, along with the person's listings.
- Network session tokens only in httpOnly cookies (`exchange_at`, `exchange_rt`); no token is stored in the
  database, rendered into a page or logged.
- **No money**: there is no price, no Billing id and no payment credential anywhere in v1.

A manifest is public metadata. A key or value that looks like a secret (`api_key=`, `token:`, a private key block)
is refused before it is stored, and an unknown manifest key is refused outright. A listing's passport spends must be
empty; a spend is refused by the form, the API and a table check.

v1 does not execute a listing's code. The sandbox is a manifest/passport dry run, and it says so on the page and in
the API. A real sandbox needs a Run capability and is not part of this version.

The `/internal/events` account route is loopback only and refuses a proxied request; nginx answers 404 for
`/internal` and `/metrics`.

## Supported versions

Only the current `main` branch, which is what runs in production, receives fixes.
