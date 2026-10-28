'use strict';

/**
 * /api/v1 — OpenVibe.Exchange's JSON API.
 *
 *   GET    /listings?limit=&cursor=&mode=&kind=&q=   public listings, newest first, cursor-paged
 *   GET    /listings/:slug                          one listing with its passport, tests and licence
 *   GET    /listings/:slug/passport                 the exact passport and manifest an installer accepts
 *   GET    /listings/:slug/tests                    the conformance tests for this version
 *   GET    /listings/:slug/offers                   the open free claims / swap offers (owner or staff)
 *   GET    /me/listings                             the caller's listings, all statuses
 *   POST   /listings                                create a draft (signed in, same-origin)
 *   POST   /listings/:slug/list                     publish after the conformance tests passed (owner)
 *   POST   /listings/:slug/close                    close (given / swapped / withdrawn) (owner)
 *   POST   /listings/:slug/sandbox                  run a manifest dry-run trial (signed in)
 *   GET    /sandbox/:id                             one trial of yours
 *   POST   /listings/:slug/install                  install with the passport snapshot (signed in; trial required)
 *   GET    /installs                                the caller's installations
 *   POST   /installs/:id/revoke                     revoke one installation (signed in)
 *   POST   /listings/:slug/offers                   a free claim or a swap offer (signed in)
 *   GET    /offers                                  offers the caller sent and received
 *   POST   /offers/:id/accept|decline|withdraw      decide an offer
 *   POST   /listings/:slug/hide                     staff: hide a listing
 *
 * Errors are application/problem+json with a `code`. A person is the exchange_at session cookie or a Network user
 * token as a Bearer; a session write must come from openvibe.exchange itself (403 exchange.cross_site). There is no
 * money: a listing is free or a swap, and a passport may not declare a spend.
 */
const express = require('express');
const { http } = require('openvibe-contracts');
const { asyncRouter } = require('./router');
const { sameOrigin } = require('./principal');
const { isStaff } = require('../identity/staff');
const { KINDS, MODES } = require('../store');

