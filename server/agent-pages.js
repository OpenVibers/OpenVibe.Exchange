'use strict';
// The public pages the agent layer serves as Markdown twins (openvibe-shared/agent-layer). Each twin is the page's
// own render through the same views and layout the HTML routes use, always signed out: a chat, a try box and the
// 18+ confirmation never appear in a twin.
const views = require('./views/exchange');
const { raw } = require('./render/html');
const { renderPage } = require('./render/layout');
const { homeJsonLd } = require('./http/discovery');

const HOME_DESCRIPTION = 'OpenVibe.Exchange: every AI model, one account. Live prices, speed and uptime of every offer, from the families on sale today and more as their providers join; chat with one model or three side by side; one OpenAI- and Anthropic-compatible endpoint.';

function createAgentPages(ctx) {
    const { config, ai } = ctx;
    const page = (path, o) => ({ html: renderPage({ viewer: { kind: 'anonymous' }, config, path, agentLayer: true, ...o }), title: o.title });

    async function home(path) {
        const [catalog, usage] = await Promise.all([ai.catalog(), ai.usage(30)]);
        return page(path, {
            index: true, title: null, description: HOME_DESCRIPTION, jsonLd: homeJsonLd(config),
            body: raw(views.home({ catalog, usage, viewer: { kind: 'anonymous' } })),
        });
    }

    async function renderPublicPage(rawPath, { query } = {}) {
        const p = String(rawPath || '/').replace(/\/+$/, '') || '/';
        const q = query instanceof URLSearchParams ? query : new URLSearchParams();
        if (p === '/') return home('/');
        if (p === '/models') {
            const catalog = await ai.catalog();
            return page(p, { index: true, title: 'Models', description: 'Every model with its live offers: price, speed, uptime, context and data policy.', body: raw(views.modelsPage({ catalog, q: q.get('q') || '', family: q.get('family') || '', sort: q.get('sort') || '' })) });
        }
        const m = p.match(/^\/m\/([A-Za-z0-9._~-]{1,80})\/([A-Za-z0-9._~:-]{1,120})$/);
        if (m) {
            const catalog = await ai.catalog();
            const model = (catalog.models || []).find((x) => x.slug === `${m[1].toLowerCase()}/${m[2].toLowerCase()}`);
            if (!model) return null;
            return page(p, { index: true, title: model.name, description: `${model.name}: price, speed, uptime and data policy of every offer.`, body: raw(views.modelPage({ model, viewer: { kind: 'anonymous' }, adult: false })) });
        }
        if (p === '/api') {
            const [catalog, usage] = await Promise.all([ai.catalog(), ai.usage(30)]);
            return page(p, { index: true, title: 'The API', description: 'One OpenAI- and Anthropic-compatible endpoint for every model.', body: raw(views.apiPage({ catalog, usage })) });
        }
        if (p === '/sell') {
            const [catalog, usage] = await Promise.all([ai.catalog(), ai.usage(30)]);
            return page(p, { index: true, title: 'Sell your compute', description: 'Turn a GPU or a spare machine into credits with OpenVibe Node.', body: raw(views.sellPage({ catalog, usage })) });
        }
        if (p === '/uncensored') {
            const catalog = await ai.catalog();
            return page(p, { index: true, title: 'Uncensored', description: 'Abliterated models for adults, with the floor.', body: raw(views.uncensoredPage({ catalog, adult: false, signedIn: false })) });
        }
        if (p === '/ai') {
            const [catalog, usage] = await Promise.all([ai.catalog(), ai.usage(30)]);
            return page(p, { index: true, title: 'AI in OpenVibe', description: 'Which OpenVibe products use which models, and what each costs a day.', body: raw(views.aiPage({ catalog, usage })) });
        }
        if (p === '/status') {
            const [catalog, usage] = await Promise.all([ai.catalog(), ai.usage(30)]);
            return page(p, { index: true, title: 'Status', description: 'Uptime per offer, the model changelog, and incidents.', body: raw(views.statusPage({ catalog, usage })) });
        }
        return null;
    }

    return { renderPublicPage };
}

module.exports = { createAgentPages };
