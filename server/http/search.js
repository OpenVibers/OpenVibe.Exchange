'use strict';
const express = require('express');
const kit = require('openvibe-shared/kit');
const { esc, raw } = require('../render/html');
const { send } = require('../render/layout');
const { sameOrigin } = require('./principal');
function createSearchRoutes({ config, ai }) {
    const r = express.Router();
    r.use(express.urlencoded({ extended: false, limit: '8kb' }));
    const engines = [
        ['openvibe', 'OpenVibe Search', 'web'],
        ['searxng', 'SearXNG', 'web · requires an operator instance'],
        ['openverse', 'Openverse', 'images · CC licences'],
        ['commons', 'Wikimedia Commons', 'images · attribution'],
        ['iconify', 'Iconify', 'icons · SVG'],
    ];
    const render = (req, res, results = [], status = 200) =>
        send(res, status, {
            viewer: req.viewer,
            config,
            path: req.originalUrl,
            title: 'Search',
            body: raw(
                `<div class="ex-wrap xp">${kit.head({ title: 'One search API, many engines', sub: 'One key for models, web search, images and icons.' })}<div class="xp-reasons">${engines.map(([id, name, kind]) => kit.section({ title: name, body: `<p>${esc(kind)}</p><p>$0 per 1,000 · no account required</p><p>Freshness: index dependent · BYOK: not required</p>` })).join('')}</div><h2>Try two engines</h2><form method="post" action="/search"><label>Query<input name="q" required maxlength="500"></label><label>Kind<select name="kind"><option>web</option><option>images</option><option>icons</option></select></label>${['first', 'second'].map((k, i) => `<label>${i ? 'Second' : 'First'} engine<select name="${k}">${engines.map(([id, name]) => `<option value="${id}">${name}</option>`).join('')}</select></label>`).join('')}${kit.button({ label: 'Compare results', type: 'submit' })}</form><div class="xp-search-results">${results.map((x) => `<section><h3>${esc(x.engine)}</h3>${x.error ? `<p>${esc(x.error)}</p>` : `<p>$${Number(x.receipt.cost_usd)} · ${Number(x.receipt.time_ms)} ms</p><ol>${x.results.map((r) => `<li><a href="${esc(r.source_page || r.url)}" rel="noopener noreferrer">${esc(r.title)}</a><p>${esc(r.snippet || r.attribution || '')}</p></li>`).join('')}</ol>`}</section>`).join('')}</div><p>Image search powered by Openverse and Wikimedia Commons. Keep the returned attribution with each image.</p><p>Paid engines and BYOK providers will become available after their owner accounts and prices are configured.</p></div>`,
            ),
        });
    r.get('/search', (req, res) => render(req, res));
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
                                body: { q: req.body.q, engine, limit: 6 },
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
        render(req, res, results);
    });
    return r;
}
module.exports = { createSearchRoutes };
