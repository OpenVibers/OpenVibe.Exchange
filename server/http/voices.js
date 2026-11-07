'use strict';

/**
 * An agent's voice published here (actor.voice@1). The listing kind "agent voice" is free: there is no price and no
 * money in it, a voice is borrowed. The moderation is the one a listing has always had here: the author publishes
 * and may take it down, staff may hide it, and every status change is an event row (exchange_agent_voice_events).
 *
 *   /voices                     the published voices
 *   /voices/new                 publish one (the export from OpenVibe.Actor comes with the link)
 *   /voices/:slug               one voice: its bio, its rules, the level it asks for, and Borrow
 *   /voices/:slug/voice.json    the document itself, as JSON (what OpenVibe.Actor's borrow reads)
 */
const express = require('express');
const { asyncRouter } = require('./router');
const { sameOrigin } = require('./principal');
const { raw } = require('../render/html');
const { send } = require('../render/layout');
const { isStaff } = require('../identity/staff');
const voices = require('../agent-voices');
const views = require('../views/voices');

function createVoiceRoutes(ctx) {
    const { config, s, log } = ctx;
    const r = asyncRouter();
    r.use(express.urlencoded({ extended: false, limit: '64kb' }));
    const page = (req, res, o, status = 200) => send(res, status, { viewer: req.viewer, config, path: req.originalUrl, ...o });
    const signedIn = (req) => Boolean(req.viewer && req.viewer.kind === 'user' && req.viewer.subject);
    const notFromHere = (req, res) => page(req, res, { title: 'Not from this site', index: false, body: raw('<div class="ex-wrap ex-narrow"><p>Use the form on OpenVibe.Exchange.</p></div>') }, 403);
    const actorUrl = config.actorUrl || 'https://openvibe.actor';

    r.get('/voices', async (req, res) => {
        const rows = await voices.list(s);
        page(req, res, { title: 'Agent voices', body: raw(views.voicesPage({ rows })) });
    });

    // The publish form. The link from OpenVibe.Actor carries the document, so the author sees it before it is
    // published.
    r.get('/voices/new', async (req, res) => {
        let doc = null;
        let error = null;
        const raw0 = String((req.query || {}).doc || '');
        if (raw0) {
            let input = null;
            try { input = JSON.parse(Buffer.from(raw0, 'base64url').toString('utf8')); } catch { error = 'That link did not carry a voice file.'; }
            if (input) { const read = voices.read(input); if (read.error) error = read.error; else doc = read.doc; }
        }
        page(req, res, { title: 'Publish an agent\'s voice', body: raw(views.voiceNewPage({ doc, error })) }, error ? 422 : 200);
    });

    r.post('/voices', async (req, res) => {
        if (!signedIn(req)) return res.redirect(303, '/auth/login?next=' + encodeURIComponent('/voices/new'));
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const read = voices.read(safeJson((req.body || {}).voice));
        if (read.error) return page(req, res, { title: 'Publish an agent\'s voice', body: raw(views.voiceNewPage({ doc: null, error: read.error })) }, 422);
        const row = await voices.publish(s, req.viewer.subject, read.doc);
        res.redirect(303, '/voices/' + row.slug);
    });

    r.get('/voices/:slug', async (req, res) => {
        const row = await voices.get(s, req.params.slug);
        if (!row || row.status !== 'listed') return page(req, res, { title: 'Voice not found', body: raw('<div class="ex-wrap ex-narrow"><h1>Voice not found</h1><p><a href="/voices">Agent voices</a></p></div>') }, 404);
        const doc = voices.read(row.voice).doc || row.voice;
        const borrowUrl = actorUrl + '/borrow?url=' + encodeURIComponent(config.baseUrl.replace(/\/$/, '') + voices.documentPath(row.slug));
        page(req, res, { title: doc.name, body: raw(views.voicePage({ row, doc, borrowUrl, isOwner: signedIn(req) && req.viewer.subject === row.owner, isStaff: isStaff(req.viewer) })) });
    });

    // The document itself: what OpenVibe.Actor's borrow reads.
    r.get('/voices/:slug/voice.json', async (req, res) => {
        const row = await voices.get(s, req.params.slug);
        if (!row || row.status !== 'listed') return res.status(404).json({ error: 'No such voice.' });
        res.set('Content-Type', 'application/json; charset=utf-8');
        res.json(row.voice);
    });

    // The author takes it down.
    r.post('/voices/:slug/close', async (req, res) => {
        if (!signedIn(req)) return res.redirect(303, '/auth/login?next=' + encodeURIComponent('/voices'));
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const row = await voices.get(s, req.params.slug);
        if (!row) return res.redirect(303, '/voices');
        if (row.owner !== req.viewer.subject) return page(req, res, { title: 'Not yours', body: raw('<div class="ex-wrap ex-narrow"><p>That voice is not yours.</p></div>') }, 403);
        await voices.close(s, row, req.viewer.subject);
        res.redirect(303, '/voices');
    });

    // Staff take it down.
    r.post('/voices/:slug/hide', async (req, res) => {
        if (!signedIn(req) || !isStaff(req.viewer)) return page(req, res, { title: 'Not staff', body: raw('<div class="ex-wrap ex-narrow"><p>That is for staff.</p></div>') }, 403);
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const row = await voices.get(s, req.params.slug);
        if (row) await voices.hide(s, row, req.viewer.subject);
        res.redirect(303, '/voices');
    });

    return r;
}

/** The pasted file may be a document or a JSON string of one. */
function safeJson(text) {
    if (text && typeof text === 'object') return text;
    try { return JSON.parse(String(text || '')); } catch { return null; }
}

module.exports = { createVoiceRoutes };
