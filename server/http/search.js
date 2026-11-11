'use strict';
const express = require('express');
const views = require('../views/search');
const { raw } = require('../render/html');
const { send } = require('../render/layout');
const { sameOrigin } = require('./principal');
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
    r.get('/search', (req, res) => render(req, res).catch((err) => res.status(500).end(String(err && err.message || err))));
    r.post('/search', async (req, res) => {
        if (req.viewer?.kind !== 'user')
            return res.redirect(303, '/auth/login?next=%2Fsearch');
        if (!sameOrigin(req, config.baseUrl)) return res.sendStatus(403);
        const kind = ['web', 'images', 'icons'].includes(req.body.kind)
            ? req.body.kind
            : 'web';
        const results = await Promise.all(
            [req.body.first, req.body.second].map(async (engine) => {
                try {
                    return {
                        engine,
                        ...(await ai.meRequest(
                            req.viewer.token,
                            '/v1/search' + (kind === 'web' ? '' : '/' + kind),
                            {
                                method: 'POST',
                                body: { q: req.body.q, engine, limit: 6, safe_search: 'strict',
                                    ...Object.fromEntries(['size', 'color', 'type', 'license', 'after'].filter((key) => req.body[key]).map((key) => [key, String(req.body[key]).slice(0, 80)])) },
                            },
                        )),
                    };
                } catch {
                    return {
                        engine,
                        error: 'This engine is unavailable or does not support this search kind.',
                    };
                }
            }),
        );
        await render(req, res, results, { q: String(req.body.q || '').slice(0, 500), kind,
            ...Object.fromEntries(['size', 'color', 'type', 'license', 'after'].map((key) => [key, String(req.body[key] || '').slice(0, 80)])) });
    });
    return r;
}
module.exports = { createSearchRoutes };
