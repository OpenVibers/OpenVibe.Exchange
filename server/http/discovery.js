'use strict';

/**
 * Crawl artifacts for openvibe.exchange: robots.txt, sitemap.xml, llms.txt and llms-full.txt. The public pages and
 * every model page are for search engines and AI crawlers; a chat, the sign-in, the internal route and the retired
 * v1 paths are not.
 */
const fs = require('fs');
const path = require('path');
const seo = require('openvibe-shared/seo');
const cache = require('openvibe-shared/cache-policy');
const { asyncRouter } = require('./router');

const SITE_NAME = 'OpenVibe.Exchange';
const DESCRIPTION = 'Every AI model, one account: live prices, speed and uptime of every offer, from the families on sale today and more as their providers join; chat with one model or three side by side; one OpenAI- and Anthropic-compatible endpoint.';
const DISALLOW = ['/auth/', '/api/', '/internal', '/metrics', '/chat', '/listings', '/submit', '/sandbox', '/installs', '/offers'];

const PUBLIC_PAGES = [
    { path: '/', changefreq: 'daily', priority: 1.0, title: 'OpenVibe.Exchange home', text: 'Every AI model, one account: live prices, speed and uptime, chat, and one endpoint.' },
    { path: '/models', changefreq: 'daily', priority: 0.9, title: 'Models', text: 'Every model with every offer that serves it: price in, out and cached per million tokens, measured p50 and p95 speed, uptime and data policy.' },
    { path: '/api', changefreq: 'weekly', priority: 0.7, title: 'The API', text: 'One OpenAI- and Anthropic-compatible endpoint, model ids, keys from Network and aggregate usage.' },
    { path: '/compute', changefreq: 'weekly', priority: 0.7, title: 'Compute prices', text: 'What an hour of a GPU or a computer costs at each provider: the reviewed tariff with its source, checked and review dates, as JSON at /api/compute/prices.' },
    { path: '/start', changefreq: 'weekly', priority: 0.8, title: 'Start building', text: 'One key and one endpoint: the OpenAI and Anthropic SDK samples, four steps to a first answer, OpenVibe.AI’s six operations, and the sandbox and production limits.' },
    { path: '/why', changefreq: 'weekly', priority: 0.7, title: 'Why this model', text: 'Every answer carries its receipt: what the router optimised, the offer that answered, every other candidate’s cost and latency, and why each was passed over.' },
    { path: '/faq', changefreq: 'weekly', priority: 0.6, title: 'Questions', text: 'The endpoint, the SDKs, keys, prices, privacy, the uncensored tier, selling compute, and the move of OpenVibe.AI’s public pages here.' },
    { path: '/sell', changefreq: 'weekly', priority: 0.6, title: 'Sell your compute', text: 'OpenVibe Link offers a GPU or a spare machine to the network for credits; what is not sold here, said plainly.' },
    { path: '/own', changefreq: 'weekly', priority: 0.6, title: 'Your own endpoint', text: 'A private GPU for one model or your own Hugging Face weights; only you reach it, it scales to zero when idle, and your Balance pays for the seconds it runs.' },
    { path: '/uncensored', changefreq: 'weekly', priority: 0.6, title: 'Uncensored', text: 'Abliterated models for adults, with the floor: no minors, no non-consensual content, no mass harm.' },
    { path: '/rankings', changefreq: 'daily', priority: 0.8, title: 'Rankings', text: 'Model rankings by task category from blind Arena votes, beside each model’s price per million, measured speed and uptime.' },
    { path: '/code', changefreq: 'daily', priority: 0.8, title: 'Code', text: 'GitHub repositories trending today, new and hot by stars gained, plus a deep repository search: read through OpenVibe.Sources.' },
    { path: '/ai', changefreq: 'daily', priority: 0.6, title: 'AI in OpenVibe', text: 'Which OpenVibe products run which models through the same router, and what each costs a day.' },
    { path: '/status', changefreq: 'hourly', priority: 0.5, title: 'Status', text: 'Uptime per offer, the model changelog, and incidents.' },
];

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
        seo.jsonLd.softwareApp({ name: SITE_NAME, url: site, description: DESCRIPTION, category: 'BusinessApplication', keywords: 'openvibe exchange, ai models, deepseek, qwen, kimi, glm, minimax, openrouter, api, chat, uncensored' }),
        seo.jsonLd.webPage({ name: SITE_NAME, url: `${site}/`, description: DESCRIPTION, siteUrl: site }),
    ];
}

