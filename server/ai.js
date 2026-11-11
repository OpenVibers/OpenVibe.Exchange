'use strict';
/**
 * OpenVibe.AI, read from OpenVibe.Exchange.
 *
 *   catalog()    GET /api/v1/exchange/catalog     the models, offers, prices, speed and uptime (public)
 *   usage(days)  GET /api/v1/exchange/usage       requests, tokens and spend, by day, model and product (public)
 *   communityOffers()  GET /api/v1/community/offers  the live community offers (public): a pool says how many
 *                                                 machines serve it, never which ones
 *   chat({...})  POST /api/v1/runs                one ai.complete run, on behalf of the person, with this
 *                                                 service's token (ai.run.create, ns ai.complete)
 *                GET /api/v1/receipts/:id         cached input share for the answer's receipt (best effort)
 *
 * The catalog and usage reads are cached in this process, so a page view does not cost AI a request. When
 * AI cannot be reached the reads answer an empty catalog carrying `unavailable: true`: the pages say the
 * numbers are not available instead of showing stale ones as live.
 */
const { createServiceTokenClient } = require('openvibe-sdk/auth');
const { createCredentialsClient } = require('openvibe-sdk/credentials');

const CATALOG_MS = 30_000;
const USAGE_MS = 60_000;
const COMMUNITY_MS = 30_000;

async function jsonOf(res) {
    const text = await res.text();
    try { return text ? JSON.parse(text) : null; } catch (e) { return null; }
}

