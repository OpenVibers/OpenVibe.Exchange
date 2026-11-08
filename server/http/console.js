'use strict';

const express = require('express');
const { raw } = require('../render/html');
const { send } = require('../render/layout');
const { consolePage } = require('../views/console');

const READS = Object.freeze({
    overview: '/api/v1/admin/console/overview', providers: '/api/v1/admin/console/providers', models: '/api/v1/models', routes: '/api/v1/routes',
    templates: '/api/v1/templates', workflows: '/api/v1/workflows', runs: '/api/v1/admin/console/runs', quotas: '/api/v1/admin/console/quotas',
    usage: '/api/v1/admin/console/usage', cache: '/api/v1/admin/console/cache', audit: '/api/v1/admin/console/audit',
    gpus: '/api/v1/admin/console/gpus', pricebook: '/api/v1/admin/console/pricebook', exchange: '/api/v1/admin/console/exchange',
    abuse: '/api/v1/admin/console/abuse', glossary: '/api/v1/admin/console/glossary',
});

function createConsoleRoutes({ config, ai }) {
    const r = express.Router();
    r.use(express.urlencoded({ extended: false, limit: '32kb' }));
    const isOwner = (req) => Boolean(req.viewer && req.viewer.kind === 'user' && req.viewer.subject && req.viewer.role === 'owner');
    const page = (req, res, section, data, error = null, status = 200) => send(res, status, {
        viewer: req.viewer, config, path: req.originalUrl, index: false, title: 'AI operator console',
        body: raw(consolePage({ section, data, error })),
    });
    r.use((req, res, next) => isOwner(req) ? next() : res.sendStatus(404));
    r.get('/console/runs/:id', async (req, res) => {
        try { return page(req, res, 'runs', await ai.adminRequest(`/api/v1/admin/console/run?id=${encodeURIComponent(req.params.id)}`)); }
        catch (err) { return page(req, res, 'runs', {}, err.message || 'AI admin API did not answer.', err.status === 404 ? 404 : 502); }
    });
    r.get('/console/gpus/:model/quote', async (req, res) => {
        try {
            const data = await ai.adminRequest(`/api/v1/admin/console/gpus/${encodeURIComponent(req.params.model)}/quote${req.query.strategy ? `?strategy=${encodeURIComponent(req.query.strategy)}` : ''}`);
            return page(req, res, 'gpus', { quote: data });
        } catch (err) { return page(req, res, 'gpus', {}, err.message || 'The GPU quote is unavailable.', 502); }
    });
    r.get('/console/:section/:key', async (req, res) => {
        const { section, key } = req.params;
        const path = section === 'providers' && key === 'new' ? '/api/v1/admin/console/providers'
            : ['providers', 'routes', 'templates', 'workflows'].includes(section) ? `/api/v1/${section}/${encodeURIComponent(key)}` : null;
        if (!path) return res.sendStatus(404);
        try { return page(req, res, section, await ai.adminRequest(path)); }
        catch (err) { return page(req, res, section, {}, err.message || 'AI admin API did not answer.', err.status === 404 ? 404 : 502); }
    });
    r.get(['/console', '/console/:section'], async (req, res) => {
        const section = req.params.section || 'overview';
        const endpoint = READS[section];
        if (!endpoint) return res.sendStatus(404);
        try {
            const data = await ai.adminRequest(endpoint + (req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : ''));
            return page(req, res, section, data);
        } catch (err) {
            return page(req, res, section, {}, err.message || 'AI admin API did not answer.', err.status === 404 ? 404 : 502);
        }
    });
    const sameOrigin = (req) => {
        const origin = req.get('origin');
        if (!origin) return false;
        try { return new URL(origin).origin === new URL(config.baseUrl).origin; } catch { return false; }
    };
    r.post('/console/providers', async (req, res) => {
        if (!sameOrigin(req)) return res.sendStatus(403);
        try {
            await ai.adminRequest('/api/v1/admin/console/providers', { method: 'POST', subject: req.viewer.subject, body: {
                ...req.body, vision: req.body.vision === '1',
            } });
            return res.redirect(303, '/console/providers');
        } catch (err) { return page(req, res, 'providers', {}, err.message || 'The provider could not be added.', 502); }
    });
    r.post('/console/providers/:key/:action', async (req, res) => {
        if (!sameOrigin(req)) return res.sendStatus(403);
        const key = encodeURIComponent(req.params.key);
        const action = req.params.action;
        try {
            if (action === 'status') {
                const endpoint = req.body.status === 'disabled' ? 'disable' : 'enable';
                await ai.adminRequest(`/api/v1/providers/${key}/${endpoint}`, { method: 'POST', subject: req.viewer.subject });
            } else if (action === 'reset') await ai.adminRequest(`/api/v1/providers/${key}/reset`, { method: 'POST', subject: req.viewer.subject });
            else if (action === 'key') await ai.adminRequest(`/api/v1/admin/console/providers/${key}/key`, { method: 'POST', subject: req.viewer.subject, body: { api_key: String(req.body.api_key || '') } });
            else return res.sendStatus(404);
            return res.redirect(303, '/console/providers');
        } catch (err) { return page(req, res, 'providers', {}, err.message || 'The change could not be saved.', 502); }
    });
    r.post('/console/provider-credits', async (req, res) => {
        if (!sameOrigin(req)) return res.sendStatus(403);
        try {
            await ai.adminRequest('/api/v1/admin/console/provider-credits', { method: 'POST', subject: req.viewer.subject, body: { ...req.body, amount_usd: Number(req.body.amount_usd), remaining_as_of_usd: req.body.remaining_as_of_usd === '' ? Number(req.body.amount_usd) : Number(req.body.remaining_as_of_usd) } });
            return res.redirect(303, '/console/providers');
        } catch (err) { return page(req, res, 'providers', {}, err.message || 'The credit record could not be saved.', 502); }
    });
    r.post('/console/provider-credit-preference', async (req, res) => {
        if (!sameOrigin(req)) return res.sendStatus(403);
        try {
            await ai.adminRequest('/api/v1/admin/console/provider-credit-preference', { method: 'POST', subject: req.viewer.subject, body: { provider: req.body.provider, enabled: req.body.enabled === '1', floor_usd: Number(req.body.floor_usd) } });
            return res.redirect(303, '/console/providers');
        } catch (err) { return page(req, res, 'providers', {}, err.message || 'The credit preference could not be saved.', 502); }
    });
    r.post('/console/provider-session-credentials', async (req, res) => {
        if (!sameOrigin(req)) return res.sendStatus(403);
        try {
            await ai.adminRequest('/api/v1/admin/console/provider-session-credentials', { method: 'POST', subject: req.viewer.subject, body: req.body });
            return res.redirect(303, '/console/providers');
        } catch { return page(req, res, 'providers', {}, 'The provider session could not be saved.', 502); }
    });
    r.post('/console/provider-session-credentials/:id/remove', async (req, res) => {
        if (!sameOrigin(req)) return res.sendStatus(403);
        try {
            await ai.adminRequest(`/api/v1/admin/console/provider-session-credentials/${encodeURIComponent(req.params.id)}`, { method: 'DELETE', subject: req.viewer.subject });
            return res.redirect(303, '/console/providers');
        } catch { return page(req, res, 'providers', {}, 'The provider session could not be removed.', 502); }
    });
    r.post('/console/workflows/:key/versions/:version/status', async (req, res) => {
        if (!sameOrigin(req)) return res.sendStatus(403);
        try {
            await ai.adminRequest(`/api/v1/workflows/${encodeURIComponent(req.params.key)}/versions/${encodeURIComponent(req.params.version)}/status`, { method: 'POST', subject: req.viewer.subject, body: { status: req.body.status } });
            return res.redirect(303, '/console/workflows');
        } catch (err) { return page(req, res, 'workflows', {}, err.message || 'The change could not be saved.', 502); }
    });
    r.post('/console/models/:provider/:model/status', async (req, res) => {
        if (!sameOrigin(req)) return res.sendStatus(403);
        try {
            const status = req.body.status === 'disabled' ? 'disabled' : 'active';
            await ai.adminRequest(`/api/v1/models/${encodeURIComponent(req.params.provider)}/${encodeURIComponent(req.params.model)}`, { method: 'PATCH', subject: req.viewer.subject, body: { status } });
            return res.redirect(303, '/console/models');
        } catch (err) { return page(req, res, 'models', {}, err.message || 'The change could not be saved.', 502); }
    });
    r.post('/console/quotas', async (req, res) => {
        if (!sameOrigin(req)) return res.sendStatus(403);
        try {
            const b = req.body || {};
            const body = { scope_type: String(b.scope_type || ''), scope_id: String(b.scope_id || ''), window: String(b.window || 'day') };
            for (const k of ['max_requests', 'max_tokens', 'max_cost_usd']) if (b[k] !== '' && b[k] != null) body[k] = Number(b[k]);
            await ai.adminRequest('/api/v1/quotas', { method: 'POST', subject: req.viewer.subject, body });
            return res.redirect(303, '/console/quotas');
        } catch (err) { return page(req, res, 'quotas', {}, err.message || 'The quota could not be saved.', 502); }
    });
    r.post('/console/cache/purge', async (req, res) => {
        if (!sameOrigin(req)) return res.sendStatus(403);
        try {
            const q = req.body.workflow ? `?workflow=${encodeURIComponent(req.body.workflow)}` : '';
            await ai.adminRequest(`/api/v1/cache${q}`, { method: 'DELETE', subject: req.viewer.subject });
            return res.redirect(303, '/console/cache');
        } catch (err) { return page(req, res, 'cache', {}, err.message || 'The cache could not be purged.', 502); }
    });
    r.post('/console/gpus/:model/:action', async (req, res) => {
        if (!sameOrigin(req)) return res.sendStatus(403);
        try {
            await ai.adminRequest(`/api/v1/admin/console/gpus/${encodeURIComponent(req.params.model)}/${encodeURIComponent(req.params.action)}`, { method: 'POST', subject: req.viewer.subject });
            return res.redirect(303, '/console/gpus');
        } catch (err) { return page(req, res, 'gpus', {}, err.message || 'The GPU request could not be saved.', 502); }
    });
    r.post('/console/pricebook/changes/:id', async (req, res) => {
        if (!sameOrigin(req)) return res.sendStatus(403);
        try {
            await ai.adminRequest(`/api/v1/admin/console/pricebook/changes/${encodeURIComponent(req.params.id)}`, { method: 'POST', subject: req.viewer.subject, body: { decision: req.body.decision } });
            return res.redirect(303, '/console/pricebook');
        } catch (err) { return page(req, res, 'pricebook', {}, err.message || 'The price decision could not be saved.', 502); }
    });
    r.post('/console/pricebook/run', async (req, res) => {
        if (!sameOrigin(req)) return res.sendStatus(403);
        try {
            await ai.adminRequest('/api/v1/admin/console/pricebook/run', { method: 'POST', subject: req.viewer.subject });
            return res.redirect(303, '/console/pricebook');
        } catch (err) { return page(req, res, 'pricebook', {}, err.message || 'The price book could not run.', 502); }
    });
    r.post('/console/exchange/credits/:id/resolve', async (req, res) => {
        if (!sameOrigin(req)) return res.sendStatus(403);
        try {
            await ai.adminRequest(`/api/v1/admin/console/exchange/credits/${encodeURIComponent(req.params.id)}/resolve`, { method: 'POST', subject: req.viewer.subject });
            return res.redirect(303, '/console/exchange');
        } catch (err) { return page(req, res, 'exchange', {}, err.message || 'The settle row could not be resolved.', 502); }
    });
    r.post('/console/runs/:id/cancel', async (req, res) => {
        if (!sameOrigin(req)) return res.sendStatus(403);
        try {
            await ai.adminRequest(`/api/v1/admin/console/runs/${encodeURIComponent(req.params.id)}/cancel`, { method: 'POST', subject: req.viewer.subject });
            return res.redirect(303, '/console/runs');
        } catch (err) { return page(req, res, 'runs', {}, err.message || 'The run could not be cancelled.', 502); }
    });
    return r;
}

module.exports = { createConsoleRoutes, READS };
