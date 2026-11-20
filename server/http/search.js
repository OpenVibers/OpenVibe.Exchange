'use strict';
const express = require('express');
const views = require('../views/search');
const { raw, esc } = require('../render/html');
const { send } = require('../render/layout');
const { sameOrigin } = require('./principal');

const FILTERS = {
    web: ['freshness', 'safe_search'],
    images: ['license', 'commercial', 'format', 'orientation', 'size', 'color', 'after', 'type', 'safe_search'],
    icons: ['set', 'style', 'license', 'format'],
};
const one = (value, max = 80) => String(value == null ? '' : value).slice(0, max);
const capOf = (value) => {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6) / 1e6 : null;
};
function filterBody(body, kind) {
    const out = {};
    for (const key of FILTERS[kind] || []) {
        const value = body[key];
        if (value == null || value === '' || value === 'false') continue;
        if (key === 'commercial') out.commercial = true;
        else if (key === 'safe_search') out.safe_search = 'strict';
        else out[key] = one(value);
    }
    return out;
}
// Search v2 (AI #669; the owner, 11-20: depth you can set, several searches at once, deduplicated, sourced answers).
const DEPTHS = ['instant', 'fast', 'standard', 'deep'];
// How long the page waits for each depth: a deep search reads pages and asks a model twice.
const DEPTH_WAIT_MS = { instant: 15_000, fast: 20_000, standard: 45_000, deep: 55_000 };   // under nginx's 60 s on openvibe.exchange; the API host gives 120 s
const listOf = (value, max, re) => String(value == null ? '' : value).split(/[\s,]+/).map((x) => x.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '')).filter((x) => x && re.test(x)).slice(0, max);
const SITE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
/** The page's form as a search v2 request (web only): depth, the answer, more searches, sites in and out, a date. */
function v2Body(body, filters) {
    const depth = DEPTHS.includes(body.depth) ? body.depth : 'fast';
    const more = String(body.more || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean).map((x) => x.slice(0, 500)).slice(0, 5);
    const include = listOf(body.include, 20, SITE), exclude = listOf(body.exclude, 20, SITE);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(body.from || '')) ? body.from : null;
    const named = body.engine || body.first;
    const engine = named && named !== 'auto' ? one(named) : null;
    return {
        q: one(body.q, 500), depth, limit: depth === 'deep' ? 15 : 10,
        ...(body.answer === 'true' || body.answer === 'on' || body.answer === '1' ? { output: 'answer' } : {}),
        ...(more.length ? { queries: more } : {}), ...(include.length ? { include_domains: include } : {}),
        ...(exclude.length ? { exclude_domains: exclude } : {}), ...(from ? { from } : {}),
        ...(engine ? { engines: [engine] } : {}), ...filters,
    };
}
/** One engine by default; compare is explicit and runs two or three distinct engines. */
function selectedEngines(body, engines, kind) {
    const mode = body.mode === 'compare' ? 'compare' : 'single';
    if (mode === 'single') return { mode, engines: [(body.engine || body.first) && (body.engine || body.first) !== 'auto' ? one(body.engine || body.first) : 'auto'] };
    const serving = engines.filter((e) => Array.isArray(e.kinds) && e.kinds.includes(kind));
    const picks = [body.first, body.second, body.third]
        .map((x) => one(x)).filter((x) => x && x !== 'auto');
    const unique = [...new Set(picks)].filter((id) => serving.some((e) => e.id === id)).slice(0, 3);
    if (!unique.length) unique.push(...serving.filter((e) => e.available !== false).slice(0, 3).map((e) => e.id));
    return { mode, engines: unique };
}
function why(err) {
    const status = err && err.status;
    if (status === 401 || status === 403) return 'Your sign-in could not search. Sign out and in again.';
    if (status === 429) return 'Too many searches this minute, or the key cap cannot cover this search. Try again shortly.';
    if (status === 422) return (err && err.message) || 'This engine does not take this kind of search or cannot honour a filter.';
    if (status === 503) return (err && err.message) || 'No configured engine serves this search within its price and freshness limits.';
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) return 'This engine took too long, so it was stopped. Try again, or choose another engine.';
    return 'This engine did not answer. Try again, or choose another engine.';
}
/**
 * Runs a single search once, or an explicit comparison sequentially against one combined cap. Sequential
 * calls are deliberate: the remaining cap is passed to each call, so the total can never exceed it.
 */
