'use strict';

/**
 * Crawl artifacts for openvibe.exchange: robots.txt, sitemap.xml, llms.txt and llms-full.txt. Public listings are
 * for search engines and AI crawlers; sign-in, the API, the internal route and a non-listed listing are not. A
 * sitemap also lists every public listing page (/listings/<slug>).
 */
const fs = require('fs');
const path = require('path');
const seo = require('openvibe-shared/seo');
const cache = require('openvibe-shared/cache-policy');
const { asyncRouter } = require('./router');

const SITE_NAME = 'OpenVibe.Exchange';
const DESCRIPTION = 'OpenVibe.Exchange is the OpenVibe marketplace for what people make: agents, MCP tools, templates, themes, game assets and creator services, each with a permission passport, a sandbox and one-tap revocation. Free and swap only in v1.';
const DISALLOW = ['/auth/', '/api/', '/internal', '/metrics', '/sandbox/', '/installs', '/offers', '/submit'];

function dayOf(ts) {
    const m = String(ts == null ? '' : ts).match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : null;
}
function siteUpdated() {
    try { return dayOf(JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'STATUS.json'), 'utf8')).updated); } catch { return null; }
}

function homeJsonLd(config) {
    const site = String(config.baseUrl).replace(/\/+$/, '');
    return [
        seo.jsonLd.website({ name: SITE_NAME, url: site, description: DESCRIPTION }),
        seo.jsonLd.softwareApp({ name: SITE_NAME, url: site, description: DESCRIPTION, category: 'ShoppingApplication', keywords: 'openvibe exchange, marketplace, free and swap, permission passport, sandbox, install, revoke, templates, themes, game assets' }),
        seo.jsonLd.webPage({ name: SITE_NAME, url: `${site}/`, description: DESCRIPTION, siteUrl: site }),
    ];
}

function publicPages() {
    return [
        { path: '/', changefreq: 'daily', priority: 1.0, title: 'OpenVibe.Exchange home', text: 'Trade what people make: free and swap listings, each with a permission passport, a sandbox and one-tap revocation.' },
        { path: '/listings', changefreq: 'daily', priority: 0.9, title: 'All listings', text: 'Every public free and swap listing: agents, MCP tools, templates, themes, game assets and creator services.' },
        { path: '/safety', changefreq: 'monthly', priority: 0.6, title: 'Free and swap safety rules', text: 'No money, no prohibited items, read the passport, meet safely and revoke any time.' },
        { path: '/developers', changefreq: 'weekly', priority: 0.6, title: 'The OpenVibe.Exchange API', text: 'The JSON API, the passport, the sandbox, installs and the Search document.' },
    ];
}

function createDiscoveryRoutes(ctx) {
    const { config, s } = ctx;
    const r = asyncRouter();
    const site = String(config.baseUrl).replace(/\/+$/, '');
    const abs = (p) => `${site}${p}`;
    const TEXT = cache.htmlHeaders({ maxAge: 3600 });
    const pages = publicPages();

    r.get('/robots.txt', (_req, res) => {
        res.type('text/plain').set('Cache-Control', TEXT).send(
            '# openvibe.exchange: public listings are for search and AI crawlers; sign-in, the API and private routes are not.\n'
            + seo.robotsTxt({ sitemaps: [abs('/sitemap.xml')], disallow: DISALLOW }));
    });

    r.get('/llms.txt', (_req, res) => {
        res.type('text/plain').set('Cache-Control', TEXT).send(seo.llmsTxt({
            name: SITE_NAME,
            summary: 'OpenVibe.Exchange is the OpenVibe marketplace for what people make: agents, MCP tools, templates (Website, Report, Space), design themes and kits, game assets and creator services. Every public listing shows a permission passport (exactly what it can read, write, spend or contact), its licence, the conformance tests for that version, and a sandbox. A passed sandbox trial is required before an install; a revoke removes the installation in one tap. v1 is free and swap only: there is no money and a passport may not declare a spend.',
            details: 'GET /api/v1/listings lists public listings; GET /api/v1/listings/:slug adds the passport, manifest, licence, tests and counters; GET /api/v1/listings/:slug/passport is the exact passport an installer accepts. The sandbox is a manifest dry run in v1: Exchange does not execute a listing\'s code. Every public listing is one search.index-document@1 (owner exchange, type listing) queued in exchange_outbox.',
            sections: [
                { title: 'Start here', links: [
                    { title: 'OpenVibe.Exchange', url: abs('/'), note: 'free and swap listings' },
                    { title: 'All listings', url: abs('/listings') },
                    { title: 'Safety rules', url: abs('/safety') },
                    { title: 'The API', url: abs('/developers') },
                ] },
                { title: 'Machine-readable', links: [
                    { title: 'Public listings (JSON)', url: abs('/api/v1/listings') },
                    { title: 'Sitemap', url: abs('/sitemap.xml') },
                    { title: 'Full text for language models', url: abs('/llms-full.txt') },
                    { title: 'Release metadata (JSON)', url: abs('/release.json') },
                ] },
                { title: 'Elsewhere', links: [
                    { title: 'OpenVibe.Network', url: 'https://openvibe.network', note: 'accounts, staff roles and the grants a passport names' },
                    { title: 'OpenVibe.Run', url: 'https://openvibe.run', note: 'the sandbox that will execute a listing\'s tests' },
                    { title: 'OpenVibe.Search', url: 'https://openvibe.search', note: 'where public listings are indexed' },
                    { title: 'OpenVibe.Rent', url: 'https://openvibe.rent', note: 'the listings engine and local safety rules Exchange borrows' },
                ] },
            ],
        }));
    });

    r.get('/llms-full.txt', async (_req, res) => {
        const rows = await s.db.many("SELECT slug, title, summary, kind, mode, license FROM exchange_listings WHERE status = 'listed' ORDER BY listed_at DESC LIMIT 2000");
        const listings = rows.map((e) => ({ url: `/listings/${e.slug}`, title: e.title, text: [e.kind, e.mode, e.license, e.summary].filter(Boolean).join(' · ') }));
        res.type('text/plain').set('Cache-Control', TEXT).send(seo.llmsFull({
            site: SITE_NAME,
            summary: 'Every public page of OpenVibe.Exchange: the home, all listings, the safety rules, the API and every public listing.',
            base: site,
            maxBytes: 512 * 1024,
            sections: [
                { title: 'Pages', pages: pages.map((p) => ({ url: p.path, title: p.title, text: p.text })) },
                { title: 'Listings', pages: listings },
            ],
        }));
    });

    r.get('/sitemap.xml', async (_req, res) => {
        const lastmod = siteUpdated();
        const rows = await s.db.many("SELECT slug, updated_at FROM exchange_listings WHERE status = 'listed' ORDER BY slug LIMIT 5000");
        const urls = [
            ...pages.map((e) => ({ loc: abs(e.path), ...(lastmod ? { lastmod } : {}), changefreq: e.changefreq, priority: e.priority })),
            ...rows.map((e) => ({ loc: abs(`/listings/${e.slug}`), lastmod: dayOf(e.updated_at) || lastmod, changefreq: 'weekly', priority: 0.7 })),
        ];
        res.type('application/xml').set('Cache-Control', TEXT).send(seo.sitemapXml(urls));
    });

    return r;
}

module.exports = { createDiscoveryRoutes, homeJsonLd, publicPages, DESCRIPTION, SITE_NAME };
