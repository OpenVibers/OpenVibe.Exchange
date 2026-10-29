'use strict';

/**
 * Exchange's server-rendered pages. They work without JavaScript: forms are plain POSTs and every link is a real
 * link. Public pages are served `public, max-age=60` with Vary: Cookie; a page drawn for a signed-in person is
 * `private, no-store` and a page that needs an account is not cached.
 *
 *   /                       the hero, the three scenes, fresh listings
 *   /listings               browse and filter (free/swap, kind, q)
 *   /listings/:slug         passport, tests, sandbox, install/revoke, free claim or swap offer
 *   /submit                 create a listing (draft; POST /submit)
 *   /sandbox/:id            one sandbox trial and its checks
 *   /installs               the caller's installations and one-tap revoke
 *   /offers                 free claims and swap offers, sent and received
 *   /safety                 the free and swap rules
 *   /developers             the API
 *   404                     the not-found page
 */
const express = require('express');
const seo = require('openvibe-shared/seo');
const { asyncRouter } = require('./router');
const { createDiscoveryRoutes, homeJsonLd } = require('./discovery');
const { sameOrigin } = require('./principal');
const { html, raw } = require('../render/html');
const { send } = require('../render/layout');
const { isStaff } = require('../identity/staff');
const views = require('../views');

const PUBLIC_CACHE = 'public, max-age=60';

