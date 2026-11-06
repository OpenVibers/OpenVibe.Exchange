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
    paths: {},
});

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
