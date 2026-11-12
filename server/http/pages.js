'use strict';

/**
 * Exchange's server-rendered pages. They work without JavaScript: every form is a plain POST, every link a
 * real link, and a chat is one page each.
 *
 *   /                       live numbers, popular, cheapest, uncensored, community, the endpoint
 *   /models                 browse and filter; /m/:org/:model one model, its offers, Try it, curl and SDK
 *   /chat                   the shared conversation UI (openvibe-shared/thread), 1-3 models side by side
 *   /api                    the endpoint, keys, model ids, usage
 *   /sell                   Node's "Offer to the network", the dashboard, what is not sold
 *   /uncensored             the 18+ gate, the floor, the abliterated models
 *   /ai                     which products run which models, and what each costs a day
 *
 * Exchange v1 (listings, sandboxes, installs, offers) answers 410 with a pointer. Its tables stay read-only.
 */
const express = require('express');
const seo = require('openvibe-shared/seo');
const cache = require('openvibe-shared/cache-policy');
const kit = require('openvibe-shared/kit');
const thread = require('openvibe-shared/thread');
const ovServe = require('openvibe-shared/serve');
const { asyncRouter } = require('./router');
const { createDiscoveryRoutes, homeJsonLd } = require('./discovery');
const { sameOrigin } = require('./principal');
const { esc, raw } = require('../render/html');
const marks = require('../views/marks');
const { send } = require('../render/layout');
const views = require('../views/exchange');
const platform = require('../views/platform');
const credentialViews = require('../views/credentials');

const PUBLIC_CACHE = cache.htmlHeaders({ maxAge: 60 });
const COMPOSER_HEAD = raw(`<link rel="stylesheet" href="${ovServe.url('thread.css')}"><script src="${ovServe.url('ov-composer.js')}" defer></script>`);
const RETIRED_PATHS = ['/listings', '/listings/*', '/submit', '/sandbox', '/sandbox/*', '/installs', '/offers', '/safety', '/developers'];

const textOf = (s) => esc(String(s || '')).replace(/\n/g, '<br>');

