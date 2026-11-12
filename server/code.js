'use strict';
/**
 * GitHub repositories, read from OpenVibe.Sources (server/code.js's sibling there): the `github` source in
 * category `code` keeps the rankings and star history; Sources fetches GitHub with its own token, and
 * Exchange never calls GitHub itself. This client uses Exchange's client-credentials grant
 * (`sources.item.read`) over loopback and caches both reads: the rankings 60 seconds, a live search ten
 * minutes (GitHub's search limit is the scarce resource).
 *
 * A list is what Sources last fetched; a search is a GitHub answer Sources just made. When Sources
 * cannot answer the pages say so: no repository is invented and no star count is guessed.
 */
const { createServiceTokenClient } = require('openvibe-sdk/auth');

class CodeUnavailable extends Error {
    constructor(detail = 'OpenVibe.Sources is not answering right now') {
        super(detail);
        this.code = 'code.unavailable';
        this.status = 503;
    }
}

function createCode({ config, fetchImpl = globalThis.fetch, tokenFetch = globalThis.fetch, now = () => Date.now(), log = console }) {
    const tokens = config.oauth.clientSecret ? createServiceTokenClient({
        tokenUrl: `${config.networkInternalUrl}/oauth/token`,
        clientId: config.oauth.clientId, clientSecret: config.oauth.clientSecret,
        audience: config.sources.audience, scope: config.sources.scope, fetch: tokenFetch,
    }) : null;
    const lists = new Map();
    const searches = new Map();
    const bursts = new Map();       // actor → [request times in the current minute]
    let warnedAt = 0;

    const warned = (what, err) => {
        if (now() - warnedAt < 60_000) return;
        warnedAt = now();
        log.warn(`[exchange] Sources ${what} unavailable: ${String((err && err.message) || err).slice(0, 200)}`);
    };

    async function get(path) {
        if (!tokens) throw new CodeUnavailable('Exchange is not configured for OpenVibe.Sources');
        const token = await tokens.getToken();
        let res;
        try {
            res = await fetchImpl(`${config.sources.url}${path}`, {
                headers: { accept: 'application/json', authorization: `Bearer ${token}` },
                signal: AbortSignal.timeout(config.sources.timeoutMs),
            });
        } catch (err) {
            throw new CodeUnavailable('OpenVibe.Sources is unreachable right now');
        }
        const text = await res.text().catch(() => '');
        let body = null;
        try { body = text ? JSON.parse(text) : null; } catch { body = null; }
        if (!res.ok || !body) throw new CodeUnavailable(`OpenVibe.Sources answered ${res.status}`);
        return body;
    }

    /** The cached rankings. */
    async function repos({ list = 'trending', lang = null, topic = null, limit = 30 } = {}) {
        const key = JSON.stringify([list, lang || '', topic || '', limit]);
        const hit = lists.get(key);
        if (hit && now() - hit.at < config.sources.reposCacheMs) return { ...hit.value, cached: true };
        try {
            const value = await get(`/api/v1/code/repos?list=${encodeURIComponent(list)}&limit=${encodeURIComponent(limit)}${lang ? `&lang=${encodeURIComponent(lang)}` : ''}${topic ? `&topic=${encodeURIComponent(topic)}` : ''}`);
            lists.set(key, { at: now(), value });
            if (lists.size > 100) lists.delete(lists.keys().next().value);
            return { ...value, cached: false };
        } catch (err) {
            warned('code list', err);
            // A last copy for a minute is better than an empty page, marked stale so the page says the numbers
            // are the last read rather than live.
            if (hit && now() - hit.at < 5 * 60_000) return { ...hit.value, cached: true, stale: true };
            throw err;
        }
    }

    /** A live repository search, cached ten minutes. */
    async function search({ q, lang = null, sort = 'best', page = 1 } = {}) {
        const key = JSON.stringify([q, lang || '', sort, page]);
        const hit = searches.get(key);
        if (hit && now() - hit.at < config.sources.searchCacheMs) return { ...hit.value, cached: true };
        try {
            const value = await get(`/api/v1/code/search?q=${encodeURIComponent(q)}&sort=${encodeURIComponent(sort)}&page=${encodeURIComponent(page)}${lang ? `&lang=${encodeURIComponent(lang)}` : ''}`);
            searches.set(key, { at: now(), value });
            if (searches.size > 200) searches.delete(searches.keys().next().value);
            return { ...value, cached: false };
        } catch (err) {
            warned('code search', err);
            if (hit && now() - hit.at < 60 * 60_000) return { ...hit.value, cached: true, stale: true };
            throw err;
        }
    }

    /** Is this actor under the search limit? A person is one actor; a signed-out visitor is their address. */
    function allow(actor) {
        const id = String(actor || 'anonymous');
        const at = now();
        const recent = (bursts.get(id) || []).filter((t) => at - t < 60_000);
        if (recent.length >= config.sources.searchPerMinute) {
            bursts.set(id, recent);
            return { allowed: false, retryAfter: Math.max(1, Math.ceil((recent[0] + 60_000 - at) / 1000)) };
        }
        recent.push(at);
        bursts.set(id, recent);
        if (bursts.size > 5000) {
            for (const [k, v] of bursts) if (!v.length || at - v[v.length - 1] > 60_000) bursts.delete(k);
        }
        return { allowed: true };
    }

    return { repos, search, allow, configured: Boolean(tokens) };
}

module.exports = { createCode, CodeUnavailable };
