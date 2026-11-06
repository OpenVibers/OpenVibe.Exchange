'use strict';
/**
 * OpenVibe.Bench, from OpenVibe.Exchange.
 *
 *   createRound({prompt, category, entries})   POST /api/v1/arena/rounds
 *   vote({roundId, subject, outcome, pair})    POST /api/v1/arena/rounds/:id/votes
 *   board({category})                          GET  /api/v1/boards/chat.arena?category=…
 *
 * The round is built by this service and the vote is cast for the person named in x-ov-subject, so the
 * judgement is theirs (one per person per round) and this service can never vote on what it built. The board
 * is a public read and is cached here for a minute, so a rankings page view does not cost Bench a request.
 */
const { createServiceTokenClient } = require('openvibe-sdk/auth');

const BOARD_MS = 60_000;
const ARENA_KIND = 'chat.arena';

async function jsonOf(res) {
    const text = await res.text();
    try { return text ? JSON.parse(text) : null; } catch (e) { return null; }
}

function createBench({ config, fetchImpl = globalThis.fetch, log = console, now = () => Date.now() }) {
    const tokens = config.oauth.clientSecret ? createServiceTokenClient({
        tokenUrl: `${config.networkInternalUrl}/oauth/token`,
        clientId: config.oauth.clientId, clientSecret: config.oauth.clientSecret,
        audience: config.bench.audience, scope: config.bench.scope, fetch: fetchImpl,
    }) : null;

    let boardHit = new Map();
    let warnedAt = 0;
    const warned = (what, err) => {
        if (now() - warnedAt < 60_000) return;
        warnedAt = now();
        log.warn(`[exchange] Bench ${what} unavailable: ${String((err && err.message) || err).slice(0, 200)}`);
    };

    async function call(method, path, { body = null, subject = null } = {}) {
        if (!tokens) {
            const err = new Error('Bench is not configured for this service');
            err.code = 'bench.not_configured';
            err.status = 503;
            throw err;
        }
        const token = await tokens.getToken();
        const res = await fetchImpl(`${config.bench.url}${path}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: `Bearer ${token}`,
                ...(subject ? { 'x-ov-subject': String(subject) } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(config.bench.timeoutMs),
        });
        const out = await jsonOf(res);
        if (!res.ok) {
            const err = new Error((out && (out.detail || out.title)) || `Bench answered ${res.status}`);
            err.code = (out && out.code) || 'bench.failed';
            err.status = res.status;
            throw err;
        }
        return out;
    }

    async function createRound({ prompt, category, entries }) {
        return await call('POST', '/api/v1/arena/rounds', {
            body: { prompt: String(prompt).slice(0, 4000), category: String(category || 'chat').slice(0, 40), entries },
        });
    }

    async function vote({ roundId, subject, outcome, pair }) {
        return await call('POST', `/api/v1/arena/rounds/${encodeURIComponent(roundId)}/votes`, {
            body: { outcome, pair }, subject,
        });
    }

    /** The board for one task category ('all' is every vote). A read failure is said, never invented. */
    async function board({ kind = ARENA_KIND, category = 'all' } = {}) {
        const key = `${kind}|${category}`;
        const hit = boardHit.get(key);
        if (hit && now() - hit.at < BOARD_MS) return hit.value;
        try {
            const body = await call('GET', `/api/v1/boards/${encodeURIComponent(kind)}?category=${encodeURIComponent(category)}`);
            const value = body && body.board ? body.board : { unavailable: true, kind_id: kind, category, rows: [] };
            boardHit.set(key, { at: now(), value });
            if (boardHit.size > 16) boardHit.delete(boardHit.keys().next().value);
            return value;
        } catch (err) {
            warned('board', err);
            if (hit && now() - hit.at < 5 * 60_000) return { ...hit.value, stale: true };
            return { unavailable: true, kind_id: kind, category, rows: [] };
        }
    }

    return { createRound, vote, board, configured: Boolean(tokens), kind: ARENA_KIND };
}

module.exports = { createBench, ARENA_KIND };