async function runSearch({ ai, token, body, kind, engines = [], timeoutMs = null }) {
    const chosen = selectedEngines(body, engines, kind);
    const cap = capOf(body.max_cost_usd);
    const filters = filterBody(body, kind);
    // A web search on the page is one search v2 call: its engines side by side, merged, and an answer when asked.
    // Compare stays what it was: two or three engines, each its own list, to see how they differ.
    if (kind === 'web' && chosen.mode === 'single') {
        const payload = v2Body(body, filters);
        if (cap != null) payload.max_cost_usd = cap;
        try {
            const multi = await ai.meRequest(token, '/v1/search', { method: 'POST', body: payload, timeoutMs: Math.max(timeoutMs || 0, DEPTH_WAIT_MS[payload.depth]) });
            return { mode: 'single', engines: chosen.engines, cap, spent: Number(multi.receipt?.cost_usd) || 0, results: [], multi, depth: payload.depth, note: '' };
        } catch (err) {
            console.warn('[exchange] search v2', payload.depth, err && err.status, err && err.code, (err && err.message) || '');
            return { mode: 'single', engines: chosen.engines, cap, spent: 0, results: [], multi: null, depth: payload.depth, note: why(err) };
        }
    }
    const results = [];
    let spent = 0;
    let note = '';
    if (chosen.mode === 'compare' && chosen.engines.length < 2) {
        note = 'Choose two or three engines to compare. One engine is the default, with one cap.';
        return { mode: chosen.mode, engines: chosen.engines, cap, spent, results, note };
    }
    for (const engine of chosen.engines) {
        const remaining = cap == null ? null : Math.max(0, Math.round((cap - spent) * 1e6) / 1e6);
        if (chosen.mode === 'compare' && remaining != null && spent > 0 && remaining <= 0) {
            results.push({ engine, meta: engines.find((e) => e.id === engine) || null, error: 'The one combined cap is spent; this engine was not called.' });
            continue;
        }
        const payload = { q: one(body.q, 500), engine, limit: 6, ...filters };
        if (remaining != null) payload.max_cost_usd = remaining;
        try {
            const out = await ai.meRequest(token, '/v1/search' + (kind === 'web' ? '' : '/' + kind), { method: 'POST', body: payload, ...(timeoutMs ? { timeoutMs } : {}) });
            const actual = out.receipt?.engine || engine;
            results.push({ engine, meta: engines.find((e) => e.id === actual) || engines.find((e) => e.id === engine) || null, ...out });
            spent = Math.round((spent + (Number(out.receipt?.cost_usd) || 0)) * 1e6) / 1e6;
        } catch (err) {
            console.warn('[exchange] search', engine, kind, err && err.status, err && err.code, (err && err.message) || '');
            results.push({ engine, meta: engines.find((e) => e.id === engine) || null, error: why(err) });
        }
    }
    if (cap != null && spent > cap + 1e-9) note = 'A provider may already have billed a timed-out attempt; the combined cap is a limit, not a promise about a failed call.';
    return { mode: chosen.mode, engines: chosen.engines, cap, spent, results, note };
}

/**
 * A web search streamed to the page (plan AD.34 item 4, the owner: "faster responses … dynamic loading"): the page's
 * script posts the form here and gets Server-Sent Events of ready HTML, rendered by the same views as the full page:
 * `html` { live, code? } each time the list grows (round one, the merged list, the passages) or the answer arrives,
 * then `done` with the final view, or `failed` with the reason in words. Without the script the form posts to /search
 * as before.
 */
