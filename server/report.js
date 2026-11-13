'use strict';

/**
 * OpenVibe.Report reads (ai-metrics.md, 2026-11-12):
 *
 *   GET /api/v1/ai/performance?group=model&days=30&model=<key>   the public row behind a model's Measured panel;
 *                                                                 at least 20 calls in 30 days, no person, no prompt.
 *   GET /api/v1/me/ai/usage?group=day|surface                    the signed-in person's own rows, with the person's
 *                                                                 Network session (the same token Exchange forwards
 *                                                                 to AI and Network), never a service token.
 *
 * Report is a read for the page, never a reason for it to fail: a timeout, a refusal or a row that does not match
 * answers null, and the page says "not measured yet" or "not available right now". Performance rows are cached for
 * five minutes; a person's rows are private and never cached.
 *
 * The model Report records is AI's own model key (the provider's model id, e.g. `deepseek-chat`), while a catalog
 * model is `deepseek/deepseek-chat`. The candidates are tried in that order and compared with the same `bare()`
 * rule the Bench rating uses, so a dated revision and a provider prefix do not hide the row.
 */
const { bare } = require('./analysis');

const PERFORMANCE_DAYS = 30;
const NOT_MEASURED = 'Not measured yet: a model is measured after 20 calls in 30 days.';

function createReport({ config, fetchImpl = globalThis.fetch, now = () => Date.now(), log = console }) {
    const report = (config && config.report) || {};
    const base = String(report.url || 'https://openvibe.report').replace(/\/+$/, '');
    const timeoutMs = Math.max(250, Number(report.timeoutMs) || 2000);
    const cacheMs = Math.max(1000, Number(report.cacheMs) || 300000);
    const cache = new Map();

    /** One GET, JSON, short; a non-2xx is an error with its status so a caller can tell "down" from "no row". */
    async function read(path, { token = null } = {}) {
        const headers = { accept: 'application/json' };
        if (token) headers.authorization = `Bearer ${token}`;
        const res = await fetchImpl(`${base}${path}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
        if (!res || !res.ok) {
            const err = new Error(`OpenVibe.Report answered ${res ? res.status : 'nothing'}`);
            err.status = res ? res.status : 0;
            throw err;
        }
        return res.json();
    }

    /** The catalog ids a Report row for this model may carry, likeliest first: AI's model key, then the slug. */
    function candidatesOf(model) {
        const offers = Array.isArray(model && model.offers) ? model.offers : [];
        const ids = [...offers.map((o) => o && o.model), ...offers.map((o) => o && o.id), model && model.slug, model && model.canonical, model && model.id]
            .filter((v) => typeof v === 'string' && v.trim())
            .map((v) => v.trim());
        return [...new Set(ids)];
    }

    /** The row of one candidate, or null when Report has none. A 5xx or a network failure stops the search. */
    async function rowFor(candidate) {
        const path = `/api/v1/ai/performance?group=model&days=${PERFORMANCE_DAYS}&model=${encodeURIComponent(candidate)}`;
        let body;
        try {
            body = await read(path);
        } catch (err) {
            if (err && err.status && err.status < 500) return { row: null, stop: true, err };
            if (log && log.warn) log.warn('[OpenVibe.Exchange] the Report performance read failed: ' + String((err && err.message) || err).slice(0, 160));
            return { row: null, stop: true, err };
        }
        const rows = body && Array.isArray(body.rows) ? body.rows : [];
        if (!rows.length) return { row: null, stop: false };
        const exact = rows.find((r) => r && r.key === candidate);
        const loose = rows.find((r) => r && bare(r.key) === bare(candidate));
        return { row: exact || loose || null, stop: true };
    }

    /**
     * The public performance row for one catalog model, or null when Report knows no row yet. The whole answer,
     * including "no row", is cached for five minutes so a page view does not ask Report again.
     */
    async function measuredModel(model) {
        if (!model || !model.slug) return null;
        const key = `model:${model.slug}`;
        const hit = cache.get(key);
        if (hit && hit.until > now()) return hit.value;
        let found = null;
        for (const candidate of candidatesOf(model)) {
            const out = await rowFor(candidate);
            if (out.row) { found = out.row; break; }
            if (out.stop) break;
        }
        cache.set(key, { until: now() + cacheMs, value: found });
        if (cache.size > 512) cache.delete(cache.keys().next().value);
        return found;
    }

    /**
     * The signed-in person's own AI usage: by day (the totals and the spark) and by surface (the bars). The
     * person's Network session token is forwarded as their Bearer; Report decides who that is, never the query.
     * Each read is independent: one failing leaves the other's numbers on the page. Nothing is cached.
     */
    async function personUsage(token, { from = null } = {}) {
        if (!token) return null;
        const query = (group) => `/api/v1/me/ai/usage?group=${group}${from ? `&from=${encodeURIComponent(from)}` : ''}`;
        const [day, surface] = await Promise.all([
            read(query('day'), { token }).catch((err) => {
                if (log && log.warn) log.warn('[OpenVibe.Exchange] the Report day usage read failed: ' + String((err && err.message) || err).slice(0, 160));
                return null;
            }),
            read(query('surface'), { token }).catch((err) => {
                if (log && log.warn) log.warn('[OpenVibe.Exchange] the Report surface usage read failed: ' + String((err && err.message) || err).slice(0, 160));
                return null;
            }),
        ]);
        if (!day && !surface) return null;
        return { day: day && day.totals ? day : null, surface: surface && Array.isArray(surface.rows) ? surface : null };
    }

    return { measuredModel, personUsage, candidatesOf, NOT_MEASURED };
}

module.exports = { createReport, NOT_MEASURED, PERFORMANCE_DAYS };