function createAi({ config, fetchImpl = globalThis.fetch, log = console, now = () => Date.now() }) {
    const tokens = config.oauth.clientSecret ? createServiceTokenClient({
        tokenUrl: `${config.networkInternalUrl}/oauth/token`,
        clientId: config.oauth.clientId, clientSecret: config.oauth.clientSecret,
        audience: config.ai.audience, scope: config.ai.scope, fetch: fetchImpl,
    }) : null;
    const adminTokens = config.oauth.clientSecret ? createServiceTokenClient({
        tokenUrl: `${config.networkInternalUrl}/oauth/token`,
        clientId: config.oauth.clientId, clientSecret: config.oauth.clientSecret,
        audience: config.ai.audience, scope: config.ai.consoleScope, fetch: fetchImpl,
    }) : null;

    const empty = (what) => ({ generated_at: new Date(now()).toISOString(), unavailable: true, count: 0, models: [], families: [], by_day: [], by_model: [], by_product: [], today: null, totals: null, what });
    let catalogHit = { at: 0, value: null };
    let directoryHit = { at: 0, value: null };
    let usageHit = new Map();
    let communityHit = { at: 0, value: null };
    let warnedAt = 0;

    const warned = (what, err) => {
        if (now() - warnedAt < 60_000) return;
        warnedAt = now();
        log.warn(`[exchange] AI ${what} unavailable: ${String((err && err.message) || err).slice(0, 200)}`);
    };

    async function get(p, what) {
        const res = await fetchImpl(`${config.ai.url}${p}`, {
            headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(config.ai.timeoutMs),
        });
        const body = await jsonOf(res);
        if (!res.ok || !body) throw new Error(`${what}: HTTP ${res.status}`);
        return body;
    }

    /** Owner console calls to AI's JSON admin API. No HTML is fetched or relayed. */
    async function adminRequest(path, { method = 'GET', body = null, subject = null, role = null } = {}) {
        if (!adminTokens) throw Object.assign(new Error('AI console service credentials are not configured'), { status: 503 });
        const token = await adminTokens.getToken();
        const res = await fetchImpl(`${config.ai.url}${path}`, {
            method,
            headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(subject ? { 'X-OV-Subject': String(subject) } : {}), ...(role ? { 'X-OV-Role': String(role) } : {}), ...(body == null ? {} : { 'Content-Type': 'application/json' }) },
            ...(body == null ? {} : { body: JSON.stringify(body) }),
            signal: AbortSignal.timeout(config.ai.timeoutMs),
        });
        const out = await jsonOf(res);
        if (!res.ok) throw Object.assign(new Error((out && (out.detail || out.title || out.error)) || `AI answered ${res.status}`), { status: res.status, code: out && out.code });
        return out || {};
    }

    async function catalog() {
        if (catalogHit.value && now() - catalogHit.at < CATALOG_MS) return catalogHit.value;
        try {
            const body = withDisplayNames(await get('/api/v1/exchange/catalog', 'catalog'));
            catalogHit = { at: now(), value: body };
            return body;
        } catch (err) {
            warned('catalog', err);
            // Keep the last good catalog for a while rather than turning every page empty on one failed poll.
            if (catalogHit.value && now() - catalogHit.at < 5 * 60_000) return { ...catalogHit.value, stale: true };
            return empty('catalog');
        }
    }

    async function directory() {
        if (directoryHit.value && now() - directoryHit.at < CATALOG_MS) return directoryHit.value;
        try {
            const body = await get('/api/v1/exchange/directory', 'model directory');
            if (!Array.isArray(body.models)) throw new Error('invalid model directory');
            let spots = [];
            try {
                const spotted = await get('/api/v1/exchange/spotted', 'spotted models');
                spots = Array.isArray(spotted.models) ? spotted.models : [];
            } catch { /* The listed directory works while the spotting service is unavailable. */ }
            const listed = new Set(body.models.map(m => m.id));
            const models = [...body.models, ...spots.filter(m => !listed.has(m.id)).map(m => ({
                id: m.id, provider: m.provider, model: m.model, name: m.name, status: 'spotted',
                routing_enabled: false, first_seen_at: m.first_seen_at, updated_at: m.last_seen_at,
                source: m.sources?.[0]?.url || null, sources: m.sources || [], price: {},
            }))];
            const value = { ...body, models, count: models.length };
            directoryHit = { at: now(), value };
            return value;
        } catch (err) {
            warned('model directory', err);
            if (directoryHit.value && now() - directoryHit.at < 5 * 60_000) return { ...directoryHit.value, stale: true };
            return { unavailable: true, models: [] };
        }
    }

    async function modelEvents() {
        try {
            const body = await get('/api/v1/exchange/model-events', 'model events');
            if (!Array.isArray(body.events)) throw new Error('invalid model events');
            return body;
        } catch (err) { warned('model events', err); return { unavailable: true, count: 0, events: [] }; }
    }

    /** AI's search engines (GET /api/v1/exchange/search/engines, public): ids, kinds, prices, availability. */
    let enginesHit = { at: 0, value: null };
    async function searchEngines() {
        if (enginesHit.value && now() - enginesHit.at < CATALOG_MS) return enginesHit.value;
        try {
            const body = await get('/api/v1/exchange/search/engines', 'search engines');
            const value = Array.isArray(body.engines) ? body.engines : [];
            enginesHit = { at: now(), value };
            return value;
        } catch (err) {
            warned('search engines', err);
            return enginesHit.value || [];
        }
    }

    async function usage(days = 30) {
        const key = String(days);
        const hit = usageHit.get(key);
        if (hit && now() - hit.at < USAGE_MS) return hit.value;
        try {
            const body = await get(`/api/v1/exchange/usage?days=${encodeURIComponent(days)}`, 'usage');
            usageHit.set(key, { at: now(), value: body });
            if (usageHit.size > 8) usageHit.delete(usageHit.keys().next().value);
            return body;
        } catch (err) {
            warned('usage', err);
            if (hit && now() - hit.at < 5 * 60_000) return { ...hit.value, stale: true };
            return empty('usage');
        }
    }

    /**
     * The live community offers, as AI lets anyone read them: a pool's `pool` names its members only by stable
     * pseudonym and its count, so the public card shows "Community pool (N machines)" and never a machine.
     */
    async function communityOffers() {
        if (communityHit.value && now() - communityHit.at < COMMUNITY_MS) return communityHit.value;
        try {
            const body = await get('/api/v1/community/offers', 'community offers');
            const value = { generated_at: body.generated_at || new Date(now()).toISOString(), offers: Array.isArray(body.offers) ? body.offers : [] };
            communityHit = { at: now(), value };
            return value;
        } catch (err) {
            warned('community offers', err);
            if (communityHit.value && now() - communityHit.at < 5 * 60_000) return { ...communityHit.value, stale: true };
            return { generated_at: new Date(now()).toISOString(), unavailable: true, offers: [] };
        }
    }

    /** One completion, as the person: the run's quota and free allowance are theirs (on_behalf_of). */
    async function chat({ model, messages, temperature = null, maxTokens = 1024, subject, signal = null, policy = null, preset = null, max_cost_usd = null }) {
        if (!tokens) throw Object.assign(new Error('AI is not configured for this service'), { code: 'ai.not_configured', status: 503 });
        const token = await tokens.getToken();
        const body = {
            workflow: 'ai.complete',
            input: {
                messages,
                ...(model ? { model: String(model).slice(0, 256) } : {}),
                ...(temperature != null ? { temperature: Number(temperature) } : {}),
                ...(maxTokens ? { max_tokens: Math.max(1, Math.min(16000, Number(maxTokens) || 1024)) } : {}),
                ...(max_cost_usd != null ? { max_cost_usd: Number(max_cost_usd) } : {}),
            },
            ...(subject ? { on_behalf_of: { type: 'user', id: String(subject) } } : {}),
            options: {
                cache: 'none',
                ...(policy ? { policy: String(policy).slice(0, 40) } : {}),
                ...(preset ? { preset: { name: String(preset).slice(0, 120), ...(policy ? { policy: String(policy).slice(0, 40) } : {}) } } : {}),
            },
        };
        const res = await fetchImpl(`${config.ai.url}/api/v1/runs?wait=${config.ai.waitMs}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(body),
            signal: signal || AbortSignal.timeout(config.ai.timeoutMs),
        });
        const out = await jsonOf(res);
        const run = out && out.run ? out.run : null;
        if (!res.ok || !run) {
            const err = new Error((out && (out.detail || out.title)) || `AI answered ${res.status}`);
            err.code = (out && out.code) || 'ai.failed';
            err.status = res.status;
            throw err;
        }
        if (run.status === 'failed' || run.status === 'cancelled') {
            const err = new Error((run.error && (run.error.detail || run.error.code)) || `the run ${run.status}`);
            err.code = (run.error && run.error.code) || 'run.failed';
            err.status = 502;
            throw err;
        }
        if (!['succeeded', 'cached'].includes(run.status)) {
            const err = new Error('the model is still answering; open the chat again in a moment');
            err.code = 'run.pending';
            err.status = 504;
            throw err;
        }
        // AI's run summary has total tokens; its per-run receipt has the cached input count. Read it with the
        // same caller token, and leave the answer usable if an older AI or a slow receipt store cannot serve it.
        let cachedTokens = null;
        let cachedInputPercent = null;
        if (run.id) {
            try {
                const receiptId = `rcpt_${String(run.id).replace(/^run_/, '')}`;
                const receiptRes = await fetchImpl(`${config.ai.url}/api/v1/receipts/${encodeURIComponent(receiptId)}`, {
                    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
                    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000),
                });
                if (receiptRes.ok) {
                    const receipt = (await jsonOf(receiptRes) || {}).receipt;
                    if (receipt && receipt.run_id === run.id) {
                        const input = Number(receipt.usage && receipt.usage.tokens_in);
                        const cached = Number(receipt.usage && receipt.usage.tokens_cached);
                        if (Number.isFinite(input) && input > 0 && Number.isFinite(cached) && cached >= 0) {
                            cachedTokens = Math.min(cached, input);
                            cachedInputPercent = Math.round(100 * cachedTokens / input);
                        }
                    }
                }
            } catch { /* The receipt is optional for the answer. */ }
        }
        const choice = run.output && Array.isArray(run.output.choices) ? run.output.choices[0] : null;
        const content = choice && choice.message && typeof choice.message.content === 'string' ? choice.message.content : '';
        const usage = run.usage || null;
        const started = run.started_at ? Date.parse(run.started_at) : NaN;
        const finished = run.finished_at ? Date.parse(run.finished_at) : NaN;
        const explain = run.explain || null;
        const why = explain && typeof explain === 'object'
            ? (Array.isArray(explain.reasons) && explain.reasons.length ? explain.reasons.slice(0, 4).map(String)
                : (explain.selected || explain.policy || explain.objective || null))
            : null;
        // The privacy label the router put on the run's own explain (server/exchange/privacy.js in AI): Private,
        // Anonymized or Community, with the facts behind it. The answer shows it beside the receipt.
        const privacy = explain && typeof explain === 'object' && explain.privacy && typeof explain.privacy === 'object' ? explain.privacy : null;
        return {
            content,
            model: (run.output && run.output.model) || (run.provenance && run.provenance.model) || null,
            provider: (run.provenance && run.provenance.provider) || null,
            run_id: run.id,
            cost_usd: usage ? usage.cost_usd : null,
            usage,
            tokens_in: usage ? usage.tokens_in || 0 : 0,
            tokens_out: usage ? usage.tokens_out || 0 : 0,
            tokens_cached: cachedTokens,
            cached_input_percent: cachedInputPercent,
            latency_ms: Number.isFinite(started) && Number.isFinite(finished) && finished >= started ? finished - started : null,
            why: why == null ? null : (Array.isArray(why) ? why : [String(why)]),
            privacy: privacy ? privacy.label || null : null,
            privacy_detail: privacy,
            preset: explain && explain.preset && explain.preset.name ? String(explain.preset.name) : null,
            // The router's whole explanation, as AI recorded it on the run (objective, selected, reasons, every
            // candidate with its cost, latency and excluded reason). /why draws it; nothing else re-derives it.
            explain: explain && typeof explain === 'object' ? explain : null,
        };
    }

    /** The presets saved for a person on AI (GET /api/v1/presets), or null when the read fails. */
    async function presetsFor(subject) {
        if (!tokens || !subject) return null;
        try {
            const token = await tokens.getToken();
            const res = await fetchImpl(`${config.ai.url}/api/v1/presets?on_behalf_of=${encodeURIComponent(subject)}`, {
                headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(config.ai.timeoutMs),
            });
            const body = await jsonOf(res);
            return res.ok && body && Array.isArray(body.presets) ? body.presets : null;
        } catch (err) {
            warned('presets', err);
            return null;
        }
    }

    /** The developer projects the person owns (Network's GET /api/v1/projects), as ids; [] when it cannot be read. */
    async function ownedProjects(token, subject) {
        if (!token || !subject) return [];
        try {
            const res = await fetchImpl(`${config.networkUrl}/api/v1/projects`, {
                headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(config.ai.timeoutMs),
            });
            const body = await jsonOf(res);
            const projects = res.ok && body && Array.isArray(body.projects) ? body.projects : [];
            // Only the person's own projects: a shared one may carry other members' traffic.
            return projects.filter((p) => p && p.id && p.owner && p.owner.id === subject).map((p) => String(p.id));
        } catch (err) {
            warned('projects', err);
            return [];
        }
    }

    /**
     * The strict-privacy switch on a person's keys: their "default" preset in AI makes every request that names no
     * preset private, and turning it off deletes it. The keys are their projects' keys too, so the same preset is
     * written on each project they own; a project that cannot be written is counted, never hidden.
     */
    async function setKeyPrivacy(subject, on, { networkToken = null } = {}) {
        if (!tokens || !subject) throw Object.assign(new Error('AI is not configured for this service'), { code: 'ai.not_configured', status: 503 });
        const token = await tokens.getToken();
        const targets = [{ type: 'user', id: String(subject) }];
        for (const id of await ownedProjects(networkToken, subject)) targets.push({ type: 'project', id });
        let written = 0;
        const failed = [];
        for (const target of targets) {
            const res = await fetchImpl(`${config.ai.url}/api/v1/presets${on ? '' : '/default'}`, {
                method: on ? 'POST' : 'DELETE',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ on_behalf_of: target, ...(on ? { name: 'default', policy: { data_policy: 'private', community: false } } : {}) }),
                signal: AbortSignal.timeout(config.ai.timeoutMs),
            });
            const body = await jsonOf(res);
            if (res.ok) { written += 1; continue; }
            if (!on && res.status === 404) { written += 1; continue; }   // nothing to remove: the switch is off
            const err = new Error((body && (body.detail || body.title)) || `AI answered ${res.status}`);
            err.code = (body && body.code) || 'ai.failed';
            err.status = res.status;
            if (target.type === 'user') throw err;   // the person's own preset is the switch: a failure is not hidden
            failed.push(target.id);
        }
        return { on: Boolean(on), projects: targets.length - 1, projects_set: Math.max(0, written - 1), projects_failed: failed };
    }

    // ── your own endpoint (the Exchange remake, build order 7) ────────────────
    // The public status is on AI's Exchange read API; everything per person is on AI's own endpoint API,
    // called with the person's Network token (never the service token: an endpoint spends their Balance).
    async function ownCall(method, p, { token = null, body = undefined } = {}) {
        const headers = { Accept: 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        let res;
        try {
            res = await fetchImpl(`${config.ai.url}${p}`, {
                method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
                signal: AbortSignal.timeout(config.ai.timeoutMs),
            });
        } catch (err) {
            throw Object.assign(new Error('OpenVibe.AI is unreachable right now'), { code: 'ai.unavailable', status: 503 });
        }
        const out = await jsonOf(res);
        if (!res.ok) {
            const err = new Error((out && (out.detail || out.title)) || `AI answered ${res.status}`);
            err.code = (out && out.code) || 'ai.failed';
            err.status = res.status;
            throw err;
        }
        return out || {};
    }
    async function gpuQuote(model, strategy = 'cheapest') { return ownCall('GET', `/api/v1/exchange/gpu-quotes/${encodeURIComponent(model)}?strategy=${encodeURIComponent(strategy)}`); }
    async function ownStatus() { return ownCall('GET', '/api/v1/exchange/endpoints'); }
    async function ownList(token) { return ownCall('GET', '/api/v1/own-endpoints', { token }); }
    async function ownCreate(token, body) { return ownCall('POST', '/api/v1/own-endpoints', { token, body }); }
    async function ownStop(token, id) { return ownCall('POST', `/api/v1/own-endpoints/${encodeURIComponent(id)}/stop`, { token }); }

    /** The person's own AI credentials: pass only their signed Network session, never the Exchange service token. */
    async function meRequest(token, path, { method = 'GET', body = undefined } = {}) {
        if (!token && path !== '/api/v1/tasks' && !path.startsWith('/api/v1/choices?')) throw Object.assign(new Error('Sign in is required'), { status: 401 });
        const headers = { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), Origin: config.baseUrl };
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const res = await fetchImpl(`${config.ai.url}${path}`, {
            method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(config.ai.timeoutMs),
        });
        const out = await jsonOf(res);
        if (!res.ok) throw Object.assign(new Error((out && (out.detail || out.title)) || `AI answered ${res.status}`), { status: res.status, code: out && out.code });
        return out || {};
    }
    function credentialsFor(token) {
        const client = { json: ({ method, path, body }) => meRequest(token, path, { method, body }) };
        return createCredentialsClient(client, { baseUrl: config.ai.url });
    }

    return { catalog, directory, modelEvents, searchEngines, usage, communityOffers, chat, presetsFor, setKeyPrivacy, ownedProjects, gpuQuote, ownStatus, ownList, ownCreate, ownStop, adminRequest, meRequest, credentialsFor, configured: Boolean(tokens) };
}

/**
 * OpenAI's models arrive named by their API ids ("gpt-5-nano") while every other family has a display name
 * ("DeepSeek V4 Pro"). Say them the way OpenAI does ("GPT-5 nano", "GPT-4.1 mini", "GPT-4o mini"); the id stays the id.
 */
function displayName(name) {
    const m = /^gpt-([0-9][0-9a-z.]*)((?:-[a-z0-9]+)*)$/i.exec(String(name || ''));
    if (!m) return name;
    const rest = m[2] ? ' ' + m[2].slice(1).split('-').join(' ') : '';
    return `GPT-${m[1]}${rest}`;
}

function withDisplayNames(body) {
    if (!body || !Array.isArray(body.models)) return body;
    return { ...body, models: body.models.map((m) => (m && typeof m.name === 'string' ? { ...m, name: displayName(m.name) } : m)) };
}

module.exports = { createAi, displayName };