async function streamSearch({ ai, token, body, engines, apiBase, dive, write }) {
    const filters = filterBody(body, 'web');
    const payload = { ...v2Body(body, filters), stream: true };
    const cap = capOf(body.max_cost_usd);
    if (cap != null) payload.max_cost_usd = cap;
    const wantsAnswer = payload.output === 'answer';
    const reads = payload.depth === 'standard' || payload.depth === 'deep';
    const live = (out) => views.liveBlock({ q: payload.q, kind: 'web', dive, out });
    const code = views.codeCard(payload.q, payload.depth === 'instant' ? 'fast' : payload.depth, wantsAnswer, apiBase);
    const state = { results: [], answer: undefined, queries: {} };
    const pendingWords = (stage) => {
        if (stage === 'first') return 'searching the question from other angles';
        if (stage === 'merged' && payload.depth === 'deep') return 'planning a second round';
        if ((stage === 'merged' || stage === 'second_round') && reads) return 'reading the top pages';
        return wantsAnswer ? 'writing the answer' : 'finishing';
    };
    write('html', { live: live(views.multiResults({ results: [] }, engines, { pending: `searching ${payload.depth === 'instant' ? 'one engine' : 'several engines at once'}`, answering: wantsAnswer })), code });
    let ended = false;
    try {
        await ai.meStream(token, '/v1/search', {
            body: payload, timeoutMs: DEPTH_WAIT_MS[payload.depth],
            onEvent: (event, data) => {
                if (event === 'results' && data && Array.isArray(data.results)) {
                    state.results = data.results;
                    if (data.queries) state.queries = { ...state.queries, ...data.queries };
                    write('html', { live: live(views.multiResults(state, engines, { pending: pendingWords(data.stage), answering: wantsAnswer })) });
                } else if (event === 'answer' && data) {
                    state.answer = data.answer || null;
                    write('html', { live: live(views.multiResults(state, engines, { pending: 'finishing', answering: false })) });
                } else if (event === 'done' && data) {
                    ended = true;
                    write('done', { live: live(views.multiResults(data, engines)), spent: Number(data.receipt && data.receipt.cost_usd) || 0 });
                } else if (event === 'error') {
                    ended = true;
                    const note = why({ status: data && data.status, message: data && data.detail });
                    write('failed', { live: live(`<p class="xs-note">${esc(note)}</p>${state.results.length ? views.multiResults(state, engines, { pending: 'stopped' }) : ''}`) });
                }
            },
        });
        if (!ended) write('failed', { live: live(`<p class="xs-note">${esc('The search stopped before it finished. Try again.')}</p>`) });
    } catch (err) {
        console.warn('[exchange] search stream', payload.depth, err && err.status, err && err.code, (err && err.message) || '');
        if (!ended) write('failed', { live: live(`<p class="xs-note">${esc(why(err))}</p>${state.results.length ? views.multiResults(state, engines, { pending: 'stopped' }) : ''}`) });
    }
}

