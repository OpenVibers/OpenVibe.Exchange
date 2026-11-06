'use strict';
/**
 * Lorebooks (Opus's design, 2026-11-06, stage 4).
 *
 * A lorebook is a set of entries the person keeps: the keys that call an entry in, and what the entry
 * says. It hangs off a character, off a chat, or off the person themselves (their world).
 *
 * How an entry joins the context: when one of its keys appears in the recent turns, the entry's
 * content joins the context, within a token budget, the highest priority first. Nothing hidden: the
 * chat's "what the model saw" panel lists the entries used for each answer.
 *
 * The open format: SillyTavern World Info, in and out. The import takes the file SillyTavern writes
 * (`{"entries": {"0": {"key": [...], "content": "...", ...}}}`) and the export writes the same shape,
 * so a lorebook can go to SillyTavern and come back.
 *
 * The hard floor holds on entries like on everything else: an entry that breaks it is refused at save.
 */

const floor = require('./floor');

const SCOPES = ['character', 'chat', 'person'];
const MAX_KEYS = 24;
const MAX_KEY_LENGTH = 80;
const MAX_CONTENT = 8000;

/** The token cost of a text, the way the platform counts them: about four characters to a token. */
const tokensOf = (s) => Math.ceil(String(s == null ? '' : s).length / 4);

const parseJson = (v, fallback) => { try { return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } };

/** The keys of an entry, as an array of short strings. */
function keysOf(value) {
    const list = Array.isArray(value) ? value : String(value == null ? '' : value).split(',');
    return [...new Set(list.map((k) => String(k == null ? '' : k).trim().toLowerCase()).filter(Boolean))]
        .slice(0, MAX_KEYS)
        .map((k) => k.slice(0, MAX_KEY_LENGTH));
}

/**
 * The World Info shape: the file SillyTavern writes and reads. Every field it uses is kept, so a
 * lorebook that goes out and comes back is the same lorebook.
 */
function toWorldInfo(books) {
    const entries = {};
    let uid = 0;
    for (const book of books || []) {
        for (const entry of book.entries || []) {
            entries[String(uid)] = {
                uid,
                key: (entry.keys || []).slice(),
                keysecondary: [],
                comment: entry.name || book.name || '',
                content: entry.content || '',
                constant: entry.constant === true,
                selective: true,
                selectiveLogic: 0,
                order: Number(entry.priority) || 0,
                position: 'before_char',
                disable: entry.enabled === false,
                probability: 100,
                useProbability: true,
                depth: 4,
                group: '',
                scanDepth: null,
                caseSensitive: null,
                matchWholeWords: null,
                automationId: null,
                role: 0,
                excludeRecursion: false,
                preventRecursion: false,
                delayUntilRecursion: false,
                sticky: 0,
                cooldown: 0,
                delay: 0,
            };
            uid++;
        }
    }
    return { entries };
}

/**
 * Read a World Info file. Both shapes are accepted: the object SillyTavern writes
 * (`{"entries": {"0": {...}}}`) and a plain array of entries.
 */
function fromWorldInfo(text) {
    let raw = text;
    if (typeof raw === 'string') {
        try { raw = JSON.parse(raw); } catch (e) {
            const err = new Error('that is not a World Info file');
            err.code = 'lorebook.bad_file';
            err.status = 422;
            throw err;
        }
    }
    const list = Array.isArray(raw) ? raw : (raw && raw.entries && !Array.isArray(raw.entries)
        ? Object.values(raw.entries) : (raw && Array.isArray(raw.entries) ? raw.entries : []));
    const out = [];
    for (const entry of list) {
        if (!entry || typeof entry !== 'object') continue;
        const keys = keysOf(entry.key || entry.keys || []);
        const content = String(entry.content == null ? '' : entry.content).slice(0, MAX_CONTENT);
        if (!content) continue;
        out.push({
            name: String(entry.comment || entry.name || '').slice(0, 120),
            keys,
            content,
            priority: Number.isFinite(Number(entry.order)) ? Number(entry.order) : (Number(entry.priority) || 0),
            constant: entry.constant === true,
            enabled: entry.disable !== true,
        });
    }
    if (!out.length) {
        const err = new Error('that file has no entries');
        err.code = 'lorebook.empty_file';
        err.status = 422;
        throw err;
    }
    return out;
}

