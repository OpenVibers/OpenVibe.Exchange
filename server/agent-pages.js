'use strict';
// The public pages the agent layer serves as Markdown twins (openvibe-shared/agent-layer). Each twin is the
// page's own render through the same views and layout the HTML routes use, always signed out: a listing's
// owner/staff actions, installs and offers never appear in a twin, and an unlisted listing has no twin at all.
const seo = require('openvibe-shared/seo');
const views = require('./views');
const { raw } = require('./render/html');
const { renderPage } = require('./render/layout');
const { homeJsonLd } = require('./http/discovery');

const HOME_DESCRIPTION = 'OpenVibe.Exchange: trade what people make. Free and swap listings for agents, MCP tools, templates, themes, game assets and creator services, each with a permission passport, a sandbox and one-tap revocation.';
const LISTINGS_DESCRIPTION = 'Every public free and swap listing on OpenVibe.Exchange: agents, MCP tools, templates, themes, game assets and creator services, each with a permission passport.';

function createAgentPages(ctx) {
    const { config, entries } = ctx;
    const base = () => String(config.baseUrl).replace(/\/+$/, '');
    const page = (path, o) => ({ html: renderPage({ viewer: { kind: 'anonymous' }, config, path, agentLayer: true, ...o }), title: o.title });

    async function home(path) {
        const [list, counts] = await Promise.all([entries.list({ limit: 8 }), entries.counts()]);
        return page(path, {
            index: true, title: null, description: HOME_DESCRIPTION,
            jsonLd: homeJsonLd(config),
            body: raw(views.home({ listings: list.listings, counts })),
        });
    }

    async function listings(path, query) {
        const mode = typeof query.get('mode') === 'string' && ['free', 'swap'].includes(query.get('mode')) ? query.get('mode') : null;
        const kind = entries.KINDS.includes(query.get('kind')) ? query.get('kind') : null;
        const q = query.get('q') ? query.get('q').slice(0, 120) : '';
        const cursor = query.get('cursor') ? query.get('cursor') : null;
        const out = await entries.list({ limit: 24, mode, kind, q, cursor });
        return page(path, {
            index: true, title: 'All listings', description: LISTINGS_DESCRIPTION,
            body: raw(views.listingsPage({ listings: out.listings || [], nextCursor: out.next_cursor || null, filters: { q, mode: mode || '', kind: kind || '' } })),
        });
    }

    async function listing(path, slug) {
        const detail = await entries.detail(String(slug || ''));
        if (!detail || detail.row.status !== 'listed') return null;
        const row = detail.row;
        const listing = detail.listing;
        const jsonLd = seo.jsonLd.webPage({
            name: listing.title,
            url: `${base()}/listings/${listing.slug}`,
            description: (listing.summary || `${listing.title} on OpenVibe.Exchange`).slice(0, 160),
            siteUrl: base(),
        });
        return page(path, {
            index: true,
            title: listing.title,
            description: (listing.summary || `${listing.title} on OpenVibe.Exchange`).slice(0, 160),
            jsonLd: [jsonLd],
            body: raw(views.listingPage({
                listing, tests: listing.tests && listing.tests.rows ? listing.tests.rows : [],
                mine: false, staff: false, signedIn: false, activeInstall: null, trialPassed: false,
                offers: [], received: false, problem: null, notice: null,
            })),
        });
    }

    async function renderPublicPage(rawPath, { query } = {}) {
        const p = String(rawPath || '/').replace(/\/+$/, '') || '/';
        const q = query instanceof URLSearchParams ? query : new URLSearchParams();
        if (p === '/') return home('/');
        if (p === '/listings') return listings('/listings', q);
        const m = p.match(/^\/listings\/([A-Za-z0-9._~-]{1,80})$/);
        if (m) return listing(p, m[1]);
        if (p === '/safety') {
            return page(p, {
                index: true, title: 'Free and swap safety',
                description: 'OpenVibe.Exchange v1 has no money: free and swap only. Read the passport, meet safely, and revoke any time.',
                body: raw(views.safetyPage()),
            });
        }
        if (p === '/developers') {
            return page(p, {
                index: true, title: 'Build on OpenVibe.Exchange',
                description: 'The OpenVibe.Exchange JSON API, the permission passport, the sandbox, installs and the Search document.',
                body: raw(views.developersPage()),
            });
        }
        return null;
    }

    return { renderPublicPage };
}

module.exports = { createAgentPages };
