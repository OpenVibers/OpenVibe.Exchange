'use strict';
/**
 * The memory notes of the companions (Opus's design, 2026-11-06, stage 3).
 *
 * Where the notes live: in the person's OpenVibe memory, the M2 store in OpenVibe.AI
 * (server/memory/index.js). Exchange keeps no copy of the text: the note IS an M2 item, and the panel
 * reads it back from there with the person's own session token - the same token the 18+ flag is read
 * with (server/companions/adult.js). M2 seals the text at rest with the platform key and binds it to
 * its owner, its id and its scope, so a row moved to another person or another scope does not open.
 *
 * The scope: the design says the scope is "companions/<character>". M2's scope grammar is
 * `user` or `project:<slug>` - no slashes, lower case only - so a character's notes live in the scope
 * `project:companions-<character id>` (the id lower-cased). It is the scope the design means.
 *
 * What Exchange keeps: the index. One row per note - which character, which kind, whether the person
 * pinned it, who wrote it - and the id of the M2 item that holds the text. A pin has no home in M2 (an
 * item has a kind, a status and a source, but no pin), so the pin is ours.
 *
 * The rules this file keeps:
 *   - a note is short, is one of the three kinds, and is checked against the hard floor before it is
 *     written: the floor holds on notes like on everything else;
 *   - the notes that join a chat's context are read within a token budget, pinned ones first;
 *   - M2 merges two notes that say the same thing (the older row is archived and points at the
 *     winner), so the index follows the merge instead of pointing at a row that is gone.
 */

const floor = require('./floor');

const KINDS = ['fact', 'preference', 'event'];
// The M2 kinds. An event is a fact about the person's life, so it is stored as a fact; the kind the
// person reads (fact, preference, event) is in the index and in the note's source_ref.
const M2_KINDS = { fact: 'fact', preference: 'preference', event: 'fact' };
const SCOPE_RE = /^project:companions-[a-z0-9._-]{1,64}$/;
const MAX_TEXT = 2000;

/** The M2 scope that holds a character's notes. */
function scopeFor(characterId) {
    const id = String(characterId || '').toLowerCase();
    const scope = 'project:companions-' + id;
    if (!SCOPE_RE.test(scope)) throw new Error('that character has no notes scope');
    return scope;
}

/** The token cost of a text, the way the platform counts them: about four characters to a token. */
const tokensOf = (s) => Math.ceil(String(s == null ? '' : s).length / 4);

/**
 * The client for the M2 store. Every call carries the person's own token: M2 lets a person act only
 * for themselves, and Exchange holds that token (it is the session token this site already forwards
 * everywhere else). A service token may only search and suggest there, never browse or edit.
 */