function createLorebooks({ db, config, log = console }) {
    /** A book of the person, by id. */
    async function book(owner, id) {
        const row = await db.prepare('SELECT * FROM exchange_lorebooks WHERE id = ? AND owner = ?').get(String(id), owner);
        return row || null;
    }

    /** The entries of a book, the highest priority first. */
    async function entriesOf(owner, lorebookId) {
        const rows = await db.prepare('SELECT * FROM exchange_lorebook_entries WHERE lorebook_id = ? AND owner = ? ORDER BY priority DESC, created_at ASC')
            .all(String(lorebookId), owner);
        return rows.map((r) => ({ ...r, keys: keysOf(parseJson(r.keys, [])) }));
    }

    /** Make a book. */
    async function create(owner, { name = '', scope = 'person', characterId = null, chatId = null } = {}) {
        const s = SCOPES.includes(scope) ? scope : 'person';
        const id = 'exb_' + require('openvibe-contracts').ids.ulid();
        await db.prepare('INSERT INTO exchange_lorebooks (id, owner, name, scope, character_id, chat_id) VALUES (?, ?, ?, ?, ?, ?)')
            .run(id, owner, String(name || '').slice(0, 120), s, s === 'character' ? String(characterId) : null, s === 'chat' ? String(chatId) : null);
        return book(owner, id);
    }

    /**
     * The books that apply to a chat: the person's own (their world), the character's, and the chat's.
     */
    async function booksFor(owner, { characterId = null, chatId = null } = {}) {
        const rows = await db.prepare("SELECT * FROM exchange_lorebooks WHERE owner = ? AND (scope = 'person' OR (scope = 'character' AND character_id = ?) OR (scope = 'chat' AND chat_id = ?)) ORDER BY created_at ASC")
            .all(owner, characterId ? String(characterId) : '', chatId ? String(chatId) : '');
        const out = [];
        for (const row of rows) {
            out.push({ ...row, entries: await entriesOf(owner, row.id) });
        }
        return out;
    }

    /** Add an entry to a book. */
    async function addEntry(owner, lorebookId, { keys = [], content = '', priority = 0, constant = false, name = '' } = {}) {
        const bookRow = await book(owner, lorebookId);
        if (!bookRow) {
            const err = new Error('no such lorebook');
            err.code = 'lorebook.not_found';
            err.status = 404;
            throw err;
        }
        const body = String(content == null ? '' : content).slice(0, MAX_CONTENT);
        const ks = keysOf(keys);
        const label = String(name == null ? '' : name).slice(0, 120);
        if (!body) {
            const err = new Error('an entry needs some content');
            err.code = 'lorebook.empty';
            err.status = 422;
            throw err;
        }
        if (!ks.length && !constant) {
            const err = new Error('an entry needs at least one key');
            err.code = 'lorebook.no_keys';
            err.status = 422;
            throw err;
        }
        // The hard floor holds on entries like on everything else.
        const check = floor.check([body, label, ...ks]);
        if (!check.ok) {
            const err = new Error('that entry is refused: ' + check.detail + ' (' + check.label + ')');
            err.code = 'lorebook.floor';
            err.status = 422;
            err.rule = check.rule;
            throw err;
        }
        const id = 'exe_' + require('openvibe-contracts').ids.ulid();
        await db.prepare('INSERT INTO exchange_lorebook_entries (id, lorebook_id, owner, name, keys, content, priority, constant, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, true)')
            .run(id, String(lorebookId), owner, label, JSON.stringify(ks), body, Number(priority) || 0, constant === true);
        return { id, lorebook_id: String(lorebookId), name: label, keys: ks, content: body, priority: Number(priority) || 0, constant: constant === true, enabled: true };
    }

    /** Change an entry. */
    async function editEntry(owner, entryId, patch = {}) {
        const row = await db.prepare('SELECT * FROM exchange_lorebook_entries WHERE id = ? AND owner = ?').get(String(entryId), owner);
        if (!row) {
            const err = new Error('no such entry');
            err.code = 'lorebook.not_found';
            err.status = 404;
            throw err;
        }
        const sets = [];
        const values = [];
        const next = {
            name: 'name' in patch ? String(patch.name == null ? '' : patch.name).slice(0, 120) : row.name,
            content: 'content' in patch ? String(patch.content == null ? '' : patch.content).slice(0, MAX_CONTENT) : row.content,
            keys: 'keys' in patch ? keysOf(patch.keys) : keysOf(parseJson(row.keys, [])),
            constant: 'constant' in patch ? patch.constant === true : row.constant === true,
        };
        if (!next.content) {
            const err = new Error('an entry needs some content');
            err.code = 'lorebook.empty';
            err.status = 422;
            throw err;
        }
        if (!next.keys.length && !next.constant) {
            const err = new Error('an entry needs at least one key');
            err.code = 'lorebook.no_keys';
            err.status = 422;
            throw err;
        }
        const check = floor.check([next.content, next.name, ...next.keys]);
        if (!check.ok) {
            const err = new Error('that entry is refused: ' + check.detail + ' (' + check.label + ')');
            err.code = 'lorebook.floor';
            err.status = 422;
            err.rule = check.rule;
            throw err;
        }
        if ('name' in patch) {
            sets.push('name = ?');
            values.push(next.name);
        }
        if ('content' in patch) {
            sets.push('content = ?');
            values.push(next.content);
        }
        if ('keys' in patch) {
            sets.push('keys = ?');
            values.push(JSON.stringify(next.keys));
        }
        if ('priority' in patch) {
            sets.push('priority = ?');
            values.push(Number(patch.priority) || 0);
        }
        if ('constant' in patch) {
            sets.push('constant = ?');
            values.push(patch.constant === true);
        }
        if ('enabled' in patch) {
            sets.push('enabled = ?');
            values.push(patch.enabled !== false);
        }
        if (sets.length) {
            await db.prepare('UPDATE exchange_lorebook_entries SET ' + sets.join(', ') + ', updated_at = now() WHERE id = ? AND owner = ?')
                .run(...values, row.id, owner);
        }
        const after = await db.prepare('SELECT * FROM exchange_lorebook_entries WHERE id = ? AND owner = ?').get(row.id, owner);
        return { ...after, keys: keysOf(parseJson(after.keys, [])) };
    }

    /** Delete an entry, or a whole book. */
    async function removeEntry(owner, entryId) {
        const row = await db.prepare('SELECT * FROM exchange_lorebook_entries WHERE id = ? AND owner = ?').get(String(entryId), owner);
        if (!row) {
            const err = new Error('no such entry');
            err.code = 'lorebook.not_found';
            err.status = 404;
            throw err;
        }
        await db.prepare('DELETE FROM exchange_lorebook_entries WHERE id = ? AND owner = ?').run(row.id, owner);
        return { id: row.id };
    }

    async function removeBook(owner, lorebookId) {
        const bookRow = await book(owner, lorebookId);
        if (!bookRow) {
            const err = new Error('no such lorebook');
            err.code = 'lorebook.not_found';
            err.status = 404;
            throw err;
        }
        await db.prepare('DELETE FROM exchange_lorebook_entries WHERE lorebook_id = ? AND owner = ?').run(bookRow.id, owner);
        await db.prepare('DELETE FROM exchange_lorebooks WHERE id = ? AND owner = ?').run(bookRow.id, owner);
        return { id: bookRow.id };
    }

    /** Import a World Info file into a book: the entries keep their keys, content and order. */
    async function importWorldInfo(owner, lorebookId, text) {
        const entries = fromWorldInfo(text);
        const made = [];
        for (const entry of entries) {
            try {
                made.push(await addEntry(owner, lorebookId, entry));
            } catch (err) {
                log.warn('[Companions] a World Info entry was refused:', String((err && err.message) || err).slice(0, 160));
            }
        }
        if (!made.length) {
            const err = new Error('none of the entries could be read');
            err.code = 'lorebook.empty_file';
            err.status = 422;
            throw err;
        }
        return made;
    }

    /**
     * The entries that join a chat's context: an entry whose key appears in the recent turns (or an
     * entry that is always in), the highest priority first, within a token budget.
     *
     * The order is across every book, not book by book: a high-priority entry of the person's world
     * wins over a low-priority one of the character. A tie goes to the older entry, so the same
     * conversation always builds the same context. An entry that does not fit is left out, never cut.
     */
    function forContext(books, recentText, { budgetTokens = 1200 } = {}) {
        const haystack = String(recentText || '').toLowerCase();
        const candidates = [];
        for (const book of books || []) {
            for (const entry of book.entries || []) {
                if (entry.enabled === false) continue;
                const hit = entry.constant === true
                    || (entry.keys || []).some((k) => k && haystack.includes(String(k).toLowerCase()));
                if (!hit) continue;
                candidates.push({ ...entry, lorebook_id: book.id, lorebook_name: book.name });
            }
        }
        candidates.sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0)
            || String(a.created_at || '').localeCompare(String(b.created_at || ''))
            || String(a.id || '').localeCompare(String(b.id || '')));
        const used = [];
        let usedTokens = 0;
        for (const entry of candidates) {
            const cost = tokensOf(entry.content);
            if (usedTokens + cost > budgetTokens) continue;
            used.push(entry);
            usedTokens += cost;
        }
        return { entries: used, budgetTokens, usedTokens };
    }

    return {
        book, entriesOf, create, booksFor, addEntry, editEntry, removeEntry, removeBook,
        importWorldInfo, forContext, toWorldInfo, fromWorldInfo, keysOf, SCOPES,
    };
}

module.exports = { createLorebooks, toWorldInfo, fromWorldInfo, keysOf, tokensOf, SCOPES };