function createSearchRoutes({ config, ai }) {
    const r = express.Router();
    r.use(express.urlencoded({ extended: false, limit: '8kb' }));
    const render = async (req, res, found = [], query = {}, status = 200) =>
        send(res, status, {
            viewer: req.viewer,
            config,
            path: req.originalUrl,
            title: 'Search',
            description: 'One search API for people and agents: set how deep, run several searches at once, get every engine\'s answers merged and deduplicated, or a sourced answer. One key, a receipt with every answer.',
            body: raw(views.searchPage({ engines: await ai.searchEngines(), found, query, dive: typeof ai.deepDiveDepths === 'function' ? await ai.deepDiveDepths('research').catch(() => null) : null, multi: query.multi || null, apiBase: config.api && config.api.publicUrl, depths: typeof ai.searchDepths === 'function' ? ai.searchDepths() : [] })),
        });
    r.get('/search', (req, res) => {
        const kind = ['web', 'images', 'icons'].includes(req.query.kind) ? req.query.kind : 'web';
        return render(req, res, [], {
            q: one(req.query.q, 500), kind, mode: req.query.mode === 'compare' ? 'compare' : 'single',
            depth: DEPTHS.includes(req.query.depth) ? req.query.depth : 'fast', answer: req.query.answer === '1',
            engine: one(req.query.engine), first: one(req.query.first), second: one(req.query.second), third: one(req.query.third),
            max_cost_usd: req.query.max_cost_usd == null ? '' : one(req.query.max_cost_usd, 30),
            note: req.query.chosen === '1' ? 'The Unsplash download event was recorded once for that picture.' : one(req.query.note, 240),
        }).catch((err) => res.status(500).end(String((err && err.message) || err)));
    });
    r.post('/search', async (req, res) => {
        if (req.viewer?.kind !== 'user')
            return res.redirect(303, '/auth/login?next=%2Fsearch');
        if (!sameOrigin(req, config.baseUrl)) return res.sendStatus(403);
        const kind = ['web', 'images', 'icons'].includes(req.body.kind) ? req.body.kind : 'web';
        const body = req.body || {};
        const out = await runSearch({ ai, token: req.viewer.token, body, kind, engines: await ai.searchEngines(), timeoutMs: config.ai.searchTimeoutMs });
        await render(req, res, out.results, {
            q: one(body.q, 500), kind, mode: out.mode, multi: out.multi || null,
            depth: out.depth || (DEPTHS.includes(body.depth) ? body.depth : 'fast'), answer: body.answer === 'true' || body.answer === 'on' || body.answer === '1',
            more: String(body.more || '').slice(0, 2600), include: one(body.include, 600), exclude: one(body.exclude, 600), from: one(body.from, 10),
            engine: one(body.engine), first: one(body.first), second: one(body.second), third: one(body.third),
            max_cost_usd: capOf(body.max_cost_usd) == null ? '' : String(capOf(body.max_cost_usd)),
            spent: out.spent, note: out.note,
            ...Object.fromEntries(Object.entries(filterBody(body, kind)).map(([key, value]) => [key, String(value)])),
        });
    });
    r.post('/search/stream', async (req, res) => {
        if (req.viewer?.kind !== 'user') return res.status(401).json({ error: 'Sign in to search' });
        if (!sameOrigin(req, config.baseUrl)) return res.sendStatus(403);
        if (typeof ai.meStream !== 'function') return res.status(503).json({ error: 'Streaming is not available' });
        const body = req.body || {};
        const [engines, dive] = await Promise.all([
            ai.searchEngines().catch(() => []),
            typeof ai.deepDiveDepths === 'function' ? ai.deepDiveDepths('research').catch(() => null) : null,
        ]);
        res.status(200).set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
        res.flushHeaders();
        let open = true;
        res.on('close', () => { open = false; });
        const write = (event, data) => { if (open && !res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
        await streamSearch({ ai, token: req.viewer.token, body, engines, apiBase: config.api && config.api.publicUrl, dive, write });
        res.end();
    });
    // A person choosing an Unsplash picture is the moment for its required download event, not search.
    r.post('/search/unsplash', async (req, res) => {
        if (req.viewer?.kind !== 'user')
            return res.redirect(303, '/auth/login?next=%2Fsearch');
        if (!sameOrigin(req, config.baseUrl)) return res.sendStatus(403);
        try {
            await ai.meRequest(req.viewer.token, '/v1/search/images/unsplash/download', {
                method: 'POST', body: { download_location: one(req.body.download_location, 8192) },
            });
            return res.redirect(303, '/search?chosen=1');
        } catch (err) {
            return res.redirect(303, '/search?note=' + encodeURIComponent(why(err)));
        }
    });
    return r;
}
module.exports = { createSearchRoutes, selectedEngines, runSearch, streamSearch, filterBody, v2Body, DEPTHS };
