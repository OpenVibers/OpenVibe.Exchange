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
const DESCRIPTION = 'Every AI model, one account: live prices, speed and uptime for DeepSeek, Qwen, Kimi, GLM, MiniMax, Llama and the uncensored builds; chat with one model or three side by side; one OpenAI- and Anthropic-compatible endpoint.';
const DISALLOW = ['/auth/', '/api/', '/internal', '/metrics', '/chat', '/listings', '/submit', '/sandbox', '/installs', '/offers'];

const PUBLIC_PAGES = [
    { path: '/', changefreq: 'daily', priority: 1.0, title: 'OpenVibe.Exchange home', text: 'Every AI model, one account: live prices, speed and uptime, chat, and one endpoint.' },
    { path: '/models', changefreq: 'daily', priority: 0.9, title: 'Models', text: 'Every model with every offer that serves it: price in and out per million tokens, speed, uptime and data policy.' },
    { path: '/api', changefreq: 'weekly', priority: 0.7, title: 'The API', text: 'One OpenAI- and Anthropic-compatible endpoint, model ids, keys from Network and aggregate usage.' },
    { path: '/sell', changefreq: 'weekly', priority: 0.6, title: 'Sell your compute', text: 'OpenVibe Node offers a GPU or a spare machine to the network for credits; what is not sold here, said plainly.' },
    { path: '/uncensored', changefreq: 'weekly', priority: 0.6, title: 'Uncensored', text: 'Abliterated models for adults, with the floor: no minors, no non-consensual content, no mass harm.' },
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

    async function modelPages() {
        const catalog = await ai.catalog();
        return (catalog.models || []).slice(0, 5000).map((m) => ({
            path: `/m/${m.slug.split('/').map(encodeURIComponent).join('/')}`,
            title: m.name,
            text: `${m.family} · ${m.offers.length} offers${m.uncensored ? ' · 18+' : ''}`,
            changefreq: 'daily', priority: 0.7,
        }));
    }

    r.get('/robots.txt', (_req, res) => {
        res.type('text/plain').set('Cache-Control', TEXT).send(
            '# openvibe.exchange: the models and their prices are for search and AI crawlers; a chat, sign-in and the retired v1 paths are not.\n'
            + seo.robotsTxt({ sitemaps: [abs('/sitemap.xml')], disallow: DISALLOW })
            + `# Agent manifest: ${abs('/.well-known/agent.json')}\n`);
    });

    r.get('/llms.txt', async (_req, res) => {
        let models = [];
        try { models = (await ai.catalog()).models || []; } catch (e) { models = []; }
        res.type('text/plain').set('Cache-Control', TEXT).send(seo.llmsTxt({
            name: SITE_NAME,
            summary: DESCRIPTION,
            details: 'Prices are read live from OpenVibe.AI and are the offer\'s own, per million tokens. The API is OpenAI-compatible at https://api.openvibe.exchange/v1/chat/completions and Anthropic-compatible at /v1/messages; model ids are deepseek/deepseek-chat and their families, or openvibe/auto to let the router pick by floor, ceiling and policy. A small free daily allowance comes with an account.',
            markdown: true,
            base: site,
            sections: [
                { title: 'Start here', links: [
                    { title: 'OpenVibe.Exchange', url: abs('/'), note: 'every model, one account' },
                    { title: 'Models', url: abs('/models') },
                    { title: 'The API', url: abs('/api') },
                    { title: 'Sell your compute', url: abs('/sell') },
                    { title: 'Uncensored (18+)', url: abs('/uncensored') },
                    { title: 'AI in OpenVibe', url: abs('/ai') },
                ] },
                { title: 'Models', links: models.slice(0, 60).map((m) => ({
                    title: m.name, url: abs(`/m/${m.slug.split('/').map(encodeURIComponent).join('/')}`),
                    note: [m.family, m.uncensored ? '18+' : null, m.offers.length ? `${m.offers.length} offers` : null].filter(Boolean).join(' · '),
                })) },
            ],
            optional: [
                { title: 'Sitemap', url: abs('/sitemap.xml') },
                { title: 'Full text for language models', url: abs('/llms-full.txt') },
                { title: 'Release metadata (JSON)', url: abs('/release.json') },
                { title: 'OpenVibe.AI', url: 'https://ai.openvibe.services', note: 'the router and the run API every product uses' },
                { title: 'OpenVibe.Node', url: 'https://node.openvibe.network', note: 'offer a machine to the network' },
            ],
        }));
    });

    r.get('/llms-full.txt', async (_req, res) => {
        let modelPageRows = [];
        try { modelPageRows = await modelPages(); } catch (e) { modelPageRows = []; }
        res.type('text/plain').set('Cache-Control', TEXT).send(seo.llmsFull({
            site: SITE_NAME,
            summary: 'Every public page of OpenVibe.Exchange: the home, the models, the API, selling compute, the uncensored tier and AI in OpenVibe.',
            base: site,
            maxBytes: 512 * 1024,
            sections: [{ title: 'Pages', pages: [...pages, ...modelPageRows].map((p) => ({ url: p.path, title: p.title, text: p.text })) }],
        }));
    });

    r.get('/sitemap.xml', async (_req, res) => {
        const lastmod = siteUpdated();
        let rows = [];
        try { rows = await modelPages(); } catch (e) { rows = []; }
        const urls = [
            ...pages.map((e) => ({ loc: abs(e.path), ...(lastmod ? { lastmod } : {}), changefreq: e.changefreq, priority: e.priority })),
            ...rows.map((e) => ({ loc: abs(e.path), ...(lastmod ? { lastmod } : {}), changefreq: e.changefreq, priority: e.priority })),
        ];
        res.type('application/xml').set('Cache-Control', TEXT).send(seo.sitemapXml(urls));
    });

    return r;
}

module.exports = { createDiscoveryRoutes, homeJsonLd, publicPages, DESCRIPTION, SITE_NAME, PUBLIC_PAGES };
