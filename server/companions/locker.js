'use strict';
/**
 * The Locker (Opus's design, 2026-11-06, stage 3): the person's own keys seal their notes and their chat
 * history, so OpenVibe cannot read them at rest.
 *
 * How the keys travel: the person's Locker lives in their browser (openvibe-shared's ov-locker.js), and its
 * public halves are in Network's key directory (GET /api/v1/people/:subject/keys - Network PR #577). Exchange
 * reads the public key with the person's own session token, the same token the 18+ flag is read with
 * (server/companions/adult.js), and seals with openvibe-sdk/locker. The private half never comes here: the
 * browser opens what Exchange sealed, and sends what it opened with the request, for that turn only.
 *
 * The rules this file keeps:
 *   - only a person with a Locker can be sealed for (no key, no seal);
 *   - what is sealed is sealed with the person's ECDH public key, in a people lock, so only their key opens it;
 *   - the fingerprint of the key is kept with the chat, so a key change is visible.
 */

const locker = require('openvibe-sdk/locker');

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const unb64 = (text) => new Uint8Array(Buffer.from(String(text || ''), 'base64'));

/** The people slot of an envelope: the subject it names and the key it was made for. */
function subjectOf(subject) {
    return { type: 'user', id: String(subject || '') };
}

function createLocker({ config, fetchImpl = globalThis.fetch, log = console } = {}) {
    const base = String((config && config.networkUrl) || '').replace(/\/+$/, '');
    const timeoutMs = 15_000;

    /**
     * The person's public Locker keys, read from Network's key directory with the person's own token.
     * A person without a Locker has no keys: null is the answer, and nothing is sealed for them.
     */
    async function keysFor(subject, token) {
        if (!subject || !token) return null;
        let res;
        try {
            res = await fetchImpl(base + '/api/v1/people/' + encodeURIComponent(String(subject)) + '/keys', {
                headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
                signal: AbortSignal.timeout(timeoutMs),
            });
        } catch (err) {
            log.warn('[Companions] the locker keys could not be read:', String((err && err.message) || err).slice(0, 200));
            return null;
        }
        if (res.status === 404) return null;   // no locker yet
        if (!res.ok) {
            log.warn('[Companions] the locker keys answered ' + res.status);
            return null;
        }
        let body = null;
        try { body = await res.json(); } catch (e) { body = null; }
        if (!body || !body.ecdh_public) return null;
        return {
            subject: String(body.subject || subject),
            ecdh: body.ecdh_public,
            signing: body.signing_public || null,
            fingerprint: body.fingerprint || null,
        };
    }

    /** Seal a text for the person: a people lock, only their key opens it. */
    async function seal(text, keys) {
        if (!keys || !keys.ecdh) {
            const err = new Error('this person has no locker keys');
            err.code = 'locker.no_keys';
            err.status = 409;
            throw err;
        }
        const sealed = await locker.seal(String(text == null ? '' : text), {
            lock: 'people',
            keys: [{ subject: subjectOf(keys.subject), publicKey: keys.ecdh }],
        });
        return b64(sealed.bytes);
    }

    /** Open a sealed text with a private key: the browser does this, the tests do it too. */
    async function open(text, person) {
        const plain = await locker.open(unb64(text), { person });
        return Buffer.from(plain).toString('utf8');
    }

    /** What an envelope says about itself, without a key. */
    function inspect(text) {
        try { return locker.inspect(unb64(text)); } catch (e) { return null; }
    }

    return { keysFor, seal, open, inspect, subjectOf };
}

module.exports = { createLocker, subjectOf };
