'use strict';
const express = require('express');
const { raw } = require('../render/html');
const { send } = require('../render/layout');
const { sameOrigin } = require('./principal');
const views = require('../views/dashboard');
function createDashboardRoutes({ config, ai }) {
    const r = express.Router();
    r.use(express.urlencoded({ extended: false, limit: '32kb' }));
    const render = (req, res, tab, html, status = 200) =>
        send(res, status, {
            viewer: req.viewer,
            config,
            path: req.originalUrl,
            index: false,
            title: 'Dashboard · ' + tab,
            body: raw(html),
        });
    r.use('/dashboard', (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        if (req.viewer?.kind !== 'user')
            return res.redirect(
                303,
                '/auth/login?next=' +
                    encodeURIComponent('/dashboard' + req.url),
            );
        if (req.method !== 'GET' && !sameOrigin(req, config.baseUrl))
            return res.sendStatus(403);
        next();
    });
    const call = (req, path, options) =>
        ai.meRequest(req.viewer.token, path, options);
    const safe = (fn) => async (req, res) => {
        try {
            await fn(req, res);
        } catch {
            render(req, res, 'Unavailable', views.unavailablePage(), 502);
        }
    };
    r.get(
        ['/dashboard', '/dashboard/keys'],
        safe(async (req, res) => {
            const data = await call(req, '/api/v1/exchange/keys');
            render(req, res, 'Keys', views.keysPage(data.keys || []));
        }),
    );
    r.post(
        '/dashboard/keys',
        safe(async (req, res) => {
            const data = await call(req, '/api/v1/exchange/keys', {
                method: 'POST',
                body: {
                    name: req.body.name,
                    ...(req.body.expires_at ? { expires_at: String(req.body.expires_at) + 'Z' } : {}),
                    monthly_cap_usd: Number(req.body.monthly_cap_usd),
                    allowed_models: String(req.body.allowed_models || '')
                        .split(',')
                        .map((s) => s.trim())
                        .filter(Boolean),
                },
            });
            render(req, res, 'Keys', views.newKeyPage(data.secret, data.key));
        }),
    );
    r.post(
        '/dashboard/keys/:id/revoke',
        safe(async (req, res) => {
            await call(
                req,
                '/api/v1/exchange/keys/' + encodeURIComponent(req.params.id),
                { method: 'DELETE' },
            );
            res.redirect(303, '/dashboard/keys');
        }),
    );
    r.get(
        ['/dashboard/usage', '/dashboard/usage.csv'],
        safe(async (req, res) => {
            const data = await call(req, '/api/v1/exchange/key-usage');
            const rows = data.rows || [];
            const keyList = req.path.endsWith('.csv') ? null : await call(req, '/api/v1/exchange/keys').catch(() => ({ keys: [] }));
            const columns = [
                'day',
                'key_id',
                'model',
                'requests',
                'tokens_in',
                'tokens_out',
                'cost_usd',
                'status',
            ];
            if (req.path.endsWith('.csv')) {
                const cell = (v) =>
                    '"' +
                    String(v ?? '')
                        .replace(/^([=+@-])/, "'$1")
                        .replace(/"/g, '""') +
                    '"';
                return res
                    .type('text/csv')
                    .set(
                        'Content-Disposition',
                        'attachment; filename="exchange-usage.csv"',
                    )
                    .send(
                        [
                            columns.join(','),
                            ...rows.map((r) =>
                                columns.map((k) => cell(r[k])).join(','),
                            ),
                        ].join('\n'),
                    );
            }
            render(req, res, 'Usage', views.usagePage(rows, (keyList && keyList.keys) || []));
        }),
    );
    r.get('/dashboard/credits', (req, res) => render(req, res, 'Credits', views.creditsPage()));
    r.get(
        '/dashboard/deployments',
        safe(async (req, res) => {
            const data = await ai.ownList(req.viewer.token);
            render(req, res, 'Deployments', views.deploymentsPage(data.endpoints || []));
        }),
    );
    r.get('/dashboard/settings', (req, res) => render(req, res, 'Settings', views.settingsPage()));
    return r;
}
module.exports = { createDashboardRoutes };
