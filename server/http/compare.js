'use strict';

/**
 * /api/v1/compare — openvibe.compare's JSON (plan 297/300/301). Mounted before Exchange v1's 410.
 *
 *   GET   /api/v1/compare                         the kinds, the method and the links
 *   GET   /api/v1/compare/ai/models?q=&family=&kind=&sort=&offset=&limit=
 *   GET   /api/v1/compare/ai/models/:org/:model    one model, its price book, quality and versions
 *   GET   /api/v1/compare/ai?models=a,b            two to four models, side by side
 *   GET   /api/v1/compare/ai/versions              every model line with two or more versions
 *   GET   /api/v1/compare/ai/versions/:key         one line, each version against the one before it
 *   POST  /api/v1/compare/remarks                  a reader's remark becomes a pending benchmark case
 *   GET   /api/v1/compare/remarks?status=pending   the review queue (owner only)
 *   PATCH /api/v1/compare/remarks/:id              accept or reject a pending case (owner only)
 *
 * Everything public is a read of OpenVibe.AI and OpenVibe.Bench, joined in server/compare.js. The remark is the
 * only write, and it is stored in Exchange's own database until a reviewer turns it into a Bench task.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { http } = require('openvibe-contracts');
const { asyncRouter } = require('./router');
const { createCompare, KIND } = require('../compare');

const FIELDS = new Set(['price', 'speed', 'quality', 'privacy', 'context', 'other']);

function createCompareApi(ctx) {
    const { config, ai, bench, s, log } = ctx;
    const engine = ctx.compare || createCompare({ s, ai, bench, config, now: s.now, log });
    const r = asyncRouter();

    r.use(express.json({ limit: '32kb' }));

    const problem = (res, status, code, detail) => http.sendProblem(res, status, code, { detail, ctx: res.req && res.req.ov });
    const failed = (res, err) => {
        log.warn('[OpenVibe.Exchange] Compare failed:', String((err && err.message) || err).slice(0, 200));
        return problem(res, 500, 'compare.failed', 'Compare could not answer. Try again in a moment.');
    };
    const owner = (req) => req.viewer && req.viewer.kind === 'user' && req.viewer.role === 'owner';
    const requireOwner = (req, res) => {
        if (!req.viewer || req.viewer.kind !== 'user') {
            problem(res, 401, 'compare.sign_in_required', 'Sign in as the owner to review benchmark cases.');
            return false;
        }
        if (!owner(req)) {
            problem(res, 403, 'compare.owner_required', 'Only the owner can review benchmark cases.');
            return false;
        }
        return true;
    };
    const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
    const cache = (res, seconds = 60) => res.set('Cache-Control', `public, max-age=${seconds}, stale-while-revalidate=300`);

    r.get('/', async (_req, res) => {
        cache(res, 300);
        return res.json({
            kind: 'compare',
            title: 'Compare anything, starting with AI models',
            generated_at: new Date(s.now()).toISOString(),
            kinds: [{
                id: KIND,
                title: 'AI models',
                what: 'Models with the price of every provider that serves them, measured speed and latency, Bench quality, privacy and tier.',
                endpoints: {
                    models: '/api/v1/compare/ai/models',
                    model: '/api/v1/compare/ai/models/:org/:model',
                    side_by_side: '/api/v1/compare/ai?models=a,b',
                    versions: '/api/v1/compare/ai/versions',
                    remarks: '/api/v1/compare/remarks',
                },
            }],
            method: engine.method,
        });
    });

    r.get('/ai/models', async (req, res) => {
        try {
            const out = await engine.methods.models({
                q: req.query.q, family: req.query.family, kind: req.query.kind, sort: req.query.sort,
                limit: req.query.limit, offset: req.query.offset,
            });
            cache(res, 60);
            return res.json(out);
        } catch (err) { return failed(res, err); }
    });

    r.get('/ai/models/:org/:model', async (req, res) => {
        try {
            const slug = `${req.params.org}/${req.params.model}`;
            const out = await engine.methods.model(slug);
            if (!out) return problem(res, 404, 'compare.model_not_found', `No such model: ${slug}`);
            cache(res, 60);
            return res.json(out);
        } catch (err) { return failed(res, err); }
    });

    r.get('/ai', async (req, res) => {
        try {
            const refs = String(req.query.models || '').split(',').map((x) => x.trim()).filter(Boolean);
            const out = await engine.methods.compare(refs);
            if (out.error) return problem(res, out.status || 400, out.error, out.message);
            cache(res, 30);
            return res.json(out);
        } catch (err) { return failed(res, err); }
    });

    r.get('/ai/versions', async (req, res) => {
        try {
            const out = await engine.methods.versions();
            cache(res, 120);
            return res.json(out);
        } catch (err) { return failed(res, err); }
    });

    r.get('/ai/versions/:key', async (req, res) => {
        try {
            const out = await engine.methods.versions(req.params.key);
            if (!out.lineages.length) return problem(res, 404, 'compare.lineage_not_found', `No model line with versions: ${req.params.key}`);
            out.count = out.lineages.length;
            cache(res, 120);
            return res.json(out);
        } catch (err) { return failed(res, err); }
    });

    // ── The reader's remark (plan 300) ──────────────────────
    // Public intake: one plain-text remark, no account needed, rate-limited. It becomes a pending case for review;
    // it is never run, published or treated as a benchmark result before a person accepts it.
    r.post('/remarks', rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }), async (req, res) => {
        try {
            const b = req.body && typeof req.body === 'object' ? req.body : {};
            const catalog = await ai.catalog();
            if (catalog.unavailable) return problem(res, 503, 'compare.catalog_unavailable', 'The model catalog is not reachable right now, so a remark cannot name a real model. Try again shortly.');
            const slugs = (Array.isArray(b.models) ? b.models : String(b.models || '').split(','))
                .map((x) => clean(x, 160)).filter(Boolean);
            const wanted = [...new Set(slugs)].slice(0, 4);
            if (!wanted.length) return problem(res, 400, 'compare.models_required', 'Name at least one model the remark is about.');
            const bySlug = new Map((catalog.models || []).map((m) => [String(m.slug).toLowerCase(), m]));
            const unknown = wanted.filter((x) => !bySlug.has(x.toLowerCase()));
            if (unknown.length) return problem(res, 400, 'compare.model_not_found', `No such model: ${unknown.join(', ')}`);
            const remark = clean(b.remark, 2000);
            if (remark.length < 10) return problem(res, 400, 'compare.remark_too_short', 'A remark needs at least ten characters.');
            const field = b.field == null || b.field === '' ? null : String(b.field).toLowerCase();
            if (field && !FIELDS.has(field)) return problem(res, 400, 'compare.field_invalid', `field must be one of: ${[...FIELDS].join(', ')}`);
            const comparison = b.comparison == null ? null : clean(b.comparison, 200) || null;
            let sourceUrl = null;
            if (b.source_url) {
                try {
                    const u = new URL(String(b.source_url));
                    if (!['http:', 'https:'].includes(u.protocol)) throw new Error('scheme');
                    sourceUrl = u.toString().slice(0, 500);
                } catch (e) { return problem(res, 400, 'compare.source_url_invalid', 'source_url must be an http or https address.'); }
            }
            const names = wanted.map((x) => bySlug.get(x.toLowerCase()).name).join(', ');
            const proposed = clean(b.proposed_prompt, 4000) || clean(`Test ${names}: ${remark}`, 4000);
            const remarkRow = await engine.methods.remarks.create({
                models: wanted.map((x) => bySlug.get(x.toLowerCase()).slug),
                comparison, field, remark, proposedPrompt: proposed, sourceUrl,
                subject: req.viewer && req.viewer.kind === 'user' ? req.viewer.subject : null,
            });
            res.set('Location', `/api/v1/compare/remarks/${remarkRow.id}`);
            res.set('Cache-Control', 'no-store');
            return res.status(201).json({ remark: remarkRow, next: 'A reviewer reads it and turns it into a Bench task; nothing runs or publishes before that.' });
        } catch (err) { return failed(res, err); }
    });

    r.get('/remarks', async (req, res) => {
        if (!requireOwner(req, res)) return;
        try {
            const status = ['pending', 'accepted', 'rejected'].includes(String(req.query.status)) ? String(req.query.status) : 'pending';
            const items = await engine.methods.remarks.list({ status, limit: req.query.limit });
            res.set('Cache-Control', 'private, no-store');
            return res.json({ status, count: items.length, remarks: items });
        } catch (err) { return failed(res, err); }
    });

    r.get('/remarks/:id', async (req, res) => {
        if (!requireOwner(req, res)) return;
        try {
            const row = await engine.methods.remarks.get(req.params.id);
            if (!row) return problem(res, 404, 'compare.remark_not_found', 'No such remark.');
            res.set('Cache-Control', 'private, no-store');
            return res.json({ remark: row });
        } catch (err) { return failed(res, err); }
    });

    r.patch('/remarks/:id', async (req, res) => {
        if (!requireOwner(req, res)) return;
        try {
            const b = req.body && typeof req.body === 'object' ? req.body : {};
            const decision = b.decision === 'accepted' || b.decision === 'rejected' ? b.decision : null;
            if (!decision) return problem(res, 400, 'compare.decision_invalid', 'decision must be accepted or rejected.');
            const row = await engine.methods.remarks.review({
                id: req.params.id, decision, note: clean(b.note, 1000) || null,
                reviewer: req.viewer.subject || req.viewer.username || 'owner',
            });
            if (!row) return problem(res, 404, 'compare.remark_not_found', 'No pending remark with that id.');
            res.set('Cache-Control', 'private, no-store');
            return res.json({ remark: row });
        } catch (err) { return failed(res, err); }
    });

    return r;
}

module.exports = { createCompareApi };
