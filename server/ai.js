'use strict';
/**
 * OpenVibe.AI, read from OpenVibe.Exchange.
 *
 *   catalog()    GET /api/v1/exchange/catalog     the models, offers, prices, speed and uptime (public)
 *   usage(days)  GET /api/v1/exchange/usage       requests, tokens and spend, by day, model and product (public)
 *   chat({...})  POST /api/v1/runs                one ai.complete run, on behalf of the person, with this
 *                                                 service's token (ai.run.create, ns ai.complete)
 *
 * The catalog and usage reads are cached in this process, so a page view does not cost AI a request. When
 * AI cannot be reached the reads answer an empty catalog carrying `unavailable: true`: the pages say the
 * numbers are not available instead of showing stale ones as live.
 */
const { createServiceTokenClient } = require('openvibe-sdk/auth');

const CATALOG_MS = 30_000;
const USAGE_MS = 60_000;

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

    const empty = (what) => ({ generated_at: new Date(now()).toISOString(), unavailable: true, count: 0, models: [], families: [], by_day: [], by_model: [], by_product: [], today: null, totals: null, what });
    let catalogHit = { at: 0, value: null };
    let usageHit = new Map();
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

    async function catalog() {
        if (catalogHit.value && now() - catalogHit.at < CATALOG_MS) return catalogHit.value;
        try {
            const body = await get('/api/v1/exchange/catalog', 'catalog');
            catalogHit = { at: now(), value: body };
            return body;
        } catch (err) {
            warned('catalog', err);
            // Keep the last good catalog for a while rather than turning every page empty on one failed poll.
            if (catalogHit.value && now() - catalogHit.at < 5 * 60_000) return { ...catalogHit.value, stale: true };
            return empty('catalog');
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
        return {
            content,
            model: (run.output && run.output.model) || (run.provenance && run.provenance.model) || null,
            provider: (run.provenance && run.provenance.provider) || null,
            run_id: run.id,
            cost_usd: usage ? usage.cost_usd : null,
            usage,
            tokens_in: usage ? usage.tokens_in || 0 : 0,
            tokens_out: usage ? usage.tokens_out || 0 : 0,
            latency_ms: Number.isFinite(started) && Number.isFinite(finished) && finished >= started ? finished - started : null,
            why: why == null ? null : (Array.isArray(why) ? why : [String(why)]),
        };
    }

    return { catalog, usage, chat, configured: Boolean(tokens) };
}

module.exports = { createAi };
