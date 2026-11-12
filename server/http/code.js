'use strict';
/**
 * /code and the public code API.
 *
 *   GET /code?q=&list=trending|week|hot|new|top&lang=
 *       The page: a deep search box, the rankings, twelve language chips and one card per repository.
 *   GET /api/v1/code/repos?list=trending|week|month|hot|new|top&lang=&topic=&limit=
 *   GET /api/v1/code/search?q=&lang=&sort=stars|updated|best&page=
 *       Public, signed-out, cached. The search is cached ten minutes and rate-limited per actor (a person by
 *       subject, a visitor by address); the rankings 60 seconds. Sources is the only upstream.
 */
const express = require('express');
const cache = require('openvibe-shared/cache-policy');
const { http } = require('openvibe-contracts');
const views = require('../views/code');
const { raw } = require('../render/html');
const { send } = require('../render/layout');

const LISTS = new Set(['trending', 'week', 'month', 'hot', 'new', 'top']);
const TAB_LISTS = new Set(['trending', 'week', 'hot', 'new', 'top']);
const SORTS = new Set(['stars', 'updated', 'best']);
const PUBLIC_HTML = cache.htmlHeaders({ maxAge: 60 });
const text = (v, max) => (v == null ? null : String(v).trim().slice(0, max) || null);

function createCodeRoutes({ config, code, log = console }) {
    const r = express.Router();

    r.get('/code', async (req, res) => {
        const q = text(req.query.q, 200);
        const askedList = text(req.query.list, 20) || 'trending';
        const list = TAB_LISTS.has(askedList) ? askedList : 'trending';
        const lang = text(req.query.lang, 60);
        const now = Date.now();
        let repos = [];
        let total = null;
        let stale = false;
        let unavailable = false;
        let notice = '';
        try {
            if (q) {
                const gate = code.allow(req.viewer && req.viewer.subject ? req.viewer.subject : req.ip);
                if (!gate.allowed) {
                    notice = `Too many searches from this account this minute. Try again in ${gate.retryAfter} seconds.`;
                } else {
                    const out = await code.search({ q, lang, sort: 'best', page: 1 });
                    repos = out.items || [];
                    total = out.total == null ? null : Number(out.total);
                    stale = Boolean(out.stale);
                }
            } else {
                const out = await code.repos({ list, lang, topic: null, limit: 24 });
                repos = out.items || [];
                stale = Boolean(out.stale);
            }
        } catch (err) {
            unavailable = true;
            log.warn(`[exchange] /code: ${String((err && err.message) || err).slice(0, 160)}`);
        }
        return send(res, 200, {
            viewer: req.viewer, config, path: req.originalUrl,
            title: q ? `Code: ${q}` : 'Code',
            description: 'GitHub repositories trending today, this week and hot by stars gained, with search and a language filter. Read through OpenVibe.Sources.',
            index: true, cache: PUBLIC_HTML, agentLayer: true,
            body: raw(views.codePage({ list, lang, q: q || '', repos, total, now, stale, unavailable, search: Boolean(q), notice })),
        });
    });

    r.get('/api/v1/code/repos', async (req, res) => {
        const list = text(req.query.list, 20) || 'trending';
        if (!LISTS.has(list)) return http.sendProblem(res, 422, 'code.bad_query', { detail: `list must be one of ${[...LISTS].join('|')}`, ctx: req.ov });
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 30, 1), 100);
        try {
            const out = await code.repos({ list, lang: text(req.query.lang, 60), topic: text(req.query.topic, 50), limit });
            res.set('Cache-Control', out.stale ? 'public, max-age=30' : 'public, max-age=60');
            res.json(out);
        } catch (err) {
            return http.sendProblem(res, 503, 'code.unavailable', { detail: 'The repository list is not available right now', ctx: req.ov });
        }
    });

    r.get('/api/v1/code/search', async (req, res) => {
        const q = text(req.query.q, 300);
        if (!q) return http.sendProblem(res, 422, 'code.bad_query', { detail: 'q is required', ctx: req.ov });
        const sort = text(req.query.sort, 10) || 'best';
        if (!SORTS.has(sort)) return http.sendProblem(res, 422, 'code.bad_query', { detail: 'sort must be stars, updated or best', ctx: req.ov });
        const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), 10);
        const actor = req.viewer && req.viewer.subject ? req.viewer.subject : req.ip;
        const gate = code.allow(actor);
        if (!gate.allowed) {
            res.set('Retry-After', String(gate.retryAfter));
            return http.sendProblem(res, 429, 'code.rate_limited', { detail: 'Too many repository searches this minute', ctx: req.ov });
        }
        try {
            const out = await code.search({ q, lang: text(req.query.lang, 60), sort, page });
            res.set('Cache-Control', out.stale ? 'public, max-age=30' : 'public, max-age=600');
            res.json(out);
        } catch (err) {
            if (err && err.code === 'code.rate_limited') {
                res.set('Retry-After', String(err.retryAfter || 60));
                return http.sendProblem(res, 429, 'code.rate_limited', { detail: 'GitHub asked us to wait before another search', ctx: req.ov });
            }
            return http.sendProblem(res, 503, 'code.unavailable', { detail: 'GitHub search is not available right now', ctx: req.ov });
        }
    });

    return r;
}

module.exports = { createCodeRoutes, LISTS, SORTS };
