'use strict';

const express = require('express');
const { raw } = require('../render/html');
const { send } = require('../render/layout');
const { consolePage } = require('../views/console');
const { defaultsPage } = require('../views/task-defaults');

const READS = Object.freeze({
    supply: '/api/v1/admin/console/supply',
    overview: '/api/v1/admin/console/overview', providers: '/api/v1/admin/console/providers', models: '/api/v1/admin/console/models', routes: '/api/v1/routes',
    templates: '/api/v1/templates', workflows: '/api/v1/workflows', runs: '/api/v1/admin/console/runs', quotas: '/api/v1/admin/console/quotas',
    usage: '/api/v1/admin/console/usage', cache: '/api/v1/admin/console/cache', audit: '/api/v1/admin/console/audit',
    gpus: '/api/v1/admin/console/gpus', pricebook: '/api/v1/admin/console/pricebook', exchange: '/api/v1/admin/console/exchange',
    abuse: '/api/v1/admin/console/abuse', glossary: '/api/v1/admin/console/glossary',
    sync: '/api/v1/admin/console/sync', orders: '/api/v1/admin/console/orders',
});

function createConsoleRoutes({ config, ai }) {
    const r = express.Router();
    r.use(express.urlencoded({ extended: false, limit: '32kb' }));
    const isOwner = (req) => Boolean(req.viewer && req.viewer.kind === 'user' && req.viewer.subject && req.viewer.role === 'owner');
    // Providers, Models and the Price book are designed sections (views/console-ai.js): their stylesheet and the
    // makers' marks come with them.
    const DESIGNED_HEAD = raw(`<link rel="stylesheet" href="/css/console-ai.css"><style>${require('../views/console-ai').CSS}</style>`);
    const page = (req, res, section, data, error = null, status = 200) => send(res, status, {
        viewer: req.viewer, config, path: req.originalUrl, index: false, title: 'AI operator console',
        head: ['providers', 'models', 'pricebook'].includes(section) ? DESIGNED_HEAD : undefined,
        body: raw(consolePage({ section, data, error })),
    });
    r.use((req, res, next) => isOwner(req) ? next() : res.sendStatus(req.viewer?.kind === 'user' ? 403 : 404));
    // The owner's AI defaults: one row per task, the model inline, and the fallback order. Posting one task's form
    // saves only that task, and AI resolves it within a minute.
    const DEFAULTS_HEAD = raw('<link rel="stylesheet" href="/css/task-defaults.css"><script src="/js/task-defaults.js" defer></script>');
    // Owner defaults are OpenVibe supply only, so each picker lists the network's offers for the task's kind: the
    // chat (or code, vision) models, and for an image task its image models too. A failed read leaves that task's
    // pickers empty rather than the page; the saved values still render from the defaults.
    const networkModels = async (task) => {
        try {
            const view = await ai.meRequest(req.viewer.token, `/api/v1/choices?task=${encodeURIComponent(task.name)}`);
            const list = ((view.options && view.options.openvibe) || []).filter((m) => !m.adult);
            const models = list.map(({ model, source, name, price_estimate_usd }) => ({ model, source, name, price_estimate_usd }));
            // A model task's two dynamic picks come first: "let OpenVibe choose" is the built-in every task starts
            // with, and "the cheapest good model" is what Design does signed out. Neither is a single catalogue row,
            // and a search task has neither: it names an engine.
            if (task.kind !== 'search') models.unshift({ model: 'openvibe/auto', source: 'openvibe', name: 'Let OpenVibe choose', price_estimate_usd: null }, { model: 'openvibe/cheapest', source: 'openvibe', name: 'The cheapest good model', price_estimate_usd: null });
            return { models, imageModels: task.kind === 'image' ? models : [] };
        } catch { return { models: [], imageModels: [] }; }
    };
    r.get('/console/defaults', async (req, res) => {
        try {
            const data = await ai.meRequest(req.viewer.token, '/api/v1/admin/task-defaults');
            const optionsByTask = {};
            for (const task of data.tasks || []) optionsByTask[task.name] = await networkModels(task);
            return send(res, 200, { viewer: req.viewer, config, path: req.originalUrl, index: false, title: 'AI defaults', head: DEFAULTS_HEAD, body: raw(defaultsPage({ ...data, optionsByTask })) });
        } catch (err) { return page(req, res, 'defaults', {}, err.message, err.status || 502); }
    });
    r.post('/console/defaults', async (req, res) => {
        if (!sameOrigin(req)) return res.sendStatus(403);
        try {
            const b = req.body;
            const fallbacks = b.fallback == null ? [] : [].concat(b.fallback);
            const value = {
                signed_out: JSON.parse(b.signed_out),
                signed_in: JSON.parse(b.signed_in),
                fallbacks: fallbacks.map((v) => JSON.parse(v)),
                image_model: b.image_model ? JSON.parse(b.image_model) : null,
                // One engine a line; a leading - or − turns it off.
                search_engines: String(b.search_engines || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
                    .map((x) => ({ engine: x.replace(/^[-−]/, ''), enabled: !/^[-−]/.test(x) })),
                max_cost_usd: b.max_cost_usd === '' ? null : Number(b.max_cost_usd),
            };
            await ai.meRequest(req.viewer.token, '/api/v1/admin/task-defaults', { method: 'PUT', body: { defaults: [{ task: b.task, value }] } });
            return res.redirect(303, '/console/defaults');
        } catch (err) { return page(req, res, 'defaults', {}, err.message, err.status || 422); }
    });
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
    // Small JSON read models for the owner panels and clients. Keep the page renderer out of this path so the
    // provider, model and pricebook sections can be arranged by the console owner without changing the API shape.
    r.get('/console/data/:section', async (req, res) => {
        const section = req.params.section;
        if (!['providers', 'models', 'pricebook'].includes(section)) return res.sendStatus(404);
        try {
            const data = await ai.adminRequest(READS[section]);
            const scrub = (value) => Array.isArray(value) ? value.map(scrub) : value && typeof value === 'object'
                ? Object.fromEntries(Object.entries(value).filter(([key]) => !['api_key', 'secret', 'key_value'].includes(key.toLowerCase())).map(([key, child]) => [key, scrub(child)])) : value;
            return res.set('Cache-Control', 'no-store').json(scrub(data));
        } catch (err) { return res.status(err.status === 404 ? 404 : 502).json({ error: err.message || 'AI admin API did not answer.' }); }
    });
    r.get('/console/providers/:key/models', async (req, res) => {
        try { return page(req, res, 'models', await ai.adminRequest(`/api/v1/admin/console/models?provider=${encodeURIComponent(req.params.key)}`)); }
        catch { return page(req, res, 'models', {}, 'The models could not be read.', 502); }
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
    r.post('/console/orders/:capability', async (req, res) => {
        if (!sameOrigin(req)) return res.sendStatus(403);
        let choices;
        try { choices = JSON.parse(String(req.body.choices || '[]')); }
        catch { return page(req, res, 'orders', {}, 'Choices must be a JSON array.', 422); }
        if (!Array.isArray(choices) || !['0', '1'].includes(req.body.enabled)) return res.sendStatus(422);
        try {
            await ai.adminRequest(`/api/v1/admin/console/orders/${encodeURIComponent(req.params.capability)}`, {
                method: 'POST', subject: req.viewer.subject, body: { enabled: req.body.enabled === '1', choices },
            });
            return res.redirect(303, '/console/orders');
        } catch (err) { return page(req, res, 'orders', {}, 'Provider order could not be saved.', err.status === 422 ? 422 : 502); }
    });
    r.post('/console/supply', async (req,res) => {
        if (!sameOrigin(req)) return res.sendStatus(403);
        const body = { model: req.body.model, runtime: req.body.runtime };
        for (const k of ['input_per_million','output_per_million','hourly_ceiling_usd','monthly_ceiling_usd','required_vram_mb','idle_minutes']) body[k] = Number(req.body[k]);
        try { await ai.adminRequest('/api/v1/admin/console/supply', { method:'POST', subject:req.viewer.subject, body }); return res.redirect(303,'/console/supply'); }
        catch { return page(req,res,'supply',{},'Supply settings could not be saved.',502); }
    });
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
            else if (action === 'remove-key') await ai.adminRequest(`/api/v1/admin/console/providers/${key}/key`, { method: 'DELETE', subject: req.viewer.subject });
            else if (action === 'check') {
                const pasted = Boolean(req.body.api_key);
                const result = await ai.adminRequest(`/api/v1/admin/console/providers/${key}/check`, { method: 'POST', subject: req.viewer.subject,
                    ...(pasted ? { body: { api_key: String(req.body.api_key) } } : {}) });
                if (pasted) {
                    const data = await ai.adminRequest('/api/v1/admin/console/providers');
                    data.providers = (data.providers || []).map(p => p.key === req.params.key ? { ...p, last_check: result } : p);
                    return page(req, res, 'providers', data);
                }
            }
            else if (action === 'sync') {
                await ai.adminRequest(`/api/v1/admin/console/providers/${key}/sync`, { method: 'POST', subject: req.viewer.subject });
                return res.redirect(303, `/console/providers/${key}/models`);
            } else if (action === 'model-settings') await ai.adminRequest(`/api/v1/admin/console/providers/${key}/model-settings`, { method: 'POST', subject: req.viewer.subject, body: {
                auto_list_new_models: req.body.auto_list_new_models === '1', model_sync_interval_minutes: Number(req.body.model_sync_interval_minutes || 0),
            } });
            else if (action === 'settings') await ai.adminRequest(`/api/v1/providers/${key}`, { method: 'PATCH', subject: req.viewer.subject, body: {
                status: req.body.status, provider_access: req.body.provider_access, priority: Number(req.body.preference_order),
                markup_percent: Number(req.body.markup_percent), uncensored: req.body.uncensored === '1',
            } });
            else return res.sendStatus(404);
            return res.redirect(303, '/console/providers');
        } catch { return page(req, res, 'providers', {}, 'The change could not be saved.', 502); }
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
    r.post('/console/models/:provider/:model/settings', async (req, res) => {
        if (!sameOrigin(req)) return res.sendStatus(403);
        try {
            await ai.adminRequest(`/api/v1/models/${encodeURIComponent(req.params.provider)}/${encodeURIComponent(req.params.model)}`, {
                method: 'PATCH', subject: req.viewer.subject, body: { display_name: String(req.body.display_name || ''), content_tier: req.body.content_tier },
            });
            return res.redirect(303, `/console/providers/${encodeURIComponent(req.params.provider)}/models`);
        } catch { return page(req, res, 'models', {}, 'The model settings could not be saved.', 502); }
    });
    r.post('/console/models/:provider/:model/override', async (req, res) => {
        if (!sameOrigin(req)) return res.sendStatus(403);
        const number = (value) => value === '' || value == null ? null : Number(value);
        try {
            const cost = {};
            for (const [form, field] of [['input_per_million', 'in_per_mtok'], ['cached_per_million', 'cached_per_mtok'], ['output_per_million', 'out_per_mtok']])
                if (Object.prototype.hasOwnProperty.call(req.body, form)) cost[field] = number(req.body[form]);
            // "Use the accepted price" clears the owner's price (AI deletes it on null).
            const override = req.body.clear === '1' ? null : { reason: String(req.body.reason || ''), cost };
            await ai.adminRequest(`/api/v1/models/${encodeURIComponent(req.params.provider)}/${encodeURIComponent(req.params.model)}`, {
                method: 'PATCH', subject: req.viewer.subject, body: { owner_override: override },
            });
            return res.redirect(303, '/console/models');
        } catch (err) { return page(req, res, 'models', {}, err.message || 'The model price override could not be saved.', 502); }
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
    // Several changes at once (a model's three prices, a provider's, everything waiting): one by one, never in
    // parallel, because each approval rewrites its model's cost row from a fresh read.
    r.post('/console/pricebook/decide', async (req, res) => {
        if (!sameOrigin(req)) return res.sendStatus(403);
        const decision = String(req.body.decision) === 'approve' ? 'approve' : 'reject';
        const ids = [...new Set(String(req.body.ids || '').split(',').map((s) => s.trim().slice(0, 60)).filter(Boolean))].slice(0, 500);
        if (!ids.length) return res.redirect(303, '/console/pricebook');
        const failed = [];
        for (const id of ids) {
            try {
                await ai.adminRequest(`/api/v1/admin/console/pricebook/changes/${encodeURIComponent(id)}`, { method: 'POST', subject: req.viewer.subject, body: { decision } });
            } catch (err) { failed.push(err.message || 'refused'); }
        }
        if (!failed.length) return res.redirect(303, '/console/pricebook');
        return page(req, res, 'pricebook', {}, `${failed.length} of ${ids.length} could not be saved: ${failed[0]}`, 502);
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
