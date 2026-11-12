'use strict';
/**
 * /deep-dive: start a run, follow its steps, choose sites, read the report, export it, and stream a private
 * screenshot back (AI holds it; Exchange never stores someone else's captures).
 *
 * The person's session is the only way in: POST needs the signed-in viewer (AI gets them as on_behalf_of), every
 * read is AI's owner-checked answer, and a signed-out visitor gets the explanation and a sign-in button. Same-origin
 * on every POST. JavaScript is optional: the forms are plain POSTs and the run page still says what every step is;
 * a small poll keeps the progress current while a run is live.
 */
const express = require('express');
const views = require('../views/deep-dive');
const { raw } = require('../render/html');
const { send } = require('../render/layout');
const { sameOrigin } = require('./principal');

function createDeepDiveRoutes({ config, ai, log = console }) {
    const r = express.Router();
    r.use(express.urlencoded({ extended: false, limit: '32kb' }));

    const page = (req, res, o, status = 200) => send(res, status, { viewer: req.viewer, config, path: req.originalUrl, ...o });
    const signedIn = (req) => Boolean(req.viewer && req.viewer.kind === 'user' && req.viewer.subject);
    const errorOf = (err) => {
        if (!err) return null;
        if (err.status === 401) return 'Your session has expired. Sign in again.';
        if (err.status === 402) return err.message || 'Your allowance cannot pay for this run.';
        if (err.status === 422) return err.message || 'That input was not accepted.';
        if (err.status === 503) return err.message || 'OpenVibe.AI is not available right now.';
        return err.message || 'OpenVibe.AI could not answer.';
    };

    async function stateOf(id) {
        const out = await ai.deepDiveState(id);
        return out.deep_dive || null;
    }

    r.get('/deep-dive', async (req, res) => {
        let depths = [];
        let capture = null;
        try { const d = await ai.deepDiveDepths(); depths = d.depths || []; capture = d.capture || null; } catch (err) { log.warn('[deep-dive] depths:', String(err && err.message || err).slice(0, 160)); }
        page(req, res, { title: 'Deep dive', description: 'Expert design research: search everywhere, capture the best sites at phone and computer sizes, and read what works and why.', body: raw(views.homePage({ viewer: req.viewer, depths, capture })) });
    });

    r.post('/deep-dive', async (req, res) => {
        if (!signedIn(req)) return res.redirect(303, `/auth/login?next=${encodeURIComponent('/deep-dive')}`);
        if (!sameOrigin(req, config.baseUrl)) return res.sendStatus(403);
        const question = String(req.body.question || '').replace(/\s+/g, ' ').trim().slice(0, 500);
        const depth = ['quick', 'thorough', 'expert'].includes(req.body.depth) ? req.body.depth : 'quick';
        const sites = String(req.body.sites || '').split(/\r?\n/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s)).slice(0, 30);
        if (!question) {
            const d = await ai.deepDiveDepths().catch(() => ({ depths: [] }));
            return page(req, res, { title: 'Deep dive', index: false, body: raw(views.homePage({ viewer: req.viewer, depths: d.depths, error: 'Say what you are designing first.' })) }, 422);
        }
        try {
            const out = await ai.deepDiveCreate({ question, depth, sites, subject: req.viewer.subject });
            const id = out.deep_dive && out.deep_dive.id;
            if (!id) throw Object.assign(new Error('AI did not return a deep dive id'), { status: 502 });
            return res.redirect(303, `/deep-dive/${encodeURIComponent(id)}`);
        } catch (err) {
            const d = await ai.deepDiveDepths().catch(() => ({ depths: [] }));
            const status = err.status === 402 ? 402 : err.status === 422 ? 422 : 502;
            return page(req, res, { title: 'Deep dive', index: false, body: raw(views.homePage({ viewer: req.viewer, depths: d.depths, error: errorOf(err) })) }, status);
        }
    });

    r.get('/deep-dive/:id', async (req, res) => {
        if (!signedIn(req)) return page(req, res, { title: 'Deep dive', body: raw(views.homePage({ viewer: null, depths: [], error: null })) }, 401);
        try {
            const out = await ai.deepDiveGet(req.params.id);
            const row = out.deep_dive;
            if (!row) throw Object.assign(new Error('No such deep dive'), { status: 404 });
            const title = row.question || 'Deep dive';
            if (row.status === 'succeeded' && row.report) return page(req, res, { title, description: 'A deep dive report with its sources, captures, synthesis and receipts.', body: raw(views.reportPage({ viewer: req.viewer, row, id: row.id })) });
            return page(req, res, { title, index: false, body: raw(views.runPage({ viewer: req.viewer, row, id: row.id })) });
        } catch (err) {
            const status = err.status === 404 ? 404 : 502;
            return page(req, res, { title: status === 404 ? 'Not found' : 'Deep dive', index: false, body: raw(`<div class="ex-wrap ex-narrow">${status === 404 ? require('openvibe-shared/kit').empty({ icon: 'search', title: 'No such deep dive', text: 'It may belong to another account, or the link is old.', action: { href: '/deep-dive', label: 'Deep dive' } }) : require('openvibe-shared/kit').empty({ title: 'OpenVibe.AI is unavailable', text: errorOf(err), action: { href: '/deep-dive', label: 'Try again' } })}</div>`) }, status);
        }
    });

    r.get('/deep-dive/:id/state', async (req, res) => {
        if (!signedIn(req)) return res.status(401).json({ error: 'sign in' });
        try {
            const out = await ai.deepDiveState(req.params.id);
            res.set('Cache-Control', 'no-store');
            res.json(out);
        } catch (err) { res.status(err.status === 404 ? 404 : 502).json({ error: errorOf(err) }); }
    });

    r.post('/deep-dive/:id/sites', async (req, res) => {
        if (!signedIn(req)) return res.redirect(303, `/auth/login?next=${encodeURIComponent(`/deep-dive/${req.params.id}`)}`);
        if (!sameOrigin(req, config.baseUrl)) return res.sendStatus(403);
        const add = String(req.body.sites || '').split(/\r?\n/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s)).slice(0, 30);
        const drop = req.body.drop ? [String(req.body.drop)] : [];
        try { await ai.deepDiveSites(req.params.id, { add, drop, start: true }); } catch (err) { log.warn('[deep-dive] sites:', String(err && err.message || err).slice(0, 160)); }
        res.redirect(303, `/deep-dive/${encodeURIComponent(req.params.id)}`);
    });

    r.post('/deep-dive/:id/cancel', async (req, res) => {
        if (!signedIn(req)) return res.redirect(303, `/auth/login?next=${encodeURIComponent(`/deep-dive/${req.params.id}`)}`);
        if (!sameOrigin(req, config.baseUrl)) return res.sendStatus(403);
        try { await ai.deepDiveCancel(req.params.id); } catch (err) { log.warn('[deep-dive] cancel:', String(err && err.message || err).slice(0, 160)); }
        res.redirect(303, `/deep-dive/${encodeURIComponent(req.params.id)}`);
    });

    r.get('/deep-dive/:id/shot/:shot', async (req, res) => {
        if (!signedIn(req)) return res.sendStatus(401);
        try {
            const got = await ai.deepDiveShot(req.params.id, req.params.shot);
            res.set({ 'Content-Type': got.contentType, 'Cache-Control': 'private, max-age=60', 'X-Robots-Tag': 'noindex' });
            res.send(got.buffer);
        } catch (err) { res.status(err.status === 404 ? 404 : 502).end(); }
    });

    r.get('/deep-dive/:id/export/json', async (req, res) => {
        if (!signedIn(req)) return res.redirect(303, `/auth/login?next=${encodeURIComponent(`/deep-dive/${req.params.id}`)}`);
        try {
            const out = await ai.deepDiveGet(req.params.id);
            const report = out.deep_dive && out.deep_dive.report;
            if (!report) return res.status(409).send('The deep dive has not written its report yet.');
            res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="deep-dive-${req.params.id}.json"`, 'Cache-Control': 'private, no-store' });
            res.send(JSON.stringify(report, null, 2));
        } catch (err) { res.status(err.status === 404 ? 404 : 502).send(errorOf(err)); }
    });

    r.get('/deep-dive/:id/export/markdown', async (req, res) => {
        if (!signedIn(req)) return res.redirect(303, `/auth/login?next=${encodeURIComponent(`/deep-dive/${req.params.id}`)}`);
        try {
            const out = await ai.deepDiveGet(req.params.id);
            const report = out.deep_dive && out.deep_dive.report;
            if (!report) return res.status(409).send('The deep dive has not written its report yet.');
            res.set({ 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="deep-dive-${req.params.id}.md"`, 'Cache-Control': 'private, no-store' });
            res.send(views.exportMarkdown(report));
        } catch (err) { res.status(err.status === 404 ? 404 : 502).send(errorOf(err)); }
    });

    return r;
}

module.exports = { createDeepDiveRoutes };
