'use strict';

/**
 * The 18+ confirmation, read from the account (OpenVibe.Network).
 *
 * The design says "signed in with Network's 18+ confirmation". Network owns the account and the confirmation:
 * the person ticks "I am 18 or older" in their account settings and Network records it on the account row
 * (Network PR #587, server/identity/adult.js). OpenVibe.AI reads the same flag for the uncensored tier
 * (OpenVibe.AI server/policy/adult-status.js), so the adults' tier and the 18+ characters read one flag.
 *
 * Two ways to ask, both Network's own:
 *
 *   - GET /api/v1/me/adult              with the person's own token. The token is the session Exchange already
 *                                        holds (the one the navbar and every other service call use), so this is
 *                                        "is this signed-in person confirmed", asked of the account owner.
 *   - GET /internal/identity/adult       with a service token carrying identity.subject.resolve. This is the
 *                                        route AI uses. Network grants Exchange search.document.write,
 *                                        events.subscription.manage and ai.run.create — not
 *                                        identity.subject.resolve — so a service-token read of the flag is refused
 *                                        today. The person's own token needs no grant, so that is the route taken
 *                                        here; the service-token route stays the fallback for the day Network
 *                                        grants it.
 *
 * The answer is cached for five minutes per person, so a burst of requests costs one call. A failure is never
 * cached, and it never grants: an unreadable flag is not a yes.
 */
const USR = /^usr_[0-9A-HJKMNP-TV-Z]{26}$/;
const CACHE_MS = 5 * 60 * 1000;
const MAX_CACHE = 5000;

function createAdultAccount({ config, fetchImpl = globalThis.fetch, log = console, now = () => Date.now() } = {}) {
    const base = String((config && config.networkUrl) || '').replace(/\/+$/, '');
    const cache = new Map();     // subject -> { adult, at }
    let tokens = null;

    function tokenClient() {
        if (!tokens) {
            const { createServiceTokenClient } = require('openvibe-sdk/auth');
            tokens = createServiceTokenClient({
                tokenUrl: `${base}/oauth/token`,
                clientId: (config && config.oauth && config.oauth.clientId) || 'exchange',
                clientSecret: (config && config.oauth && config.oauth.clientSecret) || '',
                fetch: fetchImpl,
            });
        }
        return tokens;
    }

    /** The person's own answer, asked of Network with the session token this site already holds. */
    async function askWithToken(subject, token) {
        if (!token) return null;
        const res = await fetchImpl(`${base}/api/v1/me/adult`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            signal: AbortSignal.timeout(5000),
        });
        if (res.status === 200) {
            const body = await res.json().catch(() => null);
            return { adult: Boolean(body && body.adult === true) };
        }
        if (res.status === 404) return { adult: false };   // the route is not deployed yet
        if (res.status === 401 || res.status === 403) return { adult: false };
        throw new Error(`Network answered ${res.status}`);
    }

    /** The service-token route, for the day Network grants Exchange identity.subject.resolve. */
    async function askWithServiceToken(subject) {
        const token = await tokenClient().getToken({ audience: 'openvibe.network' });
        const res = await fetchImpl(`${base}/internal/identity/adult?subject_id=${encodeURIComponent(subject)}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            signal: AbortSignal.timeout(5000),
        });
        if (res.status === 200) {
            const body = await res.json().catch(() => null);
            return { adult: Boolean(body && body.adult === true) };
        }
        if (res.status === 404) return { adult: false };
        throw new Error(`Network answered ${res.status}`);
    }

    /**
     * Has this person confirmed, on their account, that they are 18 or older?
     * Fails closed: an unreadable flag is never a yes.
     */
    async function adultFor(subject, token = null) {
        const id = String(subject || '');
        if (!USR.test(id)) return false;
        const hit = cache.get(id);
        if (hit && now() - hit.at < CACHE_MS) return hit.adult;
        let out = null;
        try {
            out = await askWithToken(id, token);
        } catch (err) {
            log.warn('[Companions] the 18+ confirmation could not be read:', String((err && err.message) || err).slice(0, 160));
        }
        if (!out) {
            try { out = await askWithServiceToken(id); }
            catch (err) {
                log.warn('[Companions] the 18+ confirmation could not be read from the account service:', String((err && err.message) || err).slice(0, 160));
            }
        }
        if (!out) return false;   // a failure is never cached, and never grants
        if (cache.size >= MAX_CACHE) cache.clear();
        cache.set(id, { adult: out.adult, at: now() });
        return out.adult;
    }

    /**
     * Record the confirmation on the account, so the flag is one flag: Network keeps it (Network PR #587),
     * and OpenVibe.AI and the companions read the same answer.
     */
    async function confirm(token) {
        if (!token) throw new Error('no session token: the confirmation could not be recorded');
        const res = await fetchImpl(`${base}/api/v1/me/adult`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ confirm: true }),
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error(`Network answered ${res.status}`);
        cache.clear();
        return true;
    }

    function forget(subject) { cache.delete(String(subject || '')); }
    function clear() { cache.clear(); }

    return { adultFor, confirm, forget, clear };
}

module.exports = { createAdultAccount, USR, CACHE_MS };
