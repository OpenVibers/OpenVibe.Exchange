'use strict';
/**
 * OpenVibe.Network, read and changed for a person with their own Network token (never a service token).
 *
 *   machines(token)             GET  /api/v1/machines          their machines: names and whether each is online
 *   pools(token)                GET  /api/v1/machine-pools     their pools, and the machines they can pool
 *   proposePool(token, body)    POST /api/v1/machine-pools     { machines, head? } → the new pool
 *   revokePool(token, id)       POST /api/v1/machine-pools/:id/revoke
 *
 * Network is the pool's record (bot.machine-pool@1, Network PR #609): Exchange reads it and never measures a link
 * or keeps a pool of its own. Node measures each link and the fit on the head; a pool record carries that read as
 * `links` and `fit` when Network has it, and the page says "not measured yet" until then.
 */
function createNetwork({ config, fetchImpl = globalThis.fetch, log = console }) {
    let warnedAt = 0;
    const warned = (what, err) => {
        if (Date.now() - warnedAt < 60_000) return;
        warnedAt = Date.now();
        log.warn(`[exchange] Network ${what} unavailable: ${String((err && err.message) || err).slice(0, 200)}`);
    };

    async function call(token, method, path, body = undefined) {
        const headers = { Accept: 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        let res;
        try {
            res = await fetchImpl(`${config.networkUrl}${path}`, {
                method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
                signal: AbortSignal.timeout(8000),
            });
        } catch (err) {
            warned(path, err);
            throw Object.assign(new Error('OpenVibe.Network is unreachable right now'), { code: 'network.unavailable', status: 503 });
        }
        const text = await res.text();
        let out = null;
        try { out = text ? JSON.parse(text) : null; } catch { /* not JSON: the status says it */ }
        if (!res.ok) {
            const err = new Error((out && (out.detail || out.error || out.title)) || `Network answered ${res.status}`);
            err.code = (out && out.code) || 'network.failed';
            err.status = res.status;
            throw err;
        }
        return out || {};
    }

    /** The person's machines: [{ id, name?, online }], never another owner's. */
    async function machines(token) {
        const out = await call(token, 'GET', '/api/v1/machines');
        return Array.isArray(out.machines) ? out.machines : [];
    }

    /** Their pools and the machines that announced themselves in the last five minutes (no address, no public IP). */
    async function pools(token) {
        const out = await call(token, 'GET', '/api/v1/machine-pools');
        return {
            pools: Array.isArray(out.pools) ? out.pools : [],
            candidates: Array.isArray(out.candidates) ? out.candidates : [],
        };
    }

    async function proposePool(token, body) {
        const out = await call(token, 'POST', '/api/v1/machine-pools', body);
        return out.pool || null;
    }

    async function revokePool(token, id) {
        return call(token, 'POST', `/api/v1/machine-pools/${encodeURIComponent(id)}/revoke`);
    }

    return { machines, pools, proposePool, revokePool };
}

module.exports = { createNetwork };
