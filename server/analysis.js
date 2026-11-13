'use strict';
const { createClient } = require('openvibe-sdk/core');
const { createAiClient } = require('openvibe-sdk/ai');

const bare = (v) => String(v || '').toLowerCase().replace(/^[^/]+\//, '').replace(/[-_@:](\d{4}-?\d{2}-?\d{2}|latest|free)$/, '');
const validKind = (kind) => typeof kind === 'string' && /^[a-z0-9][a-z0-9_.-]{0,79}$/.test(kind);
function ratingFor(model, rows = []) {
    const candidates = [model.slug, model.canonical, model.id, ...(model.offers || []).map((offer) => offer.model)].filter(Boolean);
    const eligible = rows.filter((row) => row.games >= 20 && Number.isFinite(row.elo));
    const exact = eligible.filter((row) => candidates.includes(row.subject));
    const matches = exact.length ? exact : eligible.filter((row) => candidates.some((id) => bare(id) === bare(row.subject)));
    // A family with several rated revisions has no single rating: keep each Bench subject distinct.
    return matches.length === 1 ? matches[0] : null;
}

function createAnalysis({ config, ai, bench, fetchImpl = globalThis.fetch, now = () => Date.now(), metrics = null }) {
    const source = metrics || createAiClient(createClient({ fetch: fetchImpl, retries: 0 }), { baseUrl: config.ai.url }).metrics;
    const cache = new Map();
    async function read(key, loader) {
        const hit = cache.get(key);
        if (hit && hit.until > now()) return hit.value;
        const value = await loader();
        cache.set(key, { until: now() + 60000, value });
        if (cache.size > 128) cache.delete(cache.keys().next().value);
        return value;
    }
    function checkedKind(value = 'chat.arena') {
        if (!validKind(value)) throw new TypeError('Use a Bench task kind.');
        return value;
    }
    const ratingSource = (board, kind) => ({ source: 'OpenVibe.Bench', kind, minimum_samples: 20, unavailable: Boolean(board?.unavailable), stale: Boolean(board?.stale) });
    async function model(model, { rating_kind = 'chat.arena', days = 30 } = {}) {
        const kind = checkedKind(rating_kind);
        return read(`model:${model.slug}:${kind}:${days}`, async () => {
            const [measured, board] = await Promise.all([
                source.model(model.slug, { days }, { signal: AbortSignal.timeout(config.ai.timeoutMs) }), bench.board({ kind }),
            ]);
            return { schema: 'exchange.analysis@1', model: model.slug, measured: { ...measured, series: (measured.series || []).filter((cell) => cell.runs >= 20) }, rating: ratingFor(model, board.rows), ratings: ratingSource(board, kind) };
        });
    }
    async function compare({ models, measures, kind, day, rating_kind = 'chat.arena' }) {
        const ratingKind = checkedKind(rating_kind);
        if (!Array.isArray(models) || !models.length || models.length > 6 || new Set(models).size !== models.length) throw new TypeError('Choose one to six distinct models.');
        return read(`compare:${JSON.stringify([models, measures, kind, day, ratingKind])}`, async () => {
            const [measured, board, catalog] = await Promise.all([
                source.compare({ models, measures, kind, day }, { signal: AbortSignal.timeout(config.ai.timeoutMs) }),
                bench.board({ kind: ratingKind }), ai.catalog(),
            ]);
            return { ...measured, schema: 'exchange.analysis@1', ratings: ratingSource(board, ratingKind), models: (measured.models || []).map((item) => ({
                ...item, cells: (item.cells || []).filter((cell) => cell.runs >= 20), rating: ratingFor((catalog.models || []).find((entry) => entry.slug === item.model) || { slug: item.model }, board.rows),
            })) };
        });
    }
    return { model, compare, metrics: source };
}
module.exports = { createAnalysis, ratingFor, bare };
