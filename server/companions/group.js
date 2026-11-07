'use strict';
/**
 * Group chats (Opus's design, 2026-11-06, step 5): two to five characters and the person.
 *
 * The characters take turns by a simple rule, and every character stays itself:
 *   - the one named: the character the person named answers (their name, with or without an @);
 *   - round-robin: every character answers once, in the order they joined;
 *   - "let them talk": every character answers a number of times, one round after another.
 *
 * What stays per character: the memory (the notes of that character's own M2 scope, so Ada's notes are
 * Ada's and nobody else's) and the voice (the card's own voice, used when the answer is read aloud).
 * What is shared: the conversation itself - every character hears what the others said.
 */

const MODES = ['named', 'round_robin', 'free'];
const MIN_MEMBERS = 2;
const MAX_MEMBERS = 5;
const MAX_TURNS = 5;

/** The mode's own name, in the words the page uses. */
const MODE_LABEL = {
    named: 'The one named',
    round_robin: 'In turn',
    free: 'Let them talk',
};

/** Does the text name this character? Their name, with or without an @, on a word boundary. */
function mentioned(text, name) {
    const t = String(text == null ? '' : text).toLowerCase();
    const n = String(name == null ? '' : name).toLowerCase().trim();
    if (!n || n.length < 2) return false;
    const safe = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(^|[^a-z0-9])@?' + safe + '([^a-z0-9]|$)', 'i').test(t);
}

/**
 * Who answers, and in what order: a list of { character_id, name }.
 * The plan is the design's simple rule, and nothing else.
 */
function planAnswers({ mode = 'round_robin', turns = 1, members = [], text = '' } = {}) {
    const list = (members || []).map((m) => ({ character_id: String(m.character_id), name: String(m.name || '') }));
    if (!list.length) return [];
    if (mode === 'named') {
        const named = list.filter((m) => mentioned(text, m.name));
        // Nobody named: the group answers in turn, so the person is never left in silence.
        return named.length ? named : list.slice();
    }
    if (mode === 'free') {
        const rounds = Math.max(1, Math.min(MAX_TURNS, Number(turns) || 1));
        const out = [];
        for (let r = 0; r < rounds; r++) for (const m of list) out.push(m);
        return out;
    }
    return list.slice();
}

/**
 * The system prompt of one character in a group: the card, the group's roster, and that character's own
 * notes about the person. The notes of the other characters never join it.
 */
function groupPromptFor(card, group, { notes = [], others = [] } = {}) {
    const lines = ['You are ' + card.name + '.'];
    if (card.description) lines.push(card.description);
    if (card.personality) lines.push('Personality: ' + card.personality);
    if (card.scenario) lines.push('Scenario: ' + card.scenario);
    if (group && group.persona) lines.push('The person you talk with plays: ' + group.persona);
    if (card.first_message) lines.push('Begin with: ' + card.first_message);
    if (others.length) {
        lines.push('You are in a group chat with ' + others.join(', ') + '. Answer in your own voice, in your own words: never write the lines of the others, and never speak for the person.');
    }
    if (notes.length) {
        lines.push('What you remember about the person (your own notes about them, which they can read and edit):');
        for (const note of notes) lines.push('- (' + note.kind + ') ' + note.text);
    }
    lines.push('Stay in character and answer as the character would. The hard floor holds on every model: no sexual content involving minors, no non-consensual sexual content (fiction included) or incest, no help with weapons of mass harm or attacks on others.');
    return lines.join(String.fromCharCode(10));
}

/**
 * The group chats: the rows, their members and their messages.
 */