function createPageRoutes(ctx) {
    const { config, entries } = ctx;
    const r = asyncRouter();
    r.use(express.urlencoded({ extended: false, limit: '64kb' }));
    const base = () => String(config.baseUrl).replace(/\/+$/, '');
    const page = (req, res, o, status = 200) => send(res, status, { viewer: req.viewer, config, path: req.originalUrl, ...o });
    const signedIn = (req) => req.viewer && req.viewer.kind === 'user' && req.viewer.subject;
    const staffViewer = (req) => isStaff(req.viewer);
    const creatorOf = (req) => (req.viewer && (req.viewer.displayName || req.viewer.username)) || 'a maker';
    const notFromHere = (req, res) => page(req, res, { title: 'Not from this site', body: raw(html`<div class="ex-wrap ex-page-pad ex-narrow"><div class="ex-empty"><h1>That came from somewhere else</h1><p class="ex-muted">Use the form on <a href="/">OpenVibe.Exchange</a>.</p></div></div>`) }, 403);
    const problemOf = (req) => (typeof req.query.problem === 'string' && req.query.problem ? req.query.problem.slice(0, 300) : null);

    // ── Home ─────────────────────────────────────────────────
    r.get('/', async (req, res) => {
        const [list, counts] = await Promise.all([entries.list({ limit: 8 }), entries.counts()]);
        return page(req, res, {
            index: true, cache: PUBLIC_CACHE, agentLayer: true,
            title: null,
            description: 'OpenVibe.Exchange: trade what people make. Free and swap listings for agents, MCP tools, templates, themes, game assets and creator services, each with a permission passport, a sandbox and one-tap revocation.',
            jsonLd: homeJsonLd(config),
            body: raw(views.home({ listings: list.listings, counts })),
        });
    });

    // ── Browse ───────────────────────────────────────────────
    r.get('/listings', async (req, res) => {
        const mode = typeof req.query.mode === 'string' && ['free', 'swap'].includes(req.query.mode) ? req.query.mode : null;
        const kind = typeof req.query.kind === 'string' && entries.KINDS.includes(req.query.kind) ? req.query.kind : null;
        const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 120) : '';
        const out = await entries.list({
            limit: 24, mode, kind, q,
            cursor: typeof req.query.cursor === 'string' && req.query.cursor ? req.query.cursor : null,
        });
        return page(req, res, {
            index: true, cache: PUBLIC_CACHE, agentLayer: true,
            title: 'All listings',
            description: 'Every public free and swap listing on OpenVibe.Exchange: agents, MCP tools, templates, themes, game assets and creator services, each with a permission passport.',
            body: raw(views.listingsPage({ listings: out.listings || [], nextCursor: out.next_cursor || null, filters: { q, mode: mode || '', kind: kind || '' } })),
        });
    });

    // ── One listing ──────────────────────────────────────────
    async function renderListing(req, res, { slug, status = 200, problem = null } = {}) {
        const detail = await entries.detail(String(slug || ''));
        if (!detail) return notFound(req, res);
        const row = detail.row;
        const mine = Boolean(signedIn(req) && row.owner === req.viewer.subject);
        const staff = staffViewer(req);
        if (row.status !== 'listed' && !mine && !staff) return notFound(req, res);
        const listing = detail.listing;
        const subject = signedIn(req) ? req.viewer.subject : null;
        const [activeInstall, trialPassed, offers] = await Promise.all([
            subject ? entries.activeInstall(row.id, subject) : null,
            subject ? entries.hasPassedTrial(row.id, subject, row.version) : false,
            (mine || staff) ? entries.offersForListing(row.id) : [],
        ]);
        const notice = req.query.submitted === '1' ? 'Draft saved. Run the conformance tests below; when they pass you can list it publicly.'
            : req.query.offered === '1' ? 'Your offer is sent. The maker decides.'
                : req.query.closed === '1' ? 'The listing is closed.' : null;
        const jsonLd = seo.jsonLd.webPage({
            name: listing.title,
            url: `${base()}/listings/${listing.slug}`,
            description: (listing.summary || `${listing.title} on OpenVibe.Exchange`).slice(0, 160),
            siteUrl: base(),
        });
        return page(req, res, {
            index: row.status === 'listed',
            agentLayer: row.status === 'listed',
            cache: row.status === 'listed' ? PUBLIC_CACHE : null,
            title: listing.title,
            description: (listing.summary || `${listing.title} on OpenVibe.Exchange`).slice(0, 160),
            jsonLd: [jsonLd],
            body: raw(views.listingPage({
                listing, tests: detail.listing.tests && detail.listing.tests.rows ? detail.listing.tests.rows : [],
                mine, staff, signedIn: Boolean(subject), activeInstall, trialPassed,
                offers, received: mine,
                problem: problem || problemOf(req), notice: req.query.revoked === '1' ? 'Revoked.' : notice,
            })),
        }, status);
    }

    r.get('/listings/:slug', (req, res) => renderListing(req, res, { slug: req.params.slug }));

    // ── Submit (create a draft) ──────────────────────────────
    function formValues(b = {}) {
        return {
            title: b.title || '', kind: b.kind || 'template', mode: b.mode || 'free', summary: b.summary || '',
            description: b.description || '', wants: b.wants || '', license: b.license || 'CC0-1.0',
            license_url: b.license_url || '', version: b.version || '1.0.0',
            manifest_name: b.manifest_name || '', manifest_entry: b.manifest_entry || '', manifest_runtime: b.manifest_runtime || '',
            passport_reads: b.passport_reads || '', passport_writes: b.passport_writes || '', passport_contacts: b.passport_contacts || '',
        };
    }
    const splitList = (v) => String(v == null ? '' : v).split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);

    r.get('/submit', async (req, res) => {
        const mine = signedIn(req) ? await entries.listMine(req.viewer.subject) : [];
        return page(req, res, {
            index: false,
            title: 'List something',
            description: 'List an agent, MCP tool, template, theme, game asset or creator service on OpenVibe.Exchange. Free or swap only in v1.',
            body: raw(views.submitForm({ values: {}, mine })),
        });
    });

    r.post('/submit', async (req, res) => {
        if (!signedIn(req)) return page(req, res, { title: 'List something', body: raw(views.signIn({ title: 'List something', text: 'A listing belongs to your OpenVibe account, so you can manage it later.', next: '/submit' })) }, 401);
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const b = req.body || {};
        const body = {
            title: b.title, kind: b.kind, mode: b.mode, summary: b.summary, description: b.description, wants: b.wants,
            license: b.license, license_url: b.license_url, version: b.version,
            manifest: { name: b.manifest_name, entry: b.manifest_entry, runtime: b.manifest_runtime },
            passport: {
                reads: splitList(b.passport_reads), writes: splitList(b.passport_writes), spends: [], contacts: splitList(b.passport_contacts),
            },
        };
        const out = await entries.createListing({ owner: req.viewer.subject, creator: creatorOf(req), body });
        if (!out.ok) {
            const mine = await entries.listMine(req.viewer.subject);
            return page(req, res, {
                title: 'List something', body: raw(views.submitForm({ values: formValues(b), mine, problem: out.message || 'That listing could not be saved.' })),
            }, out.status || 400);
        }
        return res.redirect(303, `/listings/${encodeURIComponent(out.listing.slug)}?submitted=1`);
    });

    // ── Owner actions ────────────────────────────────────────
    r.post('/listings/:slug/list', async (req, res) => {
        if (!signedIn(req)) return res.redirect(303, `/auth/login?next=${encodeURIComponent(`/listings/${req.params.slug}`)}`);
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const out = await entries.publish(String(req.params.slug || ''), { owner: req.viewer.subject });
        return res.redirect(303, `/listings/${encodeURIComponent(String(req.params.slug))}${out.ok ? '?listed=1' : `?problem=${encodeURIComponent(out.message || 'Cannot list it')}`}`);
    });

    r.post('/listings/:slug/close', async (req, res) => {
        if (!signedIn(req)) return res.redirect(303, `/auth/login?next=${encodeURIComponent(`/listings/${req.params.slug}`)}`);
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const out = await entries.close(String(req.params.slug || ''), { owner: req.viewer.subject, reason: req.body && req.body.reason });
        return res.redirect(303, `/listings/${encodeURIComponent(String(req.params.slug))}${out.ok ? '?closed=1' : `?problem=${encodeURIComponent(out.message || 'Cannot close it')}`}`);
    });

    // ── Sandbox ──────────────────────────────────────────────
    r.post('/listings/:slug/sandbox', async (req, res) => {
        if (!signedIn(req)) return res.redirect(303, `/auth/login?next=${encodeURIComponent(`/listings/${req.params.slug}`)}`);
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const out = await entries.sandbox(String(req.params.slug || ''), { subject: req.viewer.subject });
        if (!out.ok) return res.redirect(303, `/listings/${encodeURIComponent(String(req.params.slug))}?problem=${encodeURIComponent(out.message || 'Cannot start the sandbox')}`);
        return res.redirect(303, `/sandbox/${encodeURIComponent(out.trial.id)}`);
    });

    r.get('/sandbox/:id', async (req, res) => {
        if (!signedIn(req)) return page(req, res, { title: 'Sandbox trial', body: raw(views.signIn({ title: 'Sandbox trial', text: 'A trial belongs to your account; sign in to see it.', next: `/sandbox/${req.params.id}` })) }, 401);
        const out = await entries.trialById(String(req.params.id || ''), { subject: req.viewer.subject });
        if (!out) return notFound(req, res);
        return page(req, res, {
            index: false,
            title: 'Sandbox trial',
            description: 'A manifest and passport dry run on OpenVibe.Exchange.',
            body: raw(views.sandboxPage({ trial: out.trial, listing: out.listing })),
        });
    });

    // ── Installs ─────────────────────────────────────────────
    r.post('/listings/:slug/install', async (req, res) => {
        if (!signedIn(req)) return res.redirect(303, `/auth/login?next=${encodeURIComponent(`/listings/${req.params.slug}`)}`);
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const out = await entries.install(String(req.params.slug || ''), { subject: req.viewer.subject });
        if (!out.ok) return res.redirect(303, `/listings/${encodeURIComponent(String(req.params.slug))}?problem=${encodeURIComponent(out.message || 'Cannot install')}`);
        return res.redirect(303, `/installs?installed=1`);
    });

    r.get('/installs', async (req, res) => {
        if (!signedIn(req)) return page(req, res, { title: 'Your installations', body: raw(views.signIn({ title: 'Your installations', text: 'An installation belongs to your account; sign in to manage it.', next: '/installs' })) }, 401);
        const installs = await entries.installsFor(req.viewer.subject);
        return page(req, res, {
            index: false,
            title: 'Your installations',
            description: 'Everything you have installed on OpenVibe.Exchange, with its passport and a one-tap revoke.',
            body: raw(views.installsPage({ installs })),
        });
    });

    r.post('/installs/:id/revoke', async (req, res) => {
        if (!signedIn(req)) return res.redirect(303, '/auth/login?next=%2Finstalls');
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const out = await entries.revoke(String(req.params.id || ''), { subject: req.viewer.subject });
        return res.redirect(303, `/installs?${out.ok ? 'revoked=1' : `problem=${encodeURIComponent(out.message || 'Cannot revoke it')}`}`);
    });

    // ── Free claims and swap offers ──────────────────────────
    r.get('/offers', async (req, res) => {
        if (!signedIn(req)) return page(req, res, { title: 'Your offers', body: raw(views.signIn({ title: 'Your offers', text: 'Offers belong to your account; sign in to see them.', next: '/offers' })) }, 401);
        const out = await entries.offersFor(req.viewer.subject);
        return page(req, res, {
            index: false,
            title: 'Your offers',
            description: 'The free claims and swap offers you sent and received on OpenVibe.Exchange.',
            body: raw(views.offersPage(out)),
        });
    });

    r.post('/listings/:slug/offers', async (req, res) => {
        if (!signedIn(req)) return res.redirect(303, `/auth/login?next=${encodeURIComponent(`/listings/${req.params.slug}`)}`);
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const out = await entries.offer(String(req.params.slug || ''), {
            subject: req.viewer.subject, fromName: creatorOf(req),
            body: req.body && req.body.body, give: req.body && req.body.give,
        });
        return res.redirect(303, `/listings/${encodeURIComponent(String(req.params.slug))}?${out.ok ? 'offered=1' : `problem=${encodeURIComponent(out.message || 'Cannot send the offer')}`}`);
    });

    for (const action of ['accept', 'decline', 'withdraw']) {
        r.post(`/offers/:id/${action}`, async (req, res) => {
            if (!signedIn(req)) return res.redirect(303, '/auth/login?next=%2Foffers');
            if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
            const out = await entries.decideOffer(String(req.params.id || ''), { subject: req.viewer.subject, action });
            return res.redirect(303, `/offers?${out.ok ? `${action}ed=1` : `problem=${encodeURIComponent(out.message || `Cannot ${action} the offer`)}`}`);
        });
    }

    // ── Static pages ─────────────────────────────────────────
    r.get('/safety', (req, res) => page(req, res, {
        index: true, cache: PUBLIC_CACHE, agentLayer: true,
        title: 'Free and swap safety',
        description: 'OpenVibe.Exchange v1 has no money: free and swap only. Read the passport, meet safely, and revoke any time.',
        body: raw(views.safetyPage()),
    }));

    r.get('/developers', (req, res) => page(req, res, {
        index: true, cache: PUBLIC_CACHE, agentLayer: true,
        title: 'The OpenVibe.Exchange API',
        description: 'The JSON API, the permission passport, the sandbox, installs and the Search document.',
        jsonLd: [seo.jsonLd.webPage({ name: 'The OpenVibe.Exchange API', url: `${base()}/developers`, description: 'The JSON API, the passport, the sandbox, installs and the Search document.', siteUrl: base() })],
        body: raw(views.developersPage()),
    }));

    // ── Discovery ───────────────────────────────────────────
    r.use(createDiscoveryRoutes(ctx));

    function notFound(req, res) {
        return page(req, res, { title: 'Not found', body: raw(views.notFound()) }, 404);
    }

    return r;
}

module.exports = { createPageRoutes };