function createMemoryClient({ config, fetchImpl = globalThis.fetch, log = console } = {}) {
    const base = String((config && config.ai && config.ai.url) || '').replace(/\/+$/, '');
    const timeoutMs = (config && config.ai && config.ai.timeoutMs) || 30_000;

    async function call(token, method, path, body) {
        if (!token) {
            const err = new Error('the person has to sign in to read their memory');
            err.code = 'memory.no_token';
            err.status = 401;
            throw err;
        }
        const res = await fetchImpl(base + path, {
            method,
            headers: {
                Authorization: 'Bearer ' + token,
                Accept: 'application/json',
                ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(timeoutMs),
        });
        const raw = await res.text();
        let out = null;
        try { out = raw ? JSON.parse(raw) : null; } catch (e) { out = null; }
        if (!res.ok) {
            const err = new Error((out && (out.detail || out.title)) || ('the memory store answered ' + res.status));
            err.status = res.status;
            err.code = (out && out.code) || 'memory.failed';
            throw err;
        }
        return out;
    }

    return {
        /** The items of one scope: the person's own notes for a character. */
        list: (token, scope) => call(token, 'GET', '/api/v1/memory/items?scope=' + encodeURIComponent(scope)),
        /** Write items: the batch import. */
        write: (token, items) => call(token, 'POST', '/api/v1/memory/items:batch', { items }),
        /** Change one item's text. */
        patch: (token, id, body) => call(token, 'PATCH', '/api/v1/memory/items/' + encodeURIComponent(id), body),
        /** Delete one item. */
        remove: (token, id) => call(token, 'DELETE', '/api/v1/memory/items/' + encodeURIComponent(id)),
    };
}

/**
 * The notes: the index here, the text in M2.
 */
function createCompanionNotes({ db, memory, config, log = console }) {
    /** The index rows of one character, newest first. */
    async function indexRows(owner, characterId) {
        return await db.prepare('SELECT * FROM exchange_companion_notes WHERE owner = ? AND character_id = ? ORDER BY created_at DESC')
            .all(owner, String(characterId));
    }

    /**
     * The notes of a character: the M2 items of its scope, joined with the index. An M2 row that was
     * merged into another one (the same thing said twice) is followed to the winner, and the index is
     * corrected, so the person never sees a note that is not there.
     */
    async function list(owner, characterId, token) {
        const scope = scopeFor(characterId);
        const body = await memory.list(token, scope);
        const items = (body && body.items) || [];
        const byId = new Map(items.map((it) => [it.id, it]));
        const rows = await indexRows(owner, characterId);
        const out = [];
        const seen = new Set();
        for (const row of rows) {
            let item = byId.get(row.m2_id) || null;
            if (item && item.merged_into) {
                const winner = byId.get(item.merged_into) || null;
                if (winner) {
                    item = winner;
                    await db.prepare('UPDATE exchange_companion_notes SET m2_id = ?, updated_at = now() WHERE id = ? AND owner = ?')
                        .run(item.id, row.id, owner);
                }
            }
            if (!item) {
                // The note is gone from the store (the person deleted it in another place): the index
                // row goes with it, so the panel tells the truth.
                await db.prepare('DELETE FROM exchange_companion_notes WHERE id = ? AND owner = ?').run(row.id, owner);
                continue;
            }
            if (seen.has(item.id)) continue;
            seen.add(item.id);
            out.push({
                id: row.id,
                m2_id: item.id,
                text: item.text,
                kind: row.kind,
                pinned: row.pinned === true,
                // A sealed note is one the person's Locker keys closed: the text here is the envelope, and
                // only the person can open it (in the browser).
                sealed: row.sealed === true,
                origin: row.origin,
                status: item.status,
                conflict: item.conflict_with ? true : false,
                created_at: row.created_at,
                updated_at: item.updated_at || row.updated_at,
            });
        }
        return out;
    }

    /**
     * Write a note: the text goes to M2, the index row follows it.
     *
     * `protect` is how a locked character's note is written: the caller seals the text with the
     * person's Locker keys before it reaches M2, and the envelope is what M2 stores. The index says
     * sealed, and only the person's browser opens it.
     */
    async function add(owner, characterId, { kind, text, origin = 'person', pinned = false, sealed = false }, token, protect = null) {
        const k = KINDS.includes(kind) ? kind : 'fact';
        const body = String(text == null ? '' : text).trim().slice(0, MAX_TEXT);
        if (!body) {
            const err = new Error('a note needs some text');
            err.code = 'note.empty';
            err.status = 422;
            throw err;
        }
        // The hard floor holds on notes like on everything else.
        const check = floor.check(body);
        if (!check.ok) {
            const err = new Error('that note is refused: ' + check.detail + ' (' + check.label + ')');
            err.code = 'note.floor';
            err.status = 422;
            err.rule = check.rule;
            throw err;
        }
        const scope = scopeFor(characterId);
        const stored = protect ? await protect(body) : body;
        const written = await memory.write(token, [{
            text: stored,
            scope,
            kind: M2_KINDS[k],
            source: 'companions',
            status: 'active',
            source_ref: { path: 'companions/' + String(characterId).toLowerCase(), heading: k },
        }]);
        const item = written && written.items && written.items[0];
        if (!item) {
            const err = new Error('the note was not written');
            err.code = 'note.not_written';
            err.status = 502;
            throw err;
        }
        const usesLocker = Boolean(protect) || sealed === true;
        const id = 'exn_' + require('openvibe-contracts').ids.ulid();
        await db.prepare('INSERT INTO exchange_companion_notes (id, owner, character_id, m2_id, kind, pinned, sealed, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            .run(id, owner, String(characterId), item.id, k, pinned === true, usesLocker, origin === 'model' ? 'model' : 'person');
        return { id, m2_id: item.id, kind: k, text: body, pinned: pinned === true, sealed: usesLocker, origin };
    }

    /** Edit a note's text: the M2 item is changed, the index keeps its say. */
    async function edit(owner, noteId, { text }, token) {
        const row = await db.prepare('SELECT * FROM exchange_companion_notes WHERE id = ? AND owner = ?').get(String(noteId), owner);
        if (!row) {
            const err = new Error('no such note');
            err.code = 'note.not_found';
            err.status = 404;
            throw err;
        }
        if (row.sealed === true) {
            // A sealed note was written with the person's keys: the server has no text to edit, and
            // storing a plaintext edit here would be a note the person thinks is sealed but is not.
            const err = new Error('this note is sealed with your Locker; it cannot be edited on the server');
            err.code = 'note.sealed';
            err.status = 409;
            throw err;
        }
        const body = String(text == null ? '' : text).trim().slice(0, MAX_TEXT);
        if (!body) {
            const err = new Error('a note needs some text');
            err.code = 'note.empty';
            err.status = 422;
            throw err;
        }
        const check = floor.check(body);
        if (!check.ok) {
            const err = new Error('that note is refused: ' + check.detail + ' (' + check.label + ')');
            err.code = 'note.floor';
            err.status = 422;
            err.rule = check.rule;
            throw err;
        }
        await memory.patch(token, row.m2_id, { text: body });
        await db.prepare('UPDATE exchange_companion_notes SET updated_at = now() WHERE id = ? AND owner = ?').run(row.id, owner);
        return { id: row.id, m2_id: row.m2_id, text: body };
    }

    /** Pin a note, or unpin it: the pin is ours, so it is a row of ours. */
    async function pin(owner, noteId, pinned) {
        const row = await db.prepare('SELECT * FROM exchange_companion_notes WHERE id = ? AND owner = ?').get(String(noteId), owner);
        if (!row) {
            const err = new Error('no such note');
            err.code = 'note.not_found';
            err.status = 404;
            throw err;
        }
        await db.prepare('UPDATE exchange_companion_notes SET pinned = ?, updated_at = now() WHERE id = ? AND owner = ?')
            .run(pinned === true, row.id, owner);
        return { id: row.id, pinned: pinned === true };
    }

    /** Delete a note: the text goes from M2, the index row goes with it. */
    async function remove(owner, noteId, token) {
        const row = await db.prepare('SELECT * FROM exchange_companion_notes WHERE id = ? AND owner = ?').get(String(noteId), owner);
        if (!row) {
            const err = new Error('no such note');
            err.code = 'note.not_found';
            err.status = 404;
            throw err;
        }
        await memory.remove(token, row.m2_id);
        await db.prepare('DELETE FROM exchange_companion_notes WHERE id = ? AND owner = ?').run(row.id, owner);
        return { id: row.id };
    }

    /**
     * The notes that join a chat's context, within a token budget: the pinned ones first, then the
     * newest. The budget is a budget, so a note that does not fit is left out rather than cut in half.
     */
    async function forContext(owner, characterId, token, { budgetTokens = 800, limit = 40 } = {}) {
        let notes = [];
        try {
            notes = await list(owner, characterId, token);
        } catch (err) {
            log.warn('[Companions] the notes could not be read:', String((err && err.message) || err).slice(0, 200));
            return { notes: [], budgetTokens, usedTokens: 0 };
        }
        const ordered = [...notes].sort((a, b) => (Number(b.pinned) - Number(a.pinned))
            || (String(b.created_at || '').localeCompare(String(a.created_at || ''))));
        const used = [];
        let usedTokens = 0;
        for (const note of ordered) {
            if (used.length >= limit) break;
            if (note.status === 'archived' || note.conflict) continue;   // a conflict never reaches a model
            if (note.sealed) continue;   // a sealed note is opened in the browser and sent with the request
            const cost = tokensOf(note.kind + ': ' + note.text);
            if (usedTokens + cost > budgetTokens) continue;
            used.push(note);
            usedTokens += cost;
        }
        return { notes: used, budgetTokens, usedTokens };
    }

    return { list, add, edit, pin, remove, forContext, scopeFor, indexRows, KINDS };
}

module.exports = { createMemoryClient, createCompanionNotes, scopeFor, tokensOf, KINDS, M2_KINDS };
