'use strict';

/**
 * /openapi.json: every OpenVibe site serves its API document (SEO-3). Exchange's API is AI's, reached at
 * api.openvibe.exchange, so this reads that host's document server-side, points servers[0] at the public API
 * host and keeps it for ten minutes. When the host cannot be reached the last copy is served, marked stale,
 * and the page still answers: a crawler must never see a 404 for it.
 */
const FALLBACK = (config) => ({
    openapi: '3.1.0',
    info: {
        title: 'OpenVibe Exchange API',
        version: '1',
        description: 'One OpenAI- and Anthropic-compatible endpoint over every model OpenVibe routes.',
    },
    servers: [{ url: config.api.publicUrl }],
    paths: analysisPaths(config),
});

function analysisPaths(config) {
    const make = (id, parameters) => ({ get: { operationId: id, security: [], servers: [{ url: config.baseUrl }], parameters, responses: { '200': { description: 'Public measured performance and shared Bench ratings; minimum twenty samples' }, '422': { description: 'Invalid selection' }, '503': { description: 'Source unavailable' } } } });
    const query = (name) => ({ name, in: 'query', schema: { type: 'string' } });
    const param = (name) => ({ name, in: 'path', required: true, schema: { type: 'string' } });
    return {
        '/api/v1/search': { get: { operationId: 'exchange.catalog.search', summary: 'Find models and provider offers by name, task, capability, price and speed', security: [], servers: [{ url: config.baseUrl }], parameters: ['q', 'provider', 'capability', 'min_price', 'max_price', 'max_speed_ms', 'sort', 'rating_kind'].map(query), responses: { '200': { description: 'Catalog matches with price, measured speed and optional Bench quality rating' }, '400': { description: 'Invalid filter' }, '503': { description: 'Catalog unavailable' } } } },
        '/api/v1/analysis/compare': make('exchange.analysis.compare', ['models', 'measures', 'kind', 'day', 'rating_kind'].map(query)),
        '/api/v1/analysis/models/{model}': make('exchange.analysis.model', [param('model'), query('days'), query('rating_kind')]),
        '/api/v1/analysis/ratings/{kind}': make('exchange.analysis.ratings', [param('kind')]),
        '/api/v1/code/repos': codeReposPath(query),
        '/api/v1/code/search': codeSearchPath(query),
    };
}


function codeReposPath(query) {
    return { get: {
        operationId: 'exchange.code.repos', summary: 'GitHub repositories trending, new, hot by stars gained, or most starred',
        security: [], servers: [{ url: 'https://openvibe.exchange' }],
        parameters: ['list', 'lang', 'topic', 'limit'].map(query),
        responses: {
            '200': { description: 'Cached repository rankings with stars, 1-day and 7-day gains, forks, language, topics and dates' },
            '422': { description: 'Invalid list or limit' },
            '503': { description: 'OpenVibe.Sources is unavailable' },
        },
    } };
}

function codeSearchPath(query) {
    return { get: {
        operationId: 'exchange.code.search', summary: 'Search GitHub repositories with GitHub query syntax',
        security: [], servers: [{ url: 'https://openvibe.exchange' }],
        parameters: ['q', 'lang', 'sort', 'page'].map(query),
        responses: {
            '200': { description: 'Repository results in the same shape as /api/v1/code/repos, with total matches' },
            '422': { description: 'q, sort or page is invalid' },
            '429': { description: 'Too many searches this minute; Retry-After says when' },
            '503': { description: 'GitHub search through OpenVibe.Sources is unavailable' },
        },
    } };
}

function createOpenApi({ config, fetchImpl = globalThis.fetch, log = console, now = () => Date.now() }) {
    const ttl = config.api.openapiCacheMs;
    let at = 0;
    let cached = null;

    async function refresh() {
        const res = await fetchImpl(config.api.openapiUrl, {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(config.api.timeoutMs),
        });
        if (!res.ok) throw new Error(`openapi answered ${res.status}`);
        const doc = await res.json();
        if (!doc || typeof doc !== 'object' || typeof doc.openapi !== 'string') throw new Error('openapi document is not OpenAPI');
        doc.servers = [{ url: config.api.publicUrl }];
        doc.paths = { ...(doc.paths || {}), ...analysisPaths(config) };
        return doc;
    }

    return async function document() {
        if (cached && now() - at < ttl) return { doc: cached, stale: false };
        try {
            cached = await refresh();
            at = now();
            return { doc: cached, stale: false };
        } catch (err) {
            if (log && typeof log.warn === 'function') log.warn('openapi: serving the last copy', { message: err.message });
            if (cached) return { doc: cached, stale: true };
            return { doc: FALLBACK(config), stale: true };
        }
    };
}

module.exports = { createOpenApi };