function createGroupStore(s) {
    const db = s.db;

    async function create({ owner, title = 'Group chat', mode = 'round_robin', turns = 1, members = [], settings = {} }) {
        const id = s.newId('exc');
        const how = MODES.includes(mode) ? mode : 'round_robin';
        const rounds = Math.max(1, Math.min(MAX_TURNS, Number(turns) || 1));
        await db.prepare('INSERT INTO exchange_group_chats (id, owner, title, mode, turns, model, preset, temperature, context_size, persona) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(id, owner, String(title || 'Group chat').slice(0, 120), how, rounds,
                settings.model ? String(settings.model).slice(0, 120) : null,
                settings.preset ? String(settings.preset).slice(0, 120) : null,
                settings.temperature == null ? null : Number(settings.temperature),
                settings.context_size == null ? null : Number(settings.context_size),
                settings.persona ? String(settings.persona).slice(0, 2000) : null);
        let position = 0;
        for (const characterId of members.slice(0, MAX_MEMBERS)) {
            await db.prepare('INSERT INTO exchange_group_members (group_id, character_id, position) VALUES (?, ?, ?) ON CONFLICT DO NOTHING')
                .run(id, String(characterId), position++);
        }
        return get(owner, id);
    }

    async function get(owner, id) {
        const row = await db.prepare('SELECT * FROM exchange_group_chats WHERE id = ? AND owner = ?').get(String(id || ''), owner);
        return row || null;
    }

    async function list(owner, limit = 60) {
        const rows = await db.prepare('SELECT g.*, (SELECT COUNT(*) FROM exchange_group_members m WHERE m.group_id = g.id) AS member_count FROM exchange_group_chats g WHERE g.owner = ? ORDER BY g.updated_at DESC LIMIT ?')
            .all(owner, Math.max(1, Math.min(200, limit)));
        return rows;
    }

    async function members(groupId) {
        const rows = await db.prepare('SELECT m.character_id, m.position FROM exchange_group_members m WHERE m.group_id = ? ORDER BY m.position, m.character_id')
            .all(String(groupId));
        return rows;
    }

    async function messages(groupId) {
        const rows = await db.prepare('SELECT * FROM exchange_group_messages WHERE group_id = ? ORDER BY seq, id').all(String(groupId));
        return rows.map((r) => ({ ...r, meta: parseJson(r.meta) }));
    }

    async function append({ owner, groupId, role, characterId = null, content = null, turnId = null, seq = 0, model = null, meta = {} }) {
        const id = s.newId('exg');
        await db.prepare('INSERT INTO exchange_group_messages (id, group_id, owner, role, character_id, content, turn_id, seq, model, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(id, String(groupId), owner, role, characterId ? String(characterId) : null,
                content == null ? null : String(content), turnId ? String(turnId) : null, Number(seq) || 0,
                model ? String(model) : null, JSON.stringify(meta || {}));
        await db.prepare('UPDATE exchange_group_chats SET updated_at = now() WHERE id = ? AND owner = ?').run(String(groupId), owner);
        return id;
    }

    async function settings(owner, groupId, next) {
        const sets = [];
        const values = [];
        for (const f of ['model', 'preset', 'temperature', 'context_size', 'persona', 'title', 'mode', 'turns', 'speak']) {
            if (!(f in next)) continue;
            sets.push(f + ' = ?');
            if (f === 'temperature' || f === 'turns') values.push(next[f] == null || next[f] === '' ? null : Number(next[f]));
            else if (f === 'context_size') values.push(next[f] == null || next[f] === '' ? null : Number(next[f]));
            else if (f === 'speak') values.push(next[f] === false || next[f] === '0' ? false : true);
            else if (f === 'mode') values.push(MODES.includes(next[f]) ? next[f] : 'round_robin');
            else values.push(next[f] == null ? null : String(next[f]).slice(0, 2000));
        }
        if (sets.length) {
            await db.prepare('UPDATE exchange_group_chats SET ' + sets.join(', ') + ', updated_at = now() WHERE id = ? AND owner = ?')
                .run(...values, String(groupId), owner);
        }
        return get(owner, groupId);
    }

    async function remove(owner, groupId) {
        await db.prepare('DELETE FROM exchange_group_chats WHERE id = ? AND owner = ?').run(String(groupId), owner);
    }

    /** The answers a person's groups gave today: the daily allowance's counter. */
    async function countToday(owner) {
        const row = await db.prepare('SELECT COUNT(*) AS n FROM exchange_group_messages WHERE owner = ? AND role = \'assistant\' AND created_at >= date_trunc(\'day\', now())').get(owner);
        return Number(row && row.n) || 0;
    }

    return { create, get, list, members, messages, append, settings, remove, countToday, MODES, MIN_MEMBERS, MAX_MEMBERS };
}

const parseJson = (v) => { try { return v ? JSON.parse(v) : {}; } catch (e) { return {}; } };

module.exports = { createGroupStore, planAnswers, groupPromptFor, mentioned, MODES, MIN_MEMBERS, MAX_MEMBERS, MAX_TURNS, MODE_LABEL };