function createPageRoutes(ctx) {
    const { config, ai, network, history, openapi, chats, adult, sharing, log } = ctx;
    const r = asyncRouter();
    r.use(express.urlencoded({ extended: false, limit: '64kb' }));
    const page = (req, res, o, status = 200) => send(res, status, { viewer: req.viewer, config, path: req.originalUrl, ...o });
    const signedIn = (req) => Boolean(req.viewer && req.viewer.kind === 'user' && req.viewer.subject);
    const owner = (req) => req.viewer.subject;
    const notFromHere = (req, res) => page(req, res, { title: 'Not from this site', index: false, body: raw(`<div class="ex-wrap ex-narrow">${kit.empty({ icon: 'shield', title: 'That came from somewhere else', text: 'Use the form on OpenVibe.Exchange.' })}</div>`) }, 403);
    const credentialPage = async (req, res, { error = null, balance = null } = {}, status = 200) => {
        let credentials = [];
        try {
            const out = ai.credentialsFor
                ? await ai.credentialsFor(req.viewer.token).list()
                : await ai.meRequest(req.viewer.token, '/api/v1/me/credentials');
            credentials = Array.isArray(out.credentials) ? out.credentials : [];
        } catch (err) { error = error || 'OpenVibe.AI could not read your credential list.'; status = err.status === 401 ? 401 : 502; }
        return page(req, res, { title: 'Your keys and accounts', index: false, body: raw(credentialViews.credentialsPage({ credentials, error, balance })) }, status);
    };
    const credentialFailure = (err, secrets = []) => {
        let message = err && err.status === 422 ? (err.message || 'The credential was not accepted.') : 'OpenVibe.AI could not complete that credential request.';
        for (const secret of secrets) if (secret) message = message.split(String(secret)).join('[hidden]');
        return message;
    };
    const signInPage = (req, res, { title, text, next, status = 401 }) => page(req, res, {
        title, index: false,
        body: raw(`<div class="ex-wrap ex-narrow">${kit.empty({ icon: 'person', title, text, action: { href: `/auth/login?next=${encodeURIComponent(next || req.originalUrl)}`, label: 'Sign in with OpenVibe' } })}</div>`),
    }, status);
    // The live community offers (AI's public read): a pool says how many machines serve it, never which ones.
    const communityOffers = async () => (typeof ai.communityOffers === 'function' ? ai.communityOffers() : null);
    // The catalogue is also the day's changelog row: the first read of a UTC day records what every model
    // costs, so /status can say what is new, gone or repriced without keeping a second catalogue.
    const catalogOf = async () => {
        const catalog = await ai.catalog();
        await history.capture(catalog).catch((err) => log.warn('[OpenVibe.Exchange] catalogue snapshot failed:', err.message));
        return catalog;
    };
    const directoryOf = async () => typeof ai.directory === 'function' ? ai.directory() : { models: [] };

    r.get('/compute', (req, res) => {
        const { prices, checked_at } = require('../compute-prices');
        return page(req, res, { title: 'Compute prices', description: 'What an hour of a computer or a GPU costs at Baseten, Daytona, E2B, Fly.io and RunPod: base compute, checked weekly.', body: raw(platform.computePage({ prices, checked_at })) });
    });

    // ── Exchange v1, retired ──────────────────────────────────
    function retiredHandler(req, res) {
        res.set('Cache-Control', 'public, max-age=86400');
        res.set('X-Robots-Tag', 'noindex');
        return page(req, res, {
            title: 'Retired', index: false,
            description: 'Exchange v1 is retired. Every AI model, one account.',
            body: raw(views.retired(req.path)),
        }, 410);
    }
    for (const p of RETIRED_PATHS) { r.get(p, retiredHandler); r.post(p, retiredHandler); }

    // ── /openapi.json: the API host's document, as every OpenVibe site serves one ──
    r.get('/openapi.json', async (req, res) => {
        const { doc, stale } = await openapi();
        res.status(200)
            .type('application/json')
            .set('Cache-Control', `public, max-age=${stale ? 60 : Math.floor(config.api.openapiCacheMs / 1000)}`)
            .send(JSON.stringify(doc));
    });

    r.get('/pricing', (req, res) => page(req, res, { title: 'Pricing', description: 'What a call to OpenVibe.Exchange costs: your own key at 0%, managed models at their listed price, your own endpoint by the hour, search per 1,000.', body: raw(platform.pricingPage()) }));
    r.get('/docs', (req,res) => res.redirect(301,'/api'));
    r.get('/docs/migrate', (req,res) => page(req,res,{title:'Migrate to Exchange', description:'Move an OpenAI or Anthropic client to Exchange, validate routing and inspect API receipts.', jsonLd:[{'@context':'https://schema.org','@type':'TechArticle',headline:'Move your application to Exchange',url:'https://openvibe.exchange/docs/migrate'}], body:raw(require('../views/migration').migrationPage())}));

    // ── Home ─────────────────────────────────────────────────
    r.get('/', async (req, res) => {
        const [catalog, usage] = await Promise.all([catalogOf(), ai.usage(7)]);
        const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 120) : '';
        return page(req, res, {
            index: true, cache: PUBLIC_CACHE, agentLayer: true,
            title: null,
            description: 'Every AI model, one account: live prices, speed and uptime of every offer, from the families on sale today and more as their providers join. Chat, or call one OpenAI-compatible endpoint.',
            jsonLd: homeJsonLd(config),
            head: COMPOSER_HEAD,
            body: raw(platform.home({ catalog, usage, viewer: req.viewer, q, config })),
        });
    });

    // ── Models ───────────────────────────────────────────────
    r.get('/models', async (req, res) => {
        const [catalog, community, directory] = await Promise.all([catalogOf(), communityOffers(), directoryOf()]);
        const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 120) : '';
        const family = typeof req.query.family === 'string' ? req.query.family.slice(0, 60) : '';
        const sort = ['cheap', 'fast'].includes(req.query.sort) ? req.query.sort : '';
        let searchResults = null;
        if (q || req.query.capability || req.query.provider || req.query.max_price || req.query.min_price || req.query.max_speed_ms || req.query.rating_kind) {
            const { parseSearch, searchCatalog } = require('../model-search');
            try {
                const params = parseSearch(req.query);
                const board = await ctx.bench.board({ kind: params.ratingKind }).catch(() => ({ rows: [] }));
                searchResults = searchCatalog(catalog, board.rows || [], params);
            } catch (err) {
                if (err instanceof RangeError) return page(req, res, { title: 'Invalid search', body: raw(`<p>${esc(err.message)}</p>`) }, 400);
                throw err;
            }
        }
        return page(req, res, {
            index: true, cache: PUBLIC_CACHE, agentLayer: true,
            title: q ? `Models: ${q}` : 'Models',
            description: 'Every model on OpenVibe.Exchange with its live offers: price in and out per million tokens, measured speed and uptime, context length and data policy.',
            head: COMPOSER_HEAD,
            body: raw(platform.modelsPage({ catalog: req.query.status && req.query.status !== 'available' ? { ...catalog, models: [] } : catalog, query: req.query, searchResults })
                + require('../model-directory').directoryList(directory.models || [], req.query, (catalog.models || []).map(m => m.slug))),
        });
    });

    async function modelFrom(catalog, org, model) {
        const slug = `${String(org || '').toLowerCase()}/${String(model || '').toLowerCase()}`;
        return (catalog.models || []).find((m) => m.slug === slug) || null;
    }
    const modelPath = (m) => `/m/${m.slug.split('/').map(encodeURIComponent).join('/')}`;

    async function renderModel(req, res, { result = null, problem = null, text = '', status = 200 } = {}) {
        const [catalog, community] = await Promise.all([catalogOf(), communityOffers()]);
        const model = await modelFrom(catalog, req.params.org, req.params.model);
        if (!model) {
            const directory = await directoryOf();
            const id = `${req.params.org}/${req.params.model}`.toLowerCase();
            const listed = (directory.models || []).find(m => m.id.toLowerCase() === id);
            if (listed) return page(req, res, { index: true, cache: PUBLIC_CACHE, title: listed.name,
                description: `${listed.name}: status, limits, dated prices and sources.`,
                jsonLd: [{ '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: listed.name,
                    url: `${config.baseUrl}${require('../model-directory').href(listed.id)}` }],
                body: raw(require('../model-directory').directoryDetail(listed)) });
            if (catalog.unavailable) {
                return page(req, res, { title: 'Models are not available', index: false, body: raw(`<div class="ex-wrap ex-narrow">${kit.notice({ kind: 'warn', text: 'The live catalog is not reachable right now. Reload in a moment.' })}<p><a href="/models">All models</a></p></div>`) }, 503);
            }
            return page(req, res, { title: 'Not found', index: false, body: raw(`<div class="ex-wrap ex-narrow">${kit.empty({ icon: 'search', title: 'No such model', text: `Nothing here serves ${esc(`${req.params.org}/${req.params.model}`)}. <a href="/models">Browse the models</a>.` })}</div>`) }, 404);
        }
        const isAdult = signedIn(req) ? await adult.confirmed(owner(req)) : false;
        let analysis = null;
        try { analysis = await ctx.analysis.model(model, { rating_kind: typeof req.query.rating_kind === 'string' ? req.query.rating_kind : 'chat.arena' }); }
        catch (err) { log.warn('[exchange] model analysis unavailable: ' + String(err.message || err).slice(0, 160)); }
        const jsonLd = seo.jsonLd.webPage({
            name: `${model.name} on OpenVibe.Exchange`, url: `${config.baseUrl}${modelPath(model)}`,
            description: `${model.name}: ${model.offers.length} live offers with price, speed and uptime.`.slice(0, 160), siteUrl: config.baseUrl,
        });
        return page(req, res, {
            index: true, cache: req.method === 'GET' ? PUBLIC_CACHE : null, agentLayer: true,
            title: model.name, description: `${model.name}: price, speed, uptime and data policy of every offer.`,
            jsonLd: [jsonLd, { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: model.name,
                url: `${config.baseUrl}${modelPath(model)}`, description: `${model.name}: context, model limits, price and available providers.`,
                applicationCategory: 'DeveloperApplication' }], head: '',
            body: raw(views.modelPage({ model, viewer: req.viewer, result, problem, text, adult: isAdult, community, analysis })),
        }, status);
    }

    r.get('/models/:id', (req, res) => { const parts = req.params.id.split('/'); req.params.org = parts.shift(); req.params.model = parts.join('/'); return renderModel(req, res); });
    r.get('/models/:org/:model', (req, res) => renderModel(req, res));
    r.get('/m/:org/:model', (req, res) => renderModel(req, res));
    r.post('/m/:org/:model/try', (req, res) => res.redirect(301,
        `https://openvibe.chat/vibe?models=${encodeURIComponent(`${req.params.org}/${req.params.model}`)}`));

    // ── Chat ─────────────────────────────────────────────────
    async function chatCatalog() {
        const catalog = await catalogOf();
        const notChat = new Set(['embedding', 'embeddings', 'stt', 'asr', 'tts', 'speech', 'image', 'images', 'rerank', 'moderation']);
        const models = (catalog.models || []).filter((m) => !notChat.has(String(m.kind || m.type || 'chat').toLowerCase()));
        // AI says when no chat model can serve the free allowance right now (free_available false).
        models.freePaused = catalog.free_available === false;
        return { catalog, models };
    }
    const modelOptions = (models, selected) => models.slice(0, 40).map((m) => [m.slug, m.name + (m.uncensored ? ' · 18+' : '') + ((m.offers || []).some((o) => (o.free_now !== undefined ? o.free_now === true : o.free_tier === true)) ? ' · Free to try' : ''), (selected || []).includes(m.slug)]);

    function chatSidebar(chats, current) {
        const items = chats.map((c) => ({ href: `/chat/${c.id}`, title: c.title, current: c.id === current, at: c.updated_at }));
        return thread.sidebar({
            newHref: '/chat/new', newLabel: 'New chat', findAction: '/chat', findPlaceholder: 'Find a chat',
            groups: thread.group(items.sort((a, b) => String(b.at).localeCompare(String(a.at))), (c) => c.at || Date.now()),
            nav: [
                { href: '/chat/new?sealed=1', label: 'A sealed chat', icon: 'shield' },
                { href: '/models', label: 'Models', icon: 'spark' },
                { href: '/arena', label: 'The Arena', icon: 'spark' },
                { href: '/rankings', label: 'Rankings', icon: 'trophy' },
                { href: '/api', label: 'API', icon: 'code' },
                { href: '/ai', label: 'AI in OpenVibe', icon: 'gear' },
            ],
        });
    }

    function composerFor({ chat = null, models, problem = null, action = '/chat/send' }) {
        const selected = chat && chat.models.length ? chat.models : models.slice(0, 1).map((m) => m.slug);
        const strict = Boolean(chat && chat.strict_privacy);
        // The model you are talking to is said on the fold itself, so the main choice is seen without opening it.
        const nameOf = (slug) => { const m = models.find((x) => x.slug === slug); return m ? m.name : slug; };
        const talking = selected.slice(0, 3).map(nameOf).filter(Boolean);
        const settings = `<details class="ovt-settings"><summary>${talking.length ? `<b>${esc(talking.join(' · '))}</b> · change models, system prompt, temperature` : 'Models, system prompt and temperature'}</summary>
<div class="ovt-settings-body">
${kit.chips({ name: 'models', label: 'Compare up to three models', options: modelOptions(models, selected), single: false })}
<label class="ex-label" for="sys">System prompt (optional)</label>
<textarea id="sys" name="system" rows="2" maxlength="4000">${esc((chat && chat.system_prompt) || '')}</textarea>
<label class="ex-label" for="temp">Temperature <span class="ex-muted">0 to 2</span></label>
<input id="temp" name="temperature" type="number" min="0" max="2" step="0.1" value="${chat && chat.temperature != null ? esc(chat.temperature) : ''}">
<label class="ex-check ovk-check"><input type="checkbox" name="strict_privacy" value="1"${strict ? ' checked' : ''}> <span>Strict privacy: only offers that keep nothing and train on nothing</span></label>
<p class="ex-muted ex-small">With strict privacy on, the router refuses when no private offer can answer, instead of falling back to one that keeps or trains on your prompt.</p>
</div></details>${problem ? kit.notice({ kind: 'error', text: problem }) : ''}`;
        return thread.composer({
            action, name: 'text', placeholder: 'Ask anything…', top: settings, maxlength: config.chat.maxChars,
            hidden: { chat: chat ? chat.id : '' },
            note: models.freePaused
                ? `Free messages are paused right now: the free model\u2019s provider is out of credit. Your own key or Balance still works. Each message may run up to ${config.chat.models} models.`
                : `Your free daily allowance. Models marked Free to try run on it; other models need your own balance or key. Each message may run up to ${config.chat.models} models.`,
            starters: chat ? [] : ['Explain the difference between a mutex and a semaphore', 'Write a Python function that reads a CSV and sums a column', 'Which of you is cheaper for this?'],
        });
    }

    /** One turn's answers side by side: each column is the model, its price and latency, its answer and a folded receipt. */
    function answerRound(list, bySlug) {
        const cells = list.map((m) => {
            const model = bySlug.get(m.model);
            const cost = m.meta && m.meta.cost_usd;
            const latency = m.meta && m.meta.latency_ms;
            const asked = model ? model.name : (m.meta && m.meta.answered_model) || m.model || 'OpenVibe';
            const head = `<header class="ex-answer-head">${marks.mark(model ? model.family : 'Other', { size: 22, label: false })}<b>${esc(asked)}</b><span class="ex-answer-cost">${cost == null ? '—' : Number(cost) === 0 ? 'free' : `$${Number(cost).toFixed(6)}`}${latency == null ? '' : ` · ${latency < 1000 ? `${Math.round(latency)} ms` : `${(latency / 1000).toFixed(1)} s`}`}</span></header>`;
            const body = m.error
                ? thread.card({ tone: 'bad', title: 'Did not answer', text: m.error })
                : thread.answer({ html: textOf(m.content), meta: [] });
            const pv = m.meta && m.meta.privacy
                ? views.answerPrivacy({ privacy: m.meta.privacy, privacy_detail: m.meta.privacy_detail })
                : null;
            const receipt = `<details class="ex-receipt"><summary>Receipt</summary><dl>
<dt>Offer</dt><dd>${esc(m.meta && m.meta.provider ? views.providerLabel({ provider: m.meta.provider }) : '—')}${m.meta && m.meta.answered_model ? ` · ${esc(m.meta.answered_model)}` : ''}</dd>
<dt>Privacy</dt><dd>${pv ? `${kit.badge(pv.label, pv.kind)}${pv.facts ? ` · ${esc(pv.facts)}` : ''}` : '—'}</dd>
${m.meta && m.meta.preset ? `<dt>Preset</dt><dd>${esc(m.meta.preset)}</dd>` : ''}
<dt>Price</dt><dd>${cost == null ? '—' : Number(cost) === 0 ? 'free' : `$${Number(cost).toFixed(6)}`}</dd>
<dt>Tokens</dt><dd>${m.meta && (m.meta.tokens_in != null || m.meta.tokens_out != null) ? `${Number(m.meta.tokens_in || 0).toLocaleString('en-US')} in · ${Number(m.meta.tokens_out || 0).toLocaleString('en-US')} out` : '—'}</dd>
${m.meta && m.meta.cached_input_percent != null ? `<dt>Cached input</dt><dd>${Number(m.meta.cached_input_percent)}% (${Number(m.meta.tokens_cached || 0).toLocaleString('en-US')} tokens)</dd>` : ''}
<dt>Latency</dt><dd>${latency == null ? '—' : `${Number(latency).toLocaleString('en-US')} ms`}</dd>
<dt>Why this offer</dt><dd>${m.meta && Array.isArray(m.meta.why) && m.meta.why.length ? esc(m.meta.why.join(' · ')) : 'The router picked the healthiest offer for your floor, ceiling and policy.'}</dd>
</dl></details>`;
            return `<article class="ex-answer-col">${head}${body}${receipt}</article>`;
        }).join('');
        return `<li class="ovt-turn ex-round"><div class="ex-answer-grid" data-count="${list.length}">${cells}</div></li>`;
    }

    // ── The one Share sheet (openvibe-shared ov-share.js) ────────────────────
    const shareHead = `<link rel="stylesheet" href="${ovServe.url('ov-share.css')}"><script src="${ovServe.url('ov-share.js')}" defer></script>`;
    const shareButton = ({ kind, id, title }) => `<button type="button" class="ovk-btn ovk-btn--quiet" data-ov-share-sheet data-kind="${esc(kind)}" data-id="${esc(id)}" data-title="${esc(title)}">Share</button>`;
    /** The gate a `people` item shows somebody who is not on its list: the audience, never the title or a turn. */
    function gatePage(req, res, { kind, id }) {
        const signedInAs = signedIn(req) ? (req.viewer.username || '') : '';
        const signInUrl = `/auth/login?next=${encodeURIComponent(req.originalUrl)}`;
        return page(req, res, {
            title: 'Shared with specific people', index: false, head: shareHead,
            // The gate draws itself from this markup (openvibe-shared 4.123.0's [data-ov-share-gate]): no inline
            // script, so a strict CSP needs nothing, and every value is escaped like any other attribute.
            body: raw(`<div class="ex-wrap ex-narrow"><div id="share-gate" data-ov-share-gate data-kind="${esc(kind)}" data-id="${esc(id)}" data-signed-in-as="${esc(signedInAs)}" data-sign-in-url="${esc(signInUrl)}">This is shared with specific people. Sign in with the OpenVibe account it was shared with, or ask its owner for access.</div></div>`),
        }, 404);
    }

    /** An item that is not shared at all: no title, no content, no hint. */
    function privatePage(req, res) {
        res.set('X-Robots-Tag', 'noindex, nofollow');
        return page(req, res, {
            title: 'Not found', index: false,
            body: raw(`<div class="ex-wrap ex-narrow">${kit.empty({ icon: 'search', title: 'No such chat', text: 'It may have been deleted, or it belongs to another account.' })}</div>`),
        }, 404);
    }

    function turnsFor(messages, models) {
        const bySlug = new Map((models || []).map((m) => [m.slug, m]));
        const turns = [];
        let i = 0;
        while (i < messages.length) {
            const m = messages[i];
            if (m.role === 'user') {
                turns.push(thread.turn({ id: m.id, you: { text: m.content }, reply: null }));
                i += 1;
                const answers = [];
                while (i < messages.length && messages[i].role === 'assistant') { answers.push(messages[i]); i += 1; }
                if (answers.length) turns.push(answerRound(answers, bySlug));
            } else {
                turns.push(answerRound([m], bySlug));
                i += 1;
            }
        }
        return turns;
    }

    /** A chat somebody else shared: the conversation, read-only, with the same words and no composer. */
    function sharedChatPage({ req, res, chat, messages, models }) {
        return page(req, res, {
            title: chat.title, index: false, class: 'ex-chat', app: true,
            head: `<link rel="stylesheet" href="${ovServe.url('thread.css')}"><script src="${ovServe.url('ov-thread.js')}" defer></script>${shareHead}`,
            body: raw(thread.page({
                head: thread.head({
                    title: chat.title,
                    actions: shareButton({ kind: 'chat', id: chat.id, title: chat.title }),
                }),
                turns: turnsFor(messages, models),
                empty: '',
                composer: '',
                label: 'A shared chat',
            })),
        });
    }

    function chatPage({ req, res, chat = null, chats = [], messages = [], models, problem = null, status = 200, defaults = '' }) {
        const turns = chat ? turnsFor(messages, models) : [];
        const empty = `<div class="ovt-welcome"><h2>Every model, one chat</h2><p>Pick one model, or up to three to compare side by side.</p><p class="ex-muted ex-small">The floor applies on every model: no sexual content involving minors, no non-consensual sexual content (fiction included) and no incest, no help with mass harm.</p></div>`;
        return page(req, res, {
            title: chat ? chat.title : 'Chat', index: false,
            class: 'ex-chat', app: true,
            head: `<link rel="stylesheet" href="${ovServe.url('thread.css')}"><script src="${ovServe.url('ov-thread.js')}" defer></script>${shareHead}`,
            body: raw(thread.page({
                sidebar: chatSidebar(chats, chat ? chat.id : null),
                head: thread.head({
                    title: chat ? chat.title : 'Chat', newHref: '/chat',
                    actions: chat && !chat.sealed ? shareButton({ kind: 'chat', id: chat.id, title: chat.title }) : '',
                }),
                turns,
                empty: empty + defaults,
                center: !chat,
                composer: composerFor({ chat, models, problem, action: chat ? `/chat/${chat.id}/send` : '/chat/send' }),
            })),
        }, status);
    }

    async function loadChats(req) {
        if (!signedIn(req)) return [];
        return chats.list(owner(req));
    }

    /**
     * A chat whose history is sealed with the person's Locker: the page carries the shell, never a turn. The
     * browser opens the envelope and draws it (public/js/exchange.js).
     */
    function sealedPage({ req, res, chat = null, models = [] }) {
        const subject = req.viewer && req.viewer.kind === 'user' && req.viewer.subject ? req.viewer.subject : '';
        return page(req, res, {
            title: chat ? 'A sealed chat' : 'A new sealed chat', index: false,
            class: 'ex-chat', app: true,
            head: `<link rel="stylesheet" href="${require('openvibe-shared/serve').url('ov-locker.css')}"><script src="${require('openvibe-shared/serve').url('ov-locker.js')}" defer></script>`,
            body: raw(views.sealedChat({ chat, models, networkUrl: config.networkUrl, subject })),
        });
    }

    // ── Sealed chats: envelopes only ─────────────────────────
    // The browser seals the conversation with the person's Locker (people-locked to them) and posts the envelope.
    // Exchange stores it and nothing else: the plaintext of a sealed conversation never reaches this service, and
    // a send carries the turns only for the run it makes (the model receives them; the database does not).
    const sealedJson = express.json({ limit: '900kb' });
    const envelopeOf = (body) => {
        const envelope = body && typeof body.envelope === 'string' ? body.envelope.trim() : '';
        if (!envelope || envelope.length > 700000 || !/^[A-Za-z0-9+/=]+$/.test(envelope)) return null;
        const bytes = Buffer.from(envelope, 'base64');
        return bytes.length >= 32 && bytes.length <= 520000 ? envelope : null;
    };
    const jsonRefusal = (res, status, error) => res.status(status).type('application/json').send(JSON.stringify({ error }));
    const sameJson = (req, res) => {
        if (!signedIn(req)) { jsonRefusal(res, 401, 'Sign in to OpenVibe first.'); return false; }
        // A read is fine from this site; a write must come from it (never another origin).
        if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req, config.baseUrl)) {
            jsonRefusal(res, 403, 'That came from somewhere else.');
            return false;
        }
        return true;
    };

    r.post('/chat/sealed/new', sealedJson, async (req, res) => {
        if (!sameJson(req, res)) return;
        const envelope = envelopeOf(req.body);
        if (!envelope) return jsonRefusal(res, 422, 'A sealed chat needs the sealed envelope.');
        const chat = await chats.createSealed({ owner: owner(req), envelope });
        // A sealed chat stays Only me: its turns are sealed to this person's Locker, so there is nothing to share.
        try { await sharing.register({ subject: owner(req) }, 'chat', chat.id, 'private'); } catch (err) { log.warn('[Exchange] the sealed chat was saved but not registered with the sharing system:', err.message); }
        return res.status(201).json({ id: chat.id, url: `/chat/${chat.id}` });
    });

    r.get('/chat/:id/sealed', async (req, res) => {
        if (!sameJson(req, res)) return;
        const chat = await chats.get(owner(req), req.params.id);
        if (!chat || !chat.sealed) return jsonRefusal(res, 404, 'No such sealed chat.');
        const seal = await chats.sealGet(owner(req), chat.id);
        return res.json({ id: chat.id, envelope: seal ? seal.envelope : null, updated_at: seal ? seal.updated_at : null, strict_privacy: Boolean(chat.strict_privacy) });
    });

    r.put('/chat/:id/sealed', sealedJson, async (req, res) => {
        if (!sameJson(req, res)) return;
        const envelope = envelopeOf(req.body);
        if (!envelope) return jsonRefusal(res, 422, 'A sealed chat needs the sealed envelope.');
        const seal = await chats.sealPut(owner(req), req.params.id, envelope);
        if (!seal) return jsonRefusal(res, 404, 'No such sealed chat.');
        return res.json({ ok: true, updated_at: seal.updated_at });
    });

    r.post('/chat/:id/sealed/send', sealedJson, async (req, res) => {
        if (!sameJson(req, res)) return;
        const chat = await chats.get(owner(req), req.params.id);
        if (!chat || !chat.sealed) return jsonRefusal(res, 404, 'No such sealed chat.');
        const body = req.body || {};
        const model = String(body.model || '').slice(0, 256);
        if (!model) return jsonRefusal(res, 422, 'Pick a model first.');
        const messages = (Array.isArray(body.messages) ? body.messages : []).slice(-80)
            .filter((m) => m && (m.role === 'user' || m.role === 'assistant' || m.role === 'system') && typeof m.content === 'string')
            .map((m) => ({ role: m.role, content: m.content.slice(0, 32000) }));
        if (!messages.length || !messages.some((m) => m.role === 'user')) return jsonRefusal(res, 422, 'Write something to send.');
        const temperature = body.temperature == null || body.temperature === '' ? null : Math.max(0, Math.min(2, Number(body.temperature)));
        const strict = body.strict_privacy === true || body.strict_privacy === '1' || body.strict_privacy === 'on';
        try {
            const out = await ai.chat({ model, messages, temperature, subject: owner(req), preset: strict ? 'private' : null });
            return res.json({
                answer: {
                    content: out.content || '(no text)', model: out.model, provider: out.provider, run_id: out.run_id,
                    cost_usd: out.cost_usd, tokens_in: out.tokens_in, tokens_out: out.tokens_out, tokens_cached: out.tokens_cached,
                    cached_input_percent: out.cached_input_percent, latency_ms: out.latency_ms,
                    why: out.why, privacy: out.privacy, privacy_detail: out.privacy_detail, preset: out.preset,
                },
            });
        } catch (err) {
            return res.status(err.status && err.status >= 400 && err.status < 600 ? err.status : 502)
                .json({ error: err.message || 'The model did not answer.', code: err.code || null });
        }
    });

    /** The person's strict-privacy switch on their API keys (an account "default" preset in OpenVibe.AI). */
    r.post('/privacy/keys', async (req, res) => {
        if (!signedIn(req)) return res.redirect(303, `/auth/login?next=${encodeURIComponent('/api')}`);
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const on = Boolean(req.body && (req.body.strict === '1' || req.body.strict === 'on'));
        let keyPrivacy = { on, available: true };
        try {
            const out = await ai.setKeyPrivacy(owner(req), on, { networkToken: (req.viewer && req.viewer.token) || null });
            if (out && out.projects) {
                keyPrivacy.note = `Set on your account${out.projects_set ? ` and ${out.projects_set} of your ${out.projects} project${out.projects === 1 ? '' : 's'}` : ''}: their keys now use the private preset unless a request names another.`
                    + (out.projects_failed && out.projects_failed.length ? ` ${out.projects_failed.length} project${out.projects_failed.length === 1 ? '' : 's'} could not be written.` : '');
            }
        } catch (err) {
            keyPrivacy = { on: !on, available: true, error: `The switch could not be saved: ${err.message || 'OpenVibe.AI did not answer'}` };
        }
        const [catalog, usage] = await Promise.all([catalogOf(), ai.usage(30)]);
        return page(req, res, { title: 'The API', index: false, body: raw(views.apiPage({ catalog, usage, viewer: req.viewer, keyPrivacy })) });
    });

    r.get('/api/ai/choices', async (req,res) => {
        try { res.set('Cache-Control','private, no-store').json(await ai.meRequest(req.viewer?.token, '/api/v1/choices?task='+encodeURIComponent(String(req.query.task || '')))); }
        catch(err) { res.status(err.status || 502).json({detail:err.message}); }
    });
    r.put('/api/ai/choices/:task', express.json({limit:'4kb'}), async (req,res) => {
        if (req.get('origin') !== new URL(config.baseUrl).origin) return res.sendStatus(403);
        try { res.json(await ai.meRequest(req.viewer?.token, '/api/v1/me/choices/'+encodeURIComponent(req.params.task), {method:'PUT',body:req.body})); }
        catch(err) { res.status(err.status || 502).json({detail:err.message}); }
    });

    // A person's AI credentials live on Exchange. The user's signed Network token travels server-to-server to AI;
    // the page and its responses contain metadata only, never a saved API key or cookie value.
    r.get('/privacy/keys', async (req, res) => {
        if (!signedIn(req)) return res.redirect(303, `/auth/login?next=${encodeURIComponent('/privacy/keys')}`);
        return credentialPage(req, res);
    });
    r.post('/privacy/credentials', async (req, res) => {
        if (!signedIn(req)) return res.sendStatus(404);
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const body = req.body || {};
        const secrets = [body.key, body.cookie];
        const payload = body.kind === 'session_cookie'
            ? { kind: 'session_cookie', provider: String(body.provider || ''), cookie: String(body.cookie || ''), ...(body.org_id ? { org_id: String(body.org_id) } : {}) }
            : { kind: 'api_key', provider: String(body.provider || ''), key: String(body.key || ''), ...(body.label ? { label: String(body.label).slice(0, 80) } : {}), ...(body.base_url ? { base_url: String(body.base_url) } : {}) };
        try {
            if (ai.credentialsFor) await ai.credentialsFor(req.viewer.token).add(payload);
            else await ai.meRequest(req.viewer.token, '/api/v1/me/credentials', { method: 'POST', body: payload });
            return res.redirect(303, '/privacy/keys');
        } catch (err) {
            return credentialPage(req, res, { error: credentialFailure(err, secrets) }, 200);
        }
    });
    r.post('/privacy/credentials/:id/remove', async (req, res) => {
        if (!signedIn(req)) return res.sendStatus(404);
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        try {
            if (ai.credentialsFor) await ai.credentialsFor(req.viewer.token).remove(req.params.id);
            else await ai.meRequest(req.viewer.token, `/api/v1/me/credentials/${encodeURIComponent(req.params.id)}`, { method: 'DELETE' });
            return res.redirect(303, '/privacy/keys');
        } catch (err) { return credentialPage(req, res, { error: credentialFailure(err) }, 200); }
    });
    r.post('/privacy/credentials/:id/balance', async (req, res) => {
        if (!signedIn(req)) return res.sendStatus(404);
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        try {
            const result = ai.credentialsFor
                ? await ai.credentialsFor(req.viewer.token).balance(req.params.id)
                : await ai.meRequest(req.viewer.token, `/api/v1/me/credentials/${encodeURIComponent(req.params.id)}/balance`);
            return credentialPage(req, res, { balance: result.balance });
        } catch (err) { return credentialPage(req, res, { error: credentialFailure(err) }, 200); }
    });

    r.get('/chat', async (req, res) => {
        const list = await loadChats(req);
        if (!list.length) return signInIfGuest(req, res, async () => {
            const { models } = await chatCatalog();
            return chatPage({ req, res, chats: [], models, defaults: await chatDefaults(req) });
        });
        return res.redirect(303, `/chat/${list[0].id}`);
    });

    async function signInIfGuest(req, res, fn) {
        if (!signedIn(req)) return signInPage(req, res, { title: 'Sign in to chat', text: 'Chat with one model or three side by side. Your history stays in your account.', next: '/chat' });
        return fn();
    }

    /** The person's default for new chats, on the page where a chat starts ("New chats: Only me"). */
    async function chatDefaults(req) {
        if (!signedIn(req)) return '';
        const current = await sharing.defaultOf(owner(req), 'chat').catch(() => 'private');
        return views.audienceDefaults({ kind: 'chat', label: 'chats', current, action: '/chat/defaults', signedIn: true });
    }

    r.post('/chat/defaults', async (req, res) => {
        if (!signedIn(req)) return res.redirect(303, '/auth/login?next=%2Fchat');
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const body = req.body || {};
        const audience = ['private', 'people', 'link', 'public'].includes(body.audience) ? body.audience : 'private';
        await sharing.setDefault(owner(req), 'chat', audience, { applyAll: String(body.apply_all || '') === '1' }).catch((err) => log.warn('[Exchange] the chat default was not saved:', err.message));
        return res.redirect(303, '/chat');
    });

    r.get('/chat/new', async (req, res) => signInIfGuest(req, res, async () => {
        const [list, cat, defaults] = await Promise.all([chats.list(owner(req)), chatCatalog(), chatDefaults(req)]);
        if (req.query.sealed === '1') return sealedPage({ req, res, models: cat.models });
        return chatPage({ req, res, chats: list, models: cat.models, defaults });
    }));

    /**
     * A chat is its owner's page. Someone it was shared with reads the same conversation without the composer;
     * anybody else gets the gate for Specific people, or "not found" when it is Only me.
     */
    r.get('/chat/:id', async (req, res) => {
        const chat = await chats.find(req.params.id);
        if (!chat) return privatePage(req, res);
        if (signedIn(req) && chat.owner === owner(req)) {
            const [list, cat] = await Promise.all([chats.list(owner(req)), chatCatalog()]);
            if (chat.sealed) return sealedPage({ req, res, chat, models: cat.models });
            const messages = await chats.messages(owner(req), chat.id);
            return chatPage({ req, res, chat, chats: list, messages, models: cat.models });
        }
        // A sealed chat is never shared: its turns are the owner's Locker's, so nobody else can read it anyway.
        if (chat.sealed) return privatePage(req, res);
        const allowed = await sharing.canView(req.viewer, 'chat', chat.id).catch(() => false);
        if (!allowed) {
            const audience = await sharing.audienceOf('chat', chat.id).catch(() => null);
            if (audience === 'people') return gatePage(req, res, { kind: 'chat', id: chat.id });
            return privatePage(req, res);
        }
        const [messages, cat] = await Promise.all([chats.allMessages(chat.id), chatCatalog()]);
        return sharedChatPage({ req, res, chat, messages, models: cat.models });
    });

    async function sendMessage(req, res, chatId = null) {
        if (!signedIn(req)) return signInPage(req, res, { title: 'Sign in to chat', text: 'Your history stays in your account.', next: '/chat' });
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const body = req.body || {};
        const text = String(body.text || '').slice(0, config.chat.maxChars).trim();
        const { models } = await chatCatalog();
        const picked = Object.keys(body).filter((k) => k.startsWith('models_')).map((k) => k.slice('models_'.length))
            .concat(Array.isArray(body.models) ? body.models : (body.models ? [body.models] : []));
        const wanted = [...new Set(picked.map(String))].filter((s) => models.some((m) => m.slug === s)).slice(0, config.chat.models);
        const chosen = wanted.length ? wanted : models.slice(0, 1).map((m) => m.slug);
        const system = body.system ? String(body.system).slice(0, 4000) : null;
        const temperature = body.temperature === '' || body.temperature == null ? null : Math.max(0, Math.min(2, Number(body.temperature)));
        const strict = Boolean(body.strict_privacy && ['1', 'on', 'true', 'yes'].includes(String(body.strict_privacy)));
        const preset = strict ? 'private' : null;

        let chat = chatId ? await chats.get(owner(req), chatId) : null;
        if (chatId && !chat) return page(req, res, { title: 'Not found', index: false, body: raw(kit.empty({ icon: 'chat', title: 'No such chat', text: 'It may have been deleted.', action: { href: '/chat', label: 'Your chats' } })) }, 404);
        // A sealed chat is written by its own page: its turns never come through this form.
        if (chat && chat.sealed) return res.redirect(303, `/chat/${chat.id}`);
        const uncensored = chosen.map((s) => models.find((m) => m.slug === s)).filter((m) => m && m.uncensored);
        if (uncensored.length && !(await adult.confirmed(owner(req)))) {
            const list = await loadChats(req);
            return chatPage({ req, res, chat, chats: list, messages: chat ? await chats.messages(owner(req), chat.id) : [], models, problem: 'That model is uncensored, and adults only. Confirm you are 18 or over on the Uncensored page first.', status: 403 });
        }
        if (!text) {
            const list = await loadChats(req);
            return chatPage({ req, res, chat, chats: list, messages: chat ? await chats.messages(owner(req), chat.id) : [], models, problem: 'Write something to send.', status: 422 });
        }
        if (!chosen.length) {
            const list = await loadChats(req);
            return chatPage({ req, res, chat, chats: list, messages: chat ? await chats.messages(owner(req), chat.id) : [], models, problem: 'Pick at least one model.', status: 422 });
        }
        const used = await chats.countToday(owner(req));
        if (used >= config.chat.perDay) {
            const list = await loadChats(req);
            return chatPage({ req, res, chat, chats: list, messages: chat ? await chats.messages(owner(req), chat.id) : [], models, problem: `That is today's ${config.chat.perDay} answers. The allowance resets at midnight UTC.`, status: 429 });
        }

        const isNew = !chat;
        if (!chat) {
            chat = await chats.create({ owner: owner(req), models: chosen, title: text.replace(/\s+/g, ' ').slice(0, 60), strictPrivacy: strict });
            // The person's default for new chats (Only me unless they changed it), then the sheet for this one.
            const audience = await sharing.defaultOf(owner(req), 'chat').catch(() => 'private');
            try { await sharing.register({ subject: owner(req) }, 'chat', chat.id, audience); } catch (err) { log.warn('[Exchange] the chat was saved but not registered with the sharing system:', err.message); }
        }
        else {
            await chats.settings(owner(req), chat.id, { models: chosen, systemPrompt: system, temperature });
            await chats.setPrivacy(owner(req), chat.id, { strictPrivacy: strict });
            chat.strict_privacy = strict;
        }
        if (!isNew && (system !== chat.system_prompt || temperature !== chat.temperature)) {
            // settings stored above
        }

        const history = await chats.messages(owner(req), chat.id);
        await chats.append(owner(req), chat.id, { role: 'user', content: text });
        const conversation = history.filter((m) => m.role === 'user').map((m) => ({ role: 'user', content: m.content }));

        for (const slug of chosen) {
            const model = models.find((m) => m.slug === slug);
            const best = model && (model.offers.find((o) => o.id) || model.offers[0]);
            const modelId = (best && best.id) || 'openvibe/auto';
            const prior = history.filter((m) => m.role === 'assistant' && m.model === slug && m.content)
                .map((m) => ({ role: 'assistant', content: m.content }));
            const messages = [
                ...(system ? [{ role: 'system', content: system }] : []),
                ...interleave(conversation, prior),
                { role: 'user', content: text },
            ];
            try {
                const out = await ai.chat({ model: modelId, messages, temperature, subject: owner(req), preset });
                await chats.append(owner(req), chat.id, {
                    role: 'assistant', model: slug, content: out.content || '(no text)',
                    meta: {
                        run_id: out.run_id, provider: out.provider, answered_model: out.model, cost_usd: out.cost_usd,
                        tokens_in: out.tokens_in, tokens_out: out.tokens_out, tokens_cached: out.tokens_cached,
                        cached_input_percent: out.cached_input_percent, latency_ms: out.latency_ms, why: out.why,
                        privacy: out.privacy, privacy_detail: out.privacy_detail, preset: out.preset,
                    },
                });
            } catch (err) {
                await chats.append(owner(req), chat.id, { role: 'assistant', model: slug, error: err.message || 'The model did not answer.', meta: { code: err.code || null } });
            }
        }
        return res.redirect(303, `/chat/${chat.id}`);
    }

    /** The person's turns, each followed by this model's own earlier answers (so a comparison never bleeds across models). */
    function interleave(userTurns, answers) {
        const out = [];
        const n = Math.min(userTurns.length, answers.length);
        for (let i = 0; i < userTurns.length; i++) {
            out.push(userTurns[i]);
            if (i < n) out.push(answers[i]);
        }
        return out;
    }

    r.post('/chat/send', (req, res) => sendMessage(req, res, null));
    r.post('/chat/:id/send', async (req, res) => {
        if (!signedIn(req)) return signInPage(req, res, { title: 'Sign in to chat', text: 'Your history stays in your account.', next: `/chat/${req.params.id}` });
        return sendMessage(req, res, req.params.id);
    });

    r.post('/chat/:id/delete', async (req, res) => {
        if (!signedIn(req)) return res.redirect(303, '/auth/login?next=%2Fchat');
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        await chats.remove(owner(req), req.params.id);
        return res.redirect(303, '/chat');
    });

    r.post('/chat/:id/clear', async (req, res) => {
        if (!signedIn(req)) return res.redirect(303, '/auth/login?next=%2Fchat');
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const chat = await chats.get(owner(req), req.params.id);
        if (chat) await chats.clear(owner(req), chat.id);
        return res.redirect(303, `/chat/${req.params.id}`);
    });

    // ── API ──────────────────────────────────────────────────
    r.get('/api', async (req, res) => {
        const [catalog, usage] = await Promise.all([catalogOf(), ai.usage(30)]);
        // The strict-privacy switch on a person's keys: their account's "default" preset in AI.
        let keyPrivacy = null;
        if (signedIn(req)) {
            const presets = typeof ai.presetsFor === 'function' ? await ai.presetsFor(owner(req)) : null;
            keyPrivacy = Array.isArray(presets)
                ? { available: true, on: presets.some((p) => p && p.name === 'default' && p.policy && p.policy.data_policy === 'private') }
                : { available: false };
        }
        return page(req, res, {
            index: true, cache: signedIn(req) ? null : PUBLIC_CACHE, agentLayer: true,
            title: 'The API',
            description: 'One OpenAI- and Anthropic-compatible endpoint for every model on OpenVibe.Exchange: keys, model ids, usage.',
            body: raw(views.apiPage({ catalog, usage, viewer: req.viewer, keyPrivacy })),
        });
    });

    // ── Start building, why this model, and the questions ────
    // Moved from ai.openvibe.services when its public pages merged here. The API stays on that address; these
    // routes carry its guide, its routing explainer and its FAQ onto Exchange's own shell.
    r.get('/start', async (req, res) => {
        const catalog = await catalogOf();
        return page(req, res, {
            index: true, cache: PUBLIC_CACHE, agentLayer: true,
            title: 'Start building',
            description: 'Start with one key and one OpenAI- and Anthropic-compatible endpoint; every answer says which model ran and why.',
            body: raw(views.startPage({ catalog })),
        });
    });

    r.get('/why', async (req, res) => {
        const catalog = await catalogOf();
        return page(req, res, {
            index: true, cache: signedIn(req) ? null : PUBLIC_CACHE, agentLayer: true,
            title: 'Why this model',
            description: 'Why the router chose the model that answered: the objective, the candidates, their estimated cost and latency, and the reason each was passed over.',
            body: raw(views.whyPage({ catalog, viewer: req.viewer })),
        });
    });

    r.post('/why', async (req, res) => {
        if (!signedIn(req)) return signInPage(req, res, { title: 'Sign in to ask one question', text: 'The demo is one real run on your own allowance.', next: '/why' });
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const text = String((req.body && req.body.text) || '').slice(0, Math.min(2000, config.chat.maxChars));
        const catalog = await catalogOf();
        if (!text.trim()) {
            return page(req, res, { index: false, title: 'Why this model', body: raw(views.whyPage({ catalog, viewer: req.viewer, problem: 'Write something to send.', text })) }, 422);
        }
        try {
            const result = await ai.chat({ model: 'openvibe/auto', messages: [{ role: 'user', content: text }], subject: owner(req), maxTokens: 512 });
            return page(req, res, {
                index: false, title: 'Why this model',
                description: 'One real run, with the router’s own explanation of the offer it chose.',
                body: raw(views.whyPage({ catalog, viewer: req.viewer, result, text })),
            });
        } catch (err) {
            return page(req, res, {
                index: false, title: 'Why this model',
                body: raw(views.whyPage({ catalog, viewer: req.viewer, problem: err.message || 'The model did not answer.', text })),
            }, err.status === 429 ? 429 : 502);
        }
    });

    r.get('/faq', (req, res) => page(req, res, {
        index: true, cache: PUBLIC_CACHE, agentLayer: true,
        title: 'Questions',
        description: 'The questions developers and people ask about OpenVibe.Exchange: the endpoint, SDKs, keys, prices, privacy, the uncensored tier and the move from ai.openvibe.services.',
        jsonLd: [seo.jsonLd.faq(views.FAQ.map((p) => ({ q: p.q, a: p.a })))],
        body: raw(views.faqPage()),
    }));

    // ── Sell ─────────────────────────────────────────────────
    // The person's machines and pools come from Network with their own token (never a service token); the live
    // community offers come from AI's public read. Exchange measures nothing and keeps no pool of its own.
    async function sellState(req) {
        const [catalog, usage, community] = await Promise.all([catalogOf(), ai.usage(30), communityOffers()]);
        let pool = null;
        if (signedIn(req)) {
            const token = req.token || (req.viewer && req.viewer.token);
            try {
                const [machines, pools] = await Promise.all([network.machines(token), network.pools(token)]);
                pool = { machines, ...pools };
            } catch (err) {
                log.warn('[OpenVibe.Exchange] your machines read failed:', (err && err.message) || err);
                pool = { machines: [], candidates: [], pools: [], error: 'Your machines could not be read right now. Reload in a moment.' };
            }
        }
        return { catalog, usage, community, pool };
    }

    async function renderSell(req, res, { error = null } = {}) {
        const state = await sellState(req);
        if (error && state.pool) state.pool = { ...state.pool, error };
        return page(req, res, {
            index: true, cache: PUBLIC_CACHE, agentLayer: true,
            title: 'Sell your compute',
            description: 'Turn a GPU or a spare machine into credits with OpenVibe Link: offer models, hours, concurrency and a price. What is not sold here, said plainly.',
            body: raw(views.sellPage({ ...state, viewer: req.viewer, signedIn: signedIn(req) })),
        });
    }

    r.get('/sell', (req, res) => renderSell(req, res));

    // "1. Choose the machines": Network holds the pool (it refuses another owner's machine, another network, or a
    // machine already in a pool), and each machine approves it on itself afterwards.
    r.post('/sell/pool', async (req, res) => {
        if (!signedIn(req)) return res.redirect(303, '/auth/login?next=%2Fsell');
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const machines = [...new Set([].concat((req.body && req.body.machines) || [])
            .map(String).filter((id) => /^dev_[0-9A-HJKMNP-TV-Z]{26}$/.test(id)))].slice(0, 8);
        if (machines.length < 2) return renderSell(req, res, { error: 'Choose two or more of your machines on the same network.' });
        const head = /^dev_[0-9A-HJKMNP-TV-Z]{26}$/.test(String((req.body && req.body.head) || '')) ? String(req.body.head) : null;
        const token = req.token || (req.viewer && req.viewer.token);
        try {
            await network.proposePool(token, { machines, ...(head ? { head } : {}) });
            return res.redirect(303, '/sell#pool');
        } catch (err) {
            return renderSell(req, res, { error: (err && err.message) || 'The pool could not be created.' });
        }
    });

    // "Stop pooling": the offer goes offline and each machine drops its private link and its key.
    r.post('/sell/pool/:id/stop', async (req, res) => {
        if (!signedIn(req)) return res.redirect(303, '/auth/login?next=%2Fsell');
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const token = req.token || (req.viewer && req.viewer.token);
        try {
            await network.revokePool(token, String(req.params.id));
            return res.redirect(303, '/sell#pool');
        } catch (err) {
            return renderSell(req, res, { error: (err && err.message) || 'The pool could not be stopped.' });
        }
    });

    // ── Your own endpoint ────────────────────────────────────
    // The private GPU page. The status is public (so the reason it is off is visible before signing in);
    // a person's own endpoints are read from AI with their own Network token, never with the service token.
    async function renderOwn(req, res, { error = null, quote = null } = {}) {
        let status = null;
        let problem = error;
        try { status = await ai.ownStatus(); } catch (err) {
            log.warn('[OpenVibe.Exchange] the endpoint status read failed:', (err && err.message) || err);
            problem = problem || 'OpenVibe.AI is not reachable right now. Reload in a moment.';
        }
        let endpoints = [];
        if (signedIn(req) && status && status.enabled) {
            const token = req.token || (req.viewer && req.viewer.token);
            try {
                const out = await ai.ownList(token);
                endpoints = (out && out.endpoints) || [];
            } catch (err) {
                log.warn('[OpenVibe.Exchange] the endpoints read failed:', (err && err.message) || err);
                problem = problem || 'Your endpoints could not be read right now. Reload in a moment.';
            }
        }
        return page(req, res, {
            index: true, cache: signedIn(req) ? null : PUBLIC_CACHE, agentLayer: true,
            title: 'Your own endpoint',
            description: 'A private GPU for one model or your own weights: only you reach it, it scales to zero when idle, and your Balance pays for the seconds it runs.',
            body: raw(views.ownPage({ status, endpoints, quote, viewer: req.viewer, error: problem, signedIn: signedIn(req) })),
        });
    }

    r.get('/own', async (req, res) => renderOwn(req, res));
    r.get('/own/quote', async (req, res) => {
        const strategy = String(req.query.strategy || 'cheapest');
        const model = String(req.query.model || '').slice(0, 80);
        if (!['automatic','cheapest','fastest','private','own'].includes(strategy)) return renderOwn(req, res, { error: 'Choose one of the listed strategies.' });
        try { return renderOwn(req, res, { quote: await ai.gpuQuote(model, strategy) }); }
        catch { return renderOwn(req, res, { error: 'The live quote is unavailable. Nothing was rented.' }); }
    });

    r.post('/own', async (req, res) => {
        if (!signedIn(req)) return res.redirect(303, '/auth/login?next=%2Fown');
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const body = {};
        if (req.body.strategy) body.strategy = String(req.body.strategy).slice(0, 20);
        if (req.body.model) body.model = String(req.body.model).slice(0, 80);
        if (req.body.weights_repo || req.body.weights_file) {
            body.weights = {
                repo: String(req.body.weights_repo || '').trim(),
                file: String(req.body.weights_file || '').trim(),
                ...(req.body.lora_repo ? { lora_repo: String(req.body.lora_repo).trim() } : {}),
                ...(req.body.lora_file ? { lora_file: String(req.body.lora_file).trim() } : {}),
            };
        }
        if (req.body.idle_minutes) body.idle_minutes = Number(req.body.idle_minutes);
        if (req.body.display_name) body.display_name = String(req.body.display_name).slice(0, 120);
        const token = req.token || (req.viewer && req.viewer.token);
        try {
            await ai.ownCreate(token, body);
            return res.redirect(303, '/own');
        } catch (err) {
            return renderOwn(req, res, { error: (err && err.message) || 'Your endpoint could not be started.' });
        }
    });

    r.post('/own/:id/stop', async (req, res) => {
        if (!signedIn(req)) return res.redirect(303, '/auth/login?next=%2Fown');
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const token = req.token || (req.viewer && req.viewer.token);
        try {
            await ai.ownStop(token, String(req.params.id));
            return res.redirect(303, '/own');
        } catch (err) {
            return renderOwn(req, res, { error: (err && err.message) || 'Your endpoint could not be stopped.' });
        }
    });

    // ── Uncensored ───────────────────────────────────────────
    r.get('/uncensored', async (req, res) => {
        const catalog = await catalogOf();
        const isAdult = signedIn(req) ? await adult.confirmed(owner(req)) : false;
        return page(req, res, {
            index: true, cache: signedIn(req) ? null : PUBLIC_CACHE, agentLayer: true,
            title: 'Uncensored', description: 'Abliterated models for adults, with the floor: no minors, no non-consensual content, no mass harm.',
            body: raw(views.uncensoredPage({ catalog, adult: isAdult, signedIn: signedIn(req) })),
        });
    });
    r.post('/uncensored/confirm', async (req, res) => {
        if (!signedIn(req)) return res.redirect(303, '/auth/login?next=%2Funcensored');
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        if (!req.body || req.body.adult !== 'yes') return res.redirect(303, '/uncensored');
        await adult.confirm(owner(req), '1');
        // The confirmation belongs to the account (Network PR #587): record it there too, so the flag is one
        // flag and OpenVibe.AI and the companions read the same answer.
        if (ctx.adultAccount && typeof ctx.adultAccount.confirm === 'function') {
            try {
                await ctx.adultAccount.confirm(req.token || (req.viewer && req.viewer.token) || null);
            } catch (err) {
                log.warn('[OpenVibe.Exchange] the 18+ confirmation could not be recorded on the account:', err.message);
            }
        }
        return res.redirect(303, '/uncensored');
    });

    // ── AI in OpenVibe ───────────────────────────────────────
    r.get('/ai', async (req, res) => {
        const [catalog, usage] = await Promise.all([catalogOf(), ai.usage(30)]);
        return page(req, res, {
            index: true, cache: PUBLIC_CACHE, agentLayer: true,
            title: 'AI in OpenVibe',
            description: 'Which OpenVibe products use which models through the same router, and what each costs a day.',
            body: raw(views.aiPage({ catalog, usage })),
        });
    });

    // ── Status ───────────────────────────────────────────────
    r.get('/status', async (req, res) => {
        const catalog = await catalogOf();
        const [usage, changes] = await Promise.all([
            ai.usage(30),
            history.changes().catch((err) => { log.warn('[OpenVibe.Exchange] changelog failed:', err.message); return null; }),
        ]);
        return page(req, res, {
            index: true, cache: PUBLIC_CACHE, agentLayer: true,
            title: 'Status', description: 'Uptime per offer, the model changelog and incidents on OpenVibe.Exchange.',
            body: raw(views.statusPage({ catalog, usage, changes })),
        });
    });

    // ── Discovery ────────────────────────────────────────────
    r.use(createDiscoveryRoutes(ctx));

    r.use((req, res) => page(req, res, {
        title: 'Not found', index: false,
        body: raw(`<div class="ex-wrap ex-narrow">${kit.empty({ icon: 'search', title: 'Not found', text: `Nothing lives at ${esc(req.path)}. <a href="/">The home</a> has every model.` })}</div>`),
    }, 404));

    return r;
}

module.exports = { createPageRoutes, RETIRED_PATHS };
