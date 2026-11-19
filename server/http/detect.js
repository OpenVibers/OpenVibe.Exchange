'use strict';
/**
 * POST /api/v1/detect — "was this written by an AI?" (server/detect). openvibe.compare/ai/detect passes a person's
 * passage here with their own token, as it does the Arena, so the judges run on their AI allowance:
 *
 *   body   { "text": "…" }                 30 to EXCHANGE_DETECT_MAX_CHARS characters
 *   auth   Bearer, a person's token        the panel of judges; without one, the writing-style reading only
 *   200    the result document (server/detect/index.js), Cache-Control: no-store
 *   422    detect.text_required | detect.too_long
 *
 * Nothing is stored: the passage is read, sent to the judges and answered.
 */
const express = require('express');

function createDetectRoutes({ detector, principal, config }) {
    const r = express.Router();
    const maxChars = (config.detect && config.detect.maxChars) || 12000;
    r.post('/', express.json({ limit: '96kb' }), principal.middleware, async (req, res) => {
        res.set('Cache-Control', 'no-store');
        const text = String((req.body && req.body.text) || '').trim();
        if (text.length < 30) return res.status(422).json({ code: 'detect.text_required', detail: 'Paste a passage of at least a few sentences.' });
        if (text.length > maxChars) return res.status(422).json({ code: 'detect.too_long', detail: `Paste at most ${maxChars.toLocaleString('en-US')} characters.` });
        const subject = req.principal && req.principal.kind === 'user' ? req.principal.subject : null;
        try {
            const out = await detector.detect({ text, subject, clientIp: req.ip });
            return res.json(out);
        } catch (err) {
            return res.status(502).json({ code: 'detect.failed', detail: 'The check could not run. Try again in a moment.' });
        }
    });
    return r;
}

module.exports = { createDetectRoutes };
