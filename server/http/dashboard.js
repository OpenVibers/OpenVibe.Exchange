'use strict';
const express = require('express');
const kit = require('openvibe-shared/kit');
const { esc, raw } = require('../render/html');
const { send } = require('../render/layout');
const { sameOrigin } = require('./principal');
const TABS = ['Keys', 'Usage', 'Credits', 'Deployments', 'Settings'];
function createDashboardRoutes({ config, ai }) {
    const r = express.Router();
    r.use(express.urlencoded({ extended: false, limit: '32kb' }));
    const render = (req, res, tab, body, status = 200) =>
        send(res, status, {
            viewer: req.viewer,
            config,
            path: req.originalUrl,
            index: false,
            title: 'Dashboard · ' + tab,
            body: raw(
                `<div class="ex-wrap xp">${kit.head({ title: 'Dashboard', sub: 'Your keys, usage and endpoints' })}<nav class="xp-tabs" aria-label="Dashboard">${TABS.map((t) => `<a href="/dashboard/${t.toLowerCase()}" ${t === tab ? 'aria-current="page"' : ''}>${t}</a>`).join('')}</nav><h2>${esc(tab)}</h2>${body}</div>`,
            ),
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
            render(
                req,
                res,
                'Unavailable',
                '<p>The account API could not complete this request. Try again shortly.</p>',
                502,
            );
        }
    };
    r.get(
        ['/dashboard', '/dashboard/keys'],
        safe(async (req, res) => {
            const data = await call(req, '/api/v1/exchange/keys');
            render(
                req,
                res,
                'Keys',
                `<p>Keys are shown once. The monthly cap applies to this key’s model calls.</p><ul>${(data.keys || []).map((k) => `<li><strong>${esc(k.name)}</strong> · ${esc(k.prefix)}… · $${Number(k.monthly_cap_usd)} / month ${k.expires_at ? ' · Expires ' + esc(k.expires_at) : ''} ${k.revoked_at ? 'Revoked' : `<form method="post" action="/dashboard/keys/${encodeURIComponent(k.id)}/revoke">${kit.button({ label: 'Revoke', type: 'submit', kind: 'quiet' })}</form>`}</li>`).join('')}</ul><form id="new" method="post" action="/dashboard/keys"><label>Name<input name="name" required maxlength="80"></label><label>Monthly cap (USD)<input name="monthly_cap_usd" type="number" min="0" step="0.01" value="0" required></label><label>Expiry (UTC; optional)<input name="expires_at" type="datetime-local"></label><label>Allowed models (comma separated; empty allows all)<input name="allowed_models"></label>${kit.button({ label: 'Create key', type: 'submit' })}</form>`,
            );
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
            render(
                req,
                res,
                'Keys',
                `<p>Copy this key now. It will not be shown again.</p>${kit.snippet({ code: data.secret, id: 'new-key' })}<a href="/dashboard/keys">Done</a>`,
            );
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
            render(
                req,
                res,
                'Usage',
                `<p><a href="/dashboard/usage.csv">Download CSV</a></p>${kit.table({ columns: columns.map((key) => ({ key, label: key.replaceAll('_', ' ') })), rows, label: 'Usage by key, model and day', empty: 'No usage yet.' })}`,
            );
        }),
    );
    r.get('/dashboard/credits', (req, res) =>
        render(
            req,
            res,
            'Credits',
            '<p>Your OpenVibe wallet is managed by Billing.</p><p><a class="ovk-button" href="https://openvibe.network/my#wallet">Balance, top up and auto top-up</a></p>',
        ),
    );
    r.get(
        '/dashboard/deployments',
        safe(async (req, res) => {
            const data = await ai.ownList(req.viewer.token);
            render(
                req,
                res,
                'Deployments',
                `<p>Choose a model to see its hourly price before starting. Endpoints stop when idle.</p><a href="/own">Quote an endpoint</a>${kit.table(
                    {
                        columns: [
                            { key: 'id', label: 'Endpoint' },
                            { key: 'model', label: 'Model' },
                            { key: 'status', label: 'Status' },
                        ],
                        rows: data.endpoints || [],
                        empty: 'No deployments yet.',
                    },
                )}`,
            );
        }),
    );
    r.get('/dashboard/settings', (req, res) =>
        render(
            req,
            res,
            'Settings',
            '<p><a href="/uncensored">Adult opt-in (18+) and content floor</a></p><p><a href="/privacy/keys">Your provider keys and data policy</a></p><p><a href="/api#privacy">Routing and strict privacy</a></p>',
        ),
    );
    return r;
}
module.exports = { createDashboardRoutes };