function publicPages() { return PUBLIC_PAGES; }

function createDiscoveryRoutes(ctx) {
    const { config, ai } = ctx;
    const r = asyncRouter();
    const site = String(config.baseUrl).replace(/\/+$/, '');
    const abs = (p) => `${site}${p}`;
    const TEXT = cache.htmlHeaders({ maxAge: 3600 });
    const pages = publicPages();

    /**
     * The public character pages. Only cards that are public and rated for everyone: an 18+ card never
     * reaches a sitemap, llms.txt or any other public list.
     */
    async function characterPages() {
        if (!ctx.characters) return [];
        try {
            const gallery = await ctx.characters.gallery({ sort: 'new', limit: 500, allowAdult: false });
            return gallery.items.map((c) => ({
                path: '/c/' + encodeURIComponent(c.handle) + '/' + encodeURIComponent(c.slug),
                title: c.name,
                text: String(c.description || c.name).slice(0, 160),
                changefreq: 'weekly',
                priority: 0.5,
            }));
        } catch (e) { return []; }
    }

    async function modelPages() {
        const [catalog, directory] = await Promise.all([ai.catalog(), ai.directory?.() || { models: [] }]);
        const active = new Set((catalog.models || []).map(m => m.slug));
        return [...(catalog.models || []).slice(0, 5000).map((m) => ({
            path: `/m/${m.slug.split('/').map(encodeURIComponent).join('/')}`,
            title: m.name,
            text: `${m.family} · ${m.offers.length} offers${m.uncensored ? ' · 18+' : ''}`,
            changefreq: 'daily', priority: 0.7,
        })), ...(directory.models || []).filter(m => !active.has(m.id)).slice(0, 5000).map(m => ({
            path: require('../model-directory').href(m.id), title: m.name,
            text: `${m.provider_name || m.provider} · ${m.status} · ${m.context_window || 'unknown'} context`,
            changefreq: m.status === 'retired' ? 'monthly' : 'daily', priority: 0.5,
        }))];
    }

    r.get('/robots.txt', (_req, res) => {
        res.type('text/plain').set('Cache-Control', TEXT).send(
            '# openvibe.exchange: the models and their prices are for search and AI crawlers; a chat, sign-in and the retired v1 paths are not.\n'
            + seo.robotsTxt({ sitemaps: [abs('/sitemap.xml')], disallow: DISALLOW })
            + `# Agent manifest: ${abs('/.well-known/agent.json')}\n`);
    });

    r.get('/llms.txt', async (_req, res) => {
        let models = [];
        let characters = [];
        try { models = await modelPages(); } catch (e) { models = []; }
        try { characters = await characterPages(); } catch (e) { characters = []; }
        res.type('text/plain').set('Cache-Control', TEXT).send(seo.llmsTxt({
            name: SITE_NAME,
            summary: DESCRIPTION,
            details: 'Prices are read live from OpenVibe.AI and are the offer\'s own, per million tokens. The API is OpenAI-compatible at https://api.openvibe.exchange/v1/chat/completions and Anthropic-compatible at /v1/messages; model ids are deepseek/deepseek-chat and their families, or openvibe/auto to let the router pick by floor, ceiling and policy. A small free daily allowance comes with an account. GitHub repositories are read through OpenVibe.Sources and served at /api/v1/code/repos and /api/v1/code/search; nothing is invented when the source is behind.',
            markdown: true,
            base: site,
            sections: [
                { title: 'Start here', links: [
                    { title: 'OpenVibe.Exchange', url: abs('/'), note: 'every model, one account' },
                    { title: 'Models', url: abs('/models'), note: 'prices and measured latency' },
                    { title: 'Rankings', url: abs('/rankings'), note: 'blind Arena votes by task, beside price and speed' },
                    { title: 'Code', url: abs('/code'), note: 'GitHub trending, hot and new repositories, and a deep search' },
                    { title: 'The API', url: abs('/api') },
                    { title: 'Compute prices', url: abs('/compute'), note: 'GPUs and computers per hour; JSON at /api/compute/prices' },
                    { title: 'Code repositories API', url: abs('/api/v1/code/repos?list=week'), note: 'cached GitHub rankings from Sources; search at /api/v1/code/search?q=stars:>500' },
                    { title: 'Start building', url: abs('/start') },
                    { title: 'Why this model', url: abs('/why') },
                    { title: 'Questions', url: abs('/faq') },
                    { title: 'Sell your compute', url: abs('/sell') },
                    { title: 'Uncensored (18+)', url: abs('/uncensored') },
                    { title: 'AI in OpenVibe', url: abs('/ai') },
                ] },
                { title: 'Characters', links: [{ title: 'The gallery', url: abs('/companions'), note: 'character cards' }, ...characters.slice(0, 40).map((c) => ({ title: c.title, url: abs(c.path), note: c.text }))] },
                { title: 'Models', links: models.slice(0, 60).map((m) => ({ title: m.title, url: abs(m.path), note: m.text })) },
            ],
            optional: [
                { title: 'Sitemap', url: abs('/sitemap.xml') },
                { title: 'Full text for language models', url: abs('/llms-full.txt') },
                { title: 'Release metadata (JSON)', url: abs('/release.json') },
                { title: 'AI router API', url: 'https://ai.openvibe.services', note: 'the API and run receipts' },
                { title: 'Your keys and accounts', url: abs('/privacy/keys'), note: 'manage your own provider keys and supported browser session cookies' },
                { title: 'OpenVibe Link', url: 'https://openvibe.link', note: 'offer a machine to the network' },
            ],
        }));
    });

    r.get('/llms-full.txt', async (_req, res) => {
        let modelPageRows = [];
        let characterRows = [];
        try { modelPageRows = await modelPages(); } catch (e) { modelPageRows = []; }
        try { characterRows = await characterPages(); } catch (e) { characterRows = []; }
        res.type('text/plain').set('Cache-Control', TEXT).send(seo.llmsFull({
            site: SITE_NAME,
            summary: 'Every public page of OpenVibe.Exchange: the home, the models, the API, selling compute, the uncensored tier and AI in OpenVibe.',
            base: site,
            maxBytes: 512 * 1024,
            sections: [{ title: 'Pages', pages: [...pages, ...modelPageRows, ...characterRows].map((p) => ({ url: p.path, title: p.title, text: p.text })) }],
        }));
    });

    r.get('/sitemap.xml', async (_req, res) => {
        const lastmod = siteUpdated();
        let rows = [];
        let characters = [];
        try { rows = await modelPages(); } catch (e) { rows = []; }
        try { characters = await characterPages(); } catch (e) { characters = []; }
        const urls = [
            ...pages.map((e) => ({ loc: abs(e.path), ...(lastmod ? { lastmod } : {}), changefreq: e.changefreq, priority: e.priority })),
            ...rows.map((e) => ({ loc: abs(e.path), ...(lastmod ? { lastmod } : {}), changefreq: e.changefreq, priority: e.priority })),
            ...characters.map((e) => ({ loc: abs(e.path), ...(lastmod ? { lastmod } : {}), changefreq: e.changefreq, priority: e.priority })),
        ];
        res.type('application/xml').set('Cache-Control', TEXT).send(seo.sitemapXml(urls));
    });

    return r;
}

module.exports = { createDiscoveryRoutes, homeJsonLd, publicPages, DESCRIPTION, SITE_NAME, PUBLIC_PAGES };