function createApi(ctx) {
    const { config, s, principal, entries } = ctx;
    const r = asyncRouter();

    r.use(express.json({ limit: '64kb' }));
    r.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
    r.use(principal.middleware);

    // Per-actor limits, on top of the per-address limit in server/app.js: a signed-in person gets the minute and
    // hour budget from config, and an app or anonymous caller is left to the address limiter.
    const buckets = new Map();
    function windowCount(key, windowMs, limit) {
        const now = Date.now();
        let b = buckets.get(key);
        if (!b || now - b.start >= windowMs) { b = { start: now, n: 0 }; buckets.set(key, b); }
        b.n += 1;
        return b.n <= limit;
    }
    r.use((req, res, next) => {
        if (req.principal && req.principal.kind === 'user' && req.principal.subject) {
            const who = `user:${req.principal.subject}`;
            const okMinute = windowCount(`${who}:m`, 60_000, config.limits.minute);
            const okHour = windowCount(`${who}:h`, 60 * 60_000, config.limits.hour);
            if (!okMinute || !okHour) return problem(res, 429, 'exchange.rate_limited', 'too many requests from this account; retry shortly');
            if (buckets.size > 20_000) {
                for (const [k, b] of buckets) if (Date.now() - b.start > 2 * 60 * 60_000) buckets.delete(k);
            }
        }
        return next();
    });

    const problem = (res, status, code, detail) => http.sendProblem(res, status, code, { detail, ctx: res.req && res.req.ov });
    const invalid = (res, detail) => problem(res, 400, 'exchange.invalid', detail);

    function person(req, res) {
        const p = req.principal;
        if (p.kind === 'anonymous') { problem(res, 401, 'exchange.sign_in_required', 'Sign in at openvibe.exchange, or send a person\'s Network token as a Bearer.'); return null; }
        if (p.kind !== 'user') { problem(res, 403, 'exchange.person_required', 'This route is for a person, not an app.'); return null; }
        if (p.viaSession && req.method !== 'GET' && !sameOrigin(req, config.baseUrl)) {
            problem(res, 403, 'exchange.cross_site', 'A signed-in request that changes something must come from openvibe.exchange itself.');
            return null;
        }
        return p;
    }
    const requirePerson = (req, res, next) => (person(req, res) ? next() : undefined);
    const requireStaff = (req, res, next) => {
        if (!person(req, res)) return undefined;
        if (!isStaff(req.principal)) return problem(res, 403, 'exchange.staff_required', 'This route is for OpenVibe staff (Network role global_mod or above).');
        return next();
    };

    const creatorOf = (req) => (req.viewer && req.viewer.kind === 'user' && req.viewer.displayName) || req.principal.username || 'a maker';

    /** A listing the caller may see: public, or their own, or staff. */
    async function visible(req, res, slug) {
        const row = await entries.bySlug(String(slug || ''));
        if (!row) { problem(res, 404, 'exchange.not_found', 'No such listing.'); return null; }
        const mine = req.principal.kind === 'user' && row.owner === req.principal.subject;
        const staff = isStaff(req.principal);
        if (row.status !== 'listed' && !mine && !staff) { problem(res, 404, 'exchange.not_found', 'No such listing.'); return null; }
        return { row, mine, staff };
    }

    r.get('/ping', (_req, res) => res.json({ ok: true, service: config.service }));

    // ── Public reads ────────────────────────────────────────
    r.get('/listings', async (req, res) => {
        const limit = req.query.limit == null || req.query.limit === '' ? 20 : Number.parseInt(req.query.limit, 10);
        if (!Number.isFinite(limit) || limit < 1) return invalid(res, 'limit must be from 1 to 50');
        const mode = typeof req.query.mode === 'string' && req.query.mode ? req.query.mode : null;
        if (mode && !MODES.includes(mode)) return invalid(res, `mode must be one of ${MODES.join(', ')}`);
        const kind = typeof req.query.kind === 'string' && req.query.kind ? req.query.kind : null;
        if (kind && !KINDS.includes(kind)) return invalid(res, `kind must be one of ${KINDS.join(', ')}`);
        const out = await entries.list({
            limit, mode, kind,
            q: typeof req.query.q === 'string' ? req.query.q : null,
            cursor: typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : null,
        });
        if (out.error === 'cursor') return invalid(res, 'cursor is not a cursor this API handed out');
        res.set('Cache-Control', 'public, max-age=60');
        return res.json({ count: out.listings.length, listings: out.listings, next_cursor: out.next_cursor });
    });

    r.get('/listings/:slug', async (req, res) => {
        const found = await visible(req, res, req.params.slug);
        if (!found) return undefined;
        const detail = await entries.detail(found.row.slug);
        if (!detail) return problem(res, 404, 'exchange.not_found', 'No such listing.');
        const out = { ...detail.listing, mine: found.mine, staff: found.staff };
        if (!found.mine && !found.staff) delete out.owner;
        res.set('Cache-Control', found.row.status === 'listed' ? 'public, max-age=60' : 'private, no-store');
        return res.json(out);
    });

    r.get('/listings/:slug/passport', async (req, res) => {
        const found = await visible(req, res, req.params.slug);
        if (!found) return undefined;
        const out = {
            slug: found.row.slug,
            version: found.row.version,
            mode: found.row.mode,
            license: found.row.license,
            creator: found.row.creator,
            manifest: entries.wireListing(found.row).manifest,
            passport: entries.wirePassport(found.row.passport),
            tests: await entries.testsFor(found.row.id, found.row.version),
        };
        res.set('Cache-Control', found.row.status === 'listed' ? 'public, max-age=60' : 'private, no-store');
        return res.json(out);
    });

    r.get('/listings/:slug/tests', async (req, res) => {
        const found = await visible(req, res, req.params.slug);
        if (!found) return undefined;
        const rows = await entries.testsFor(found.row.id, found.row.version);
        res.set('Cache-Control', found.row.status === 'listed' ? 'public, max-age=60' : 'private, no-store');
        return res.json({ version: found.row.version, count: rows.length, verified: rows.length > 0 && rows.every((t) => t.status === 'passed'), tests: rows });
    });

    r.get('/listings/:slug/offers', requirePerson, async (req, res) => {
        const found = await visible(req, res, req.params.slug);
        if (!found) return undefined;
        if (!found.mine && !found.staff) return problem(res, 403, 'exchange.owner_only', 'Only the listing owner or staff can read its offers.');
        return res.json({ count: (await entries.offersForListing(found.row.id)).length, offers: await entries.offersForListing(found.row.id) });
    });

    r.get('/me/listings', requirePerson, async (req, res) => {
        const listings = await entries.listMine(req.principal.subject);
        return res.json({ count: listings.length, listings });
    });

    // ── Listings (a person) ─────────────────────────────────
    r.post('/listings', requirePerson, async (req, res) => {
        const out = await entries.createListing({ owner: req.principal.subject, creator: creatorOf(req), body: req.body || {} });
        if (!out.ok) return problem(res, out.status || 400, out.code || 'exchange.invalid', out.message || 'invalid listing');
        res.set('Location', `/api/v1/listings/${out.listing.slug}`);
        return res.status(201).json(out.listing);
    });

    r.post('/listings/:slug/list', requirePerson, async (req, res) => {
        const out = await entries.publish(String(req.params.slug || ''), { owner: req.principal.subject });
        if (!out.ok) return problem(res, out.status || 400, out.code || 'exchange.invalid', out.message || 'cannot list');
        return res.json(out.listing);
    });

    r.post('/listings/:slug/close', requirePerson, async (req, res) => {
        const b = req.body && typeof req.body === 'object' ? req.body : {};
        const out = await entries.close(String(req.params.slug || ''), { owner: req.principal.subject, reason: b.reason });
        if (!out.ok) return problem(res, out.status || 400, out.code || 'exchange.invalid', out.message || 'cannot close');
        return res.json(out.listing);
    });

    r.post('/listings/:slug/hide', requireStaff, async (req, res) => {
        const out = await entries.hide(String(req.params.slug || ''), { changedBy: req.principal.subject });
        if (!out.ok) return problem(res, out.status || 400, out.code || 'exchange.invalid', out.message || 'cannot hide');
        return res.json(out.listing);
    });

    // ── Sandbox ─────────────────────────────────────────────
    r.post('/listings/:slug/sandbox', requirePerson, async (req, res) => {
        const out = await entries.sandbox(String(req.params.slug || ''), { subject: req.principal.subject });
        if (!out.ok) return problem(res, out.status || 400, out.code || 'exchange.invalid', out.message || 'cannot start the sandbox');
        res.set('Location', `/api/v1/sandbox/${out.trial.id}`);
        return res.status(201).json({ trial: out.trial, checks: out.checks });
    });

    r.get('/sandbox/:id', requirePerson, async (req, res) => {
        const out = await entries.trialById(String(req.params.id || ''), { subject: req.principal.subject });
        if (!out) return problem(res, 404, 'exchange.trial_not_found', 'No such sandbox trial of yours.');
        return res.json(out.trial);
    });

    // ── Installs ────────────────────────────────────────────
    r.post('/listings/:slug/install', requirePerson, async (req, res) => {
        const out = await entries.install(String(req.params.slug || ''), { subject: req.principal.subject });
        if (!out.ok) return problem(res, out.status || 400, out.code || 'exchange.invalid', out.message || 'cannot install');
        if (!out.unchanged) res.set('Location', `/api/v1/installs`);
        return res.status(out.unchanged ? 200 : 201).json(out.install);
    });

    r.get('/installs', requirePerson, async (req, res) => {
        const installs = await entries.installsFor(req.principal.subject);
        return res.json({ count: installs.length, installs });
    });

    r.post('/installs/:id/revoke', requirePerson, async (req, res) => {
        const out = await entries.revoke(String(req.params.id || ''), { subject: req.principal.subject });
        if (!out.ok) return problem(res, out.status || 400, out.code || 'exchange.invalid', out.message || 'cannot revoke');
        return res.json(out.install);
    });

    // ── Free claims and swap offers ─────────────────────────
    r.post('/listings/:slug/offers', requirePerson, async (req, res) => {
        const b = req.body && typeof req.body === 'object' ? req.body : {};
        const out = await entries.offer(String(req.params.slug || ''), {
            subject: req.principal.subject, fromName: creatorOf(req), body: b.body, give: b.give,
        });
        if (!out.ok) return problem(res, out.status || 400, out.code || 'exchange.invalid', out.message || 'cannot send the offer');
        res.set('Location', `/api/v1/offers`);
        return res.status(201).json(out.offer);
    });

    r.get('/offers', requirePerson, async (req, res) => {
        const out = await entries.offersFor(req.principal.subject);
        return res.json({ sent: out.sent.length, received: out.received.length, ...out });
    });

    for (const action of ['accept', 'decline', 'withdraw']) {
        r.post(`/offers/:id/${action}`, requirePerson, async (req, res) => {
            const out = await entries.decideOffer(String(req.params.id || ''), { subject: req.principal.subject, action });
            if (!out.ok) return problem(res, out.status || 400, out.code || 'exchange.invalid', out.message || `cannot ${action} the offer`);
            return res.json({ offer: out.offer, ...(out.closed ? { listing: out.closed } : {}) });
        });
    }

    return r;
}

module.exports = { createApi };
