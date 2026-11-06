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
const { asyncRouter } = require('./router');
const { createDiscoveryRoutes, homeJsonLd } = require('./discovery');
const { sameOrigin } = require('./principal');
const { esc, raw } = require('../render/html');
const marks = require('../views/marks');
const { send } = require('../render/layout');
const views = require('../views/exchange');

const PUBLIC_CACHE = cache.htmlHeaders({ maxAge: 60 });
const RETIRED_PATHS = ['/listings', '/listings/*', '/submit', '/sandbox', '/sandbox/*', '/installs', '/offers', '/safety', '/developers'];

const textOf = (s) => esc(String(s || '')).replace(/\n/g, '<br>');

function createPageRoutes(ctx) {
    const { config, ai, openapi, chats, adult, log } = ctx;
    const r = asyncRouter();
    r.use(express.urlencoded({ extended: false, limit: '64kb' }));
    const page = (req, res, o, status = 200) => send(res, status, { viewer: req.viewer, config, path: req.originalUrl, ...o });
    const signedIn = (req) => Boolean(req.viewer && req.viewer.kind === 'user' && req.viewer.subject);
    const owner = (req) => req.viewer.subject;
    const notFromHere = (req, res) => page(req, res, { title: 'Not from this site', index: false, body: raw(`<div class="ex-wrap ex-narrow">${kit.empty({ icon: 'shield', title: 'That came from somewhere else', text: 'Use the form on OpenVibe.Exchange.' })}</div>`) }, 403);
    const signInPage = (req, res, { title, text, next, status = 401 }) => page(req, res, {
        title, index: false,
        body: raw(`<div class="ex-wrap ex-narrow">${kit.empty({ icon: 'person', title, text, action: { href: `/auth/login?next=${encodeURIComponent(next || req.originalUrl)}`, label: 'Sign in with OpenVibe' } })}</div>`),
    }, status);
    const catalogOf = () => ai.catalog();

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

    // ── Home ─────────────────────────────────────────────────
    r.get('/', async (req, res) => {
        const [catalog, usage] = await Promise.all([catalogOf(), ai.usage(30)]);
        const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 120) : '';
        return page(req, res, {
            index: true, cache: PUBLIC_CACHE, agentLayer: true,
            title: null,
            description: 'Every AI model, one account: live prices, speed and uptime of every offer, from the families on sale today and more as their providers join. Chat, or call one OpenAI-compatible endpoint.',
            jsonLd: homeJsonLd(config),
            body: raw(views.home({ catalog, usage, viewer: req.viewer, q, config })),
        });
    });

    // ── Models ───────────────────────────────────────────────
    r.get('/models', async (req, res) => {
        const catalog = await catalogOf();
        const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 120) : '';
        const family = typeof req.query.family === 'string' ? req.query.family.slice(0, 60) : '';
        const sort = ['cheap', 'fast'].includes(req.query.sort) ? req.query.sort : '';
        return page(req, res, {
            index: true, cache: PUBLIC_CACHE, agentLayer: true,
            title: q ? `Models: ${q}` : 'Models',
            description: 'Every model on OpenVibe.Exchange with its live offers: price in and out per million tokens, measured speed and uptime, context length and data policy.',
            body: raw(views.modelsPage({ catalog, q, family, sort })),
        });
    });

    async function modelFrom(catalog, org, model) {
        const slug = `${String(org || '').toLowerCase()}/${String(model || '').toLowerCase()}`;
        return (catalog.models || []).find((m) => m.slug === slug) || null;
    }
    const modelPath = (m) => `/m/${m.slug.split('/').map(encodeURIComponent).join('/')}`;

    async function renderModel(req, res, { result = null, problem = null, text = '', status = 200 } = {}) {
        const catalog = await catalogOf();
        const model = await modelFrom(catalog, req.params.org, req.params.model);
        if (!model) {
            if (catalog.unavailable) {
                return page(req, res, { title: 'Models are not available', index: false, body: raw(`<div class="ex-wrap ex-narrow">${kit.notice({ kind: 'warn', text: 'The live catalog is not reachable right now. Reload in a moment.' })}<p><a href="/models">All models</a></p></div>`) }, 503);
            }
            return page(req, res, { title: 'Not found', index: false, body: raw(`<div class="ex-wrap ex-narrow">${kit.empty({ icon: 'search', title: 'No such model', text: `Nothing here serves ${esc(`${req.params.org}/${req.params.model}`)}. <a href="/models">Browse the models</a>.` })}</div>`) }, 404);
        }
        const isAdult = signedIn(req) ? await adult.confirmed(owner(req)) : false;
        const jsonLd = seo.jsonLd.webPage({
            name: `${model.name} on OpenVibe.Exchange`, url: `${config.baseUrl}${modelPath(model)}`,
            description: `${model.name}: ${model.offers.length} live offers with price, speed and uptime.`.slice(0, 160), siteUrl: config.baseUrl,
        });
        return page(req, res, {
            index: true, cache: req.method === 'GET' ? PUBLIC_CACHE : null, agentLayer: true,
            title: model.name, description: `${model.name}: price, speed, uptime and data policy of every offer.`,
            jsonLd: [jsonLd], head: '',
            body: raw(views.modelPage({ model, viewer: req.viewer, result, problem, text, adult: isAdult })),
        }, status);
    }

    r.get('/m/:org/:model', (req, res) => renderModel(req, res));
    r.post('/m/:org/:model/try', async (req, res) => {
        if (!signedIn(req)) return signInPage(req, res, { title: 'Sign in to try it', text: 'A try is one run on your own free allowance.', next: `/m/${req.params.org}/${req.params.model}` });
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const text = String((req.body && req.body.text) || '').slice(0, config.chat.maxChars);
        if (!text.trim()) return renderModel(req, res, { problem: 'Write something to send.', status: 422 });
        const catalog = await catalogOf();
        const model = await modelFrom(catalog, req.params.org, req.params.model);
        if (!model) return renderModel(req, res);
        if (model.uncensored && !(await adult.confirmed(owner(req)))) {
            return page(req, res, { title: model.name, index: false, body: raw(views.modelPage({ model, viewer: req.viewer, problem: 'Confirm you are 18 or over first.', adult: false })) }, 403);
        }
        const best = model.offers.find((o) => o.id) || model.offers[0];
        const modelId = (best && best.id) || 'openvibe/auto';
        try {
            const out = await ai.chat({ model: modelId, messages: [{ role: 'user', content: text }], subject: owner(req) });
            return renderModel(req, res, { result: out, text });
        } catch (err) {
            return renderModel(req, res, { problem: err.message || 'The model did not answer.', text, status: err.status === 429 ? 429 : 502 });
        }
    });

    // ── Chat ─────────────────────────────────────────────────
    async function chatCatalog() {
        const catalog = await catalogOf();
        const notChat = new Set(['embedding', 'embeddings', 'stt', 'asr', 'tts', 'speech', 'image', 'images', 'rerank', 'moderation']);
        return { catalog, models: (catalog.models || []).filter((m) => !notChat.has(String(m.kind || m.type || 'chat').toLowerCase())) };
    }
    const modelOptions = (models, selected) => models.slice(0, 40).map((m) => [m.slug, m.name + (m.uncensored ? ' · 18+' : '') + ((m.offers || []).some((o) => o.free_tier === true) ? ' · Free to try' : ''), (selected || []).includes(m.slug)]);

    function chatSidebar(chats, current) {
        const items = chats.map((c) => ({ href: `/chat/${c.id}`, title: c.title, current: c.id === current, at: c.updated_at }));
        return thread.sidebar({
            newHref: '/chat/new', newLabel: 'New chat', findAction: '/chat', findPlaceholder: 'Find a chat',
            groups: thread.group(items.sort((a, b) => String(b.at).localeCompare(String(a.at))), (c) => c.at || Date.now()),
            nav: [
                { href: '/models', label: 'Models', icon: 'spark' },
                { href: '/api', label: 'API', icon: 'code' },
                { href: '/ai', label: 'AI in OpenVibe', icon: 'gear' },
            ],
        });
    }

    function composerFor({ chat = null, models, problem = null, action = '/chat/send' }) {
        const selected = chat && chat.models.length ? chat.models : models.slice(0, 1).map((m) => m.slug);
        const settings = `<details class="ovt-settings"><summary>Models, system prompt and temperature</summary>
<div class="ovt-settings-body">
${kit.chips({ name: 'models', label: 'Compare up to three models', options: modelOptions(models, selected), single: false })}
<label class="ex-label" for="sys">System prompt (optional)</label>
<textarea id="sys" name="system" rows="2" maxlength="4000">${esc((chat && chat.system_prompt) || '')}</textarea>
<label class="ex-label" for="temp">Temperature <span class="ex-muted">0 to 2</span></label>
<input id="temp" name="temperature" type="number" min="0" max="2" step="0.1" value="${chat && chat.temperature != null ? esc(chat.temperature) : ''}">
</div></details>${problem ? kit.notice({ kind: 'error', text: problem }) : ''}`;
        return thread.composer({
            action, name: 'text', placeholder: 'Ask anything…', top: settings, maxlength: config.chat.maxChars,
            hidden: { chat: chat ? chat.id : '' },
            note: `Your free daily allowance. Models marked Free to try run on it; other models need your own balance or key. Each message may run up to ${config.chat.models} models.`,
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
            const receipt = `<details class="ex-receipt"><summary>Receipt</summary><dl>
<dt>Offer</dt><dd>${esc(m.meta && m.meta.provider ? views.providerLabel({ provider: m.meta.provider }) : '—')}${m.meta && m.meta.answered_model ? ` · ${esc(m.meta.answered_model)}` : ''}</dd>
<dt>Price</dt><dd>${cost == null ? '—' : Number(cost) === 0 ? 'free' : `$${Number(cost).toFixed(6)}`}</dd>
<dt>Tokens</dt><dd>${m.meta && (m.meta.tokens_in != null || m.meta.tokens_out != null) ? `${Number(m.meta.tokens_in || 0).toLocaleString('en-US')} in · ${Number(m.meta.tokens_out || 0).toLocaleString('en-US')} out` : '—'}</dd>
<dt>Latency</dt><dd>${latency == null ? '—' : `${Number(latency).toLocaleString('en-US')} ms`}</dd>
<dt>Why this offer</dt><dd>${m.meta && Array.isArray(m.meta.why) && m.meta.why.length ? esc(m.meta.why.join(' · ')) : 'The router picked the healthiest offer for your floor, ceiling and policy.'}</dd>
</dl></details>`;
            return `<article class="ex-answer-col">${head}${body}${receipt}</article>`;
        }).join('');
        return `<li class="ovt-turn ex-round"><div class="ex-answer-grid" data-count="${list.length}">${cells}</div></li>`;
    }

    function chatPage({ req, res, chat = null, chats = [], messages = [], models, problem = null, status = 200 }) {
        const bySlug = new Map((models || []).map((m) => [m.slug, m]));
        const turns = [];
        if (chat) {
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
        }
        const empty = `<div class="ovt-welcome"><h2>Every model, one chat</h2><p>Pick one model, or up to three to compare side by side. The floor applies always: no sexual content involving minors, no non-consensual sexual content (fiction included) and no incest, no help with mass harm.</p></div>`;
        return page(req, res, {
            title: chat ? chat.title : 'Chat', index: false,
            class: 'ex-chat', app: true,
            head: `<link rel="stylesheet" href="${require('openvibe-shared/serve').url('thread.css')}"><script src="${require('openvibe-shared/serve').url('ov-thread.js')}" defer></script>`,
            body: raw(thread.page({
                sidebar: chatSidebar(chats, chat ? chat.id : null),
                head: thread.head({ title: chat ? chat.title : 'Chat', newHref: '/chat' }),
                turns,
                empty,
                center: !chat,
                composer: composerFor({ chat, models, problem, action: chat ? `/chat/${chat.id}/send` : '/chat/send' }),
            })),
        }, status);
    }

    async function loadChats(req) {
        if (!signedIn(req)) return [];
        return chats.list(owner(req));
    }

    r.get('/chat', async (req, res) => {
        const list = await loadChats(req);
        if (!list.length) return signInIfGuest(req, res, async () => {
            const { models } = await chatCatalog();
            return chatPage({ req, res, chats: [], models });
        });
        return res.redirect(303, `/chat/${list[0].id}`);
    });

    async function signInIfGuest(req, res, fn) {
        if (!signedIn(req)) return signInPage(req, res, { title: 'Sign in to chat', text: 'Chat with one model or three side by side. Your history stays in your account.', next: '/chat' });
        return fn();
    }

    r.get('/chat/new', async (req, res) => signInIfGuest(req, res, async () => {
        const [list, cat] = await Promise.all([chats.list(owner(req)), chatCatalog()]);
        return chatPage({ req, res, chats: list, models: cat.models });
    }));

    r.get('/chat/:id', async (req, res) => signInIfGuest(req, res, async () => {
        const chat = await chats.get(owner(req), req.params.id);
        if (!chat) return page(req, res, { title: 'Not found', index: false, body: raw(`<div class="ex-wrap ex-narrow">${kit.empty({ icon: 'chat', title: 'No such chat', text: 'It may have been deleted.', action: { href: '/chat', label: 'Your chats' } })}</div>`) }, 404);
        const [messages, list, cat] = await Promise.all([chats.messages(owner(req), chat.id), chats.list(owner(req)), chatCatalog()]);
        return chatPage({ req, res, chat, chats: list, messages, models: cat.models });
    }));

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

        let chat = chatId ? await chats.get(owner(req), chatId) : null;
        if (chatId && !chat) return page(req, res, { title: 'Not found', index: false, body: raw(kit.empty({ icon: 'chat', title: 'No such chat', text: 'It may have been deleted.', action: { href: '/chat', label: 'Your chats' } })) }, 404);
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
        if (!chat) chat = await chats.create({ owner: owner(req), models: chosen, title: text.replace(/\s+/g, ' ').slice(0, 60) });
        else await chats.settings(owner(req), chat.id, { models: chosen, systemPrompt: system, temperature });
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
                const out = await ai.chat({ model: modelId, messages, temperature, subject: owner(req) });
                await chats.append(owner(req), chat.id, {
                    role: 'assistant', model: slug, content: out.content || '(no text)',
                    meta: {
                        run_id: out.run_id, provider: out.provider, answered_model: out.model, cost_usd: out.cost_usd,
                        tokens_in: out.tokens_in, tokens_out: out.tokens_out, latency_ms: out.latency_ms, why: out.why,
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
        return page(req, res, {
            index: true, cache: PUBLIC_CACHE, agentLayer: true,
            title: 'The API',
            description: 'One OpenAI- and Anthropic-compatible endpoint for every model on OpenVibe.Exchange: keys, model ids, usage.',
            body: raw(views.apiPage({ catalog, usage })),
        });
    });

    // ── Sell ─────────────────────────────────────────────────
    r.get('/sell', async (req, res) => {
        const [catalog, usage] = await Promise.all([catalogOf(), ai.usage(30)]);
        return page(req, res, {
            index: true, cache: PUBLIC_CACHE, agentLayer: true,
            title: 'Sell your compute',
            description: 'Turn a GPU or a spare machine into credits with OpenVibe Node: offer models, hours, concurrency and a price. What is not sold here, said plainly.',
            body: raw(views.sellPage({ catalog, usage, viewer: req.viewer })),
        });
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
        const [catalog, usage] = await Promise.all([catalogOf(), ai.usage(30)]);
        return page(req, res, {
            index: true, cache: PUBLIC_CACHE, agentLayer: true,
            title: 'Status', description: 'Uptime per offer, the model changelog and incidents on OpenVibe.Exchange.',
            body: raw(views.statusPage({ catalog, usage })),
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
