'use strict';
const express = require('express');
const views = require('../views/search');
const { raw } = require('../render/html');
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
    return 'This engine did not answer. Try again, or choose another engine.';
}
/**
 * Runs a single search once, or an explicit comparison sequentially against one combined cap. Sequential
 * calls are deliberate: the remaining cap is passed to each call, so the total can never exceed it.
 */
async function runSearch({ ai, token, body, kind, engines = [] }) {
    const chosen = selectedEngines(body, engines, kind);
    const cap = capOf(body.max_cost_usd);
    const filters = filterBody(body, kind);
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
            const out = await ai.meRequest(token, '/v1/search' + (kind === 'web' ? '' : '/' + kind), { method: 'POST', body: payload });
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

function createSearchRoutes({ config, ai }) {
    const r = express.Router();
    r.use(express.urlencoded({ extended: false, limit: '8kb' }));
    const render = async (req, res, found = [], query = {}, status = 200) =>
        send(res, status, {
            viewer: req.viewer,
            config,
            path: req.originalUrl,
            title: 'Search',
            description: 'One search API for the web, pictures and icons: many engines, one key, a receipt with every answer.',
            body: raw(views.searchPage({ engines: await ai.searchEngines(), found, query })),
        });
    r.get('/search', (req, res) => {
        const kind = ['web', 'images', 'icons'].includes(req.query.kind) ? req.query.kind : 'web';
        return render(req, res, [], {
            q: one(req.query.q, 500), kind, mode: req.query.mode === 'compare' ? 'compare' : 'single',
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
        const out = await runSearch({ ai, token: req.viewer.token, body, kind, engines: await ai.searchEngines() });
        await render(req, res, out.results, {
            q: one(body.q, 500), kind, mode: out.mode,
            engine: one(body.engine), first: one(body.first), second: one(body.second), third: one(body.third),
            max_cost_usd: capOf(body.max_cost_usd) == null ? '' : String(capOf(body.max_cost_usd)),
            spent: out.spent, note: out.note,
            ...Object.fromEntries(Object.entries(filterBody(body, kind)).map(([key, value]) => [key, String(value)])),
        });
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
module.exports = { createSearchRoutes, selectedEngines, runSearch, filterBody };
