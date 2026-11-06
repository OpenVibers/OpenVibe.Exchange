'use strict';

/**
 * Character cards and one-character chats (Opus's design, 2026-11-06).
 *
 * Every read and write is scoped by the owner in the WHERE clause, not checked after the fact: a card id or a
 * chat id from another account finds nothing. The gallery is the one public read, and it says public only.
 */

const SORTS = { new: 'new', week: 'week', remixed: 'remixed' };

function createCharacterStore(s) {
    const db = s.db;

    const shape = (row) => {
        if (!row) return null;
        const t = parseJson(row.tags);
        return { ...row, tags: Array.isArray(t) ? t : [] };
    };

    async function create({ owner, handle, name, ...rest }) {
        const id = s.newId('exc');
        let slug = slugify(rest.slug || name);
        for (let n = 2; n < 20; n++) {
            const taken = await db.prepare('SELECT 1 FROM exchange_characters WHERE handle = ? AND slug = ?').get(String(handle || '').toLowerCase(), slug);
            if (!taken) break;
            slug = slugify(rest.slug || name) + '-' + n;
        }
        await db.prepare('INSERT INTO exchange_characters (id, owner, handle, slug, name, description, personality, scenario, first_message, example_dialogue, avatar_url, rating, age, model, voice, audience, allow_remix, share_id, remix_of, original_author) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(id, owner, String(handle || '').slice(0, 64), slug, String(name).slice(0, 80),
                text(rest.description), text(rest.personality), text(rest.scenario), text(rest.first_message),
                text(rest.example_dialogue), rest.avatar_url ? String(rest.avatar_url) : null,
                rest.rating === 'adult' ? 'adult' : 'everyone', ageOf(rest.age), rest.model ? String(rest.model).slice(0, 120) : null,
                rest.voice ? String(rest.voice).slice(0, 120) : null, rest.audience || 'private', rest.allow_remix === false ? false : true,
                rest.share_id ? String(rest.share_id) : null, rest.remix_of ? String(rest.remix_of) : null,
                rest.original_author ? String(rest.original_author).slice(0, 64) : null);
        await setTags(id, rest.tags);
        return get(owner, id);
    }

    async function get(owner, id) {
        const row = await db.prepare('SELECT * FROM exchange_characters WHERE id = ? AND owner = ?').get(String(id || ''), owner);
        return shape(row);
    }

    /** The public read: a card by its page path. Anyone may look; the audience decides what they may see. */
    async function bySlug(handle, slug) {
        const row = await db.prepare('SELECT * FROM exchange_characters WHERE handle = ? AND slug = ?')
            .get(String(handle || '').toLowerCase(), String(slug || '').toLowerCase());
        return shape(row);
    }

    async function update(owner, id, rest) {
        const fields = ['name', 'description', 'personality', 'scenario', 'first_message', 'example_dialogue',
            'avatar_url', 'rating', 'age', 'model', 'voice', 'audience', 'allow_remix', 'remix_of', 'original_author'];
        const sets = [];
        const values = [];
        for (const f of fields) {
            if (!(f in rest)) continue;
            sets.push(f + ' = ?');
            if (f === 'rating') values.push(rest[f] === 'adult' ? 'adult' : 'everyone');
            else if (f === 'age') values.push(ageOf(rest[f]));
            else if (f === 'allow_remix') values.push(rest[f] === false ? false : true);
            else if (f === 'name') values.push(String(rest[f] || '').slice(0, 80));
            else if (f === 'audience') values.push(['private', 'unlisted', 'public'].includes(rest[f]) ? rest[f] : 'private');
            else if (f === 'avatar_url') values.push(rest[f] ? String(rest[f]) : null);
            else if (f === 'model' || f === 'voice') values.push(rest[f] ? String(rest[f]).slice(0, 120) : null);
            else if (f === 'remix_of') values.push(rest[f] ? String(rest[f]) : null);
            else if (f === 'original_author') values.push(rest[f] ? String(rest[f]).slice(0, 64) : null);
            else values.push(text(rest[f]));
        }
        if (sets.length) {
            await db.prepare('UPDATE exchange_characters SET ' + sets.join(', ') + ', updated_at = now() WHERE id = ? AND owner = ?')
                .run(...values, String(id), owner);
        }
        if ('tags' in rest) await setTags(String(id), rest.tags);
        return get(owner, id);
    }

    async function setTags(id, tags) {
        const list = [...new Set((Array.isArray(tags) ? tags : []).map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 20);
        await db.prepare('DELETE FROM exchange_character_tags WHERE character_id = ?').run(String(id));
        await db.prepare('UPDATE exchange_characters SET tags = ? WHERE id = ?').run(JSON.stringify(list), String(id));
        for (const tag of list) {
            await db.prepare('INSERT INTO exchange_character_tags (character_id, tag) VALUES (?, ?) ON CONFLICT DO NOTHING').run(String(id), tag);
        }
    }

    async function listByOwner(owner) {
        const rows = await db.prepare('SELECT * FROM exchange_characters WHERE owner = ? ORDER BY updated_at DESC').all(owner);
        return rows.map(shape);
    }

    async function allTags(limit = 40) {
        const rows = await db.prepare('SELECT tag, COUNT(*) AS n FROM exchange_character_tags GROUP BY tag ORDER BY n DESC, tag LIMIT ?').all(limit);
        return rows.map((r) => ({ tag: r.tag, n: Number(r.n) || 0 }));
    }

    /**
     * The gallery. Only public cards, and only cards rated for everyone unless the person is signed in with the
     * 18+ confirmation: an 18+ card never appears on a public list for anybody else.
     */
    async function gallery({ sort = 'new', q = '', tags = [], limit = 12, offset = 0, allowAdult = false } = {}) {
        const where = ["c.audience = 'public'"];
        const values = [];
        if (!allowAdult) where.push("c.rating = 'everyone'");
        if (q) {
            where.push('(c.name ILIKE ? OR c.description ILIKE ? OR c.personality ILIKE ?)');
            const like = '%' + String(q).slice(0, 80) + '%';
            values.push(like, like, like);
        }
        for (const tag of tags.slice(0, 5)) {
            where.push('EXISTS (SELECT 1 FROM exchange_character_tags t WHERE t.character_id = c.id AND t.tag = ?)');
            values.push(String(tag).toLowerCase());
        }
        const order = sort === SORTS.week
            ? 'week_views DESC, c.created_at DESC'
            : sort === SORTS.remixed
                ? 'remixes DESC, c.created_at DESC'
                : 'c.created_at DESC';
        const sql = 'SELECT c.*, (SELECT COUNT(*) FROM exchange_character_views v WHERE v.character_id = c.id AND v.viewed_at >= now() - interval \'7 days\') AS week_views, (SELECT COUNT(*) FROM exchange_characters r WHERE r.remix_of = c.id) AS remixes FROM exchange_characters c WHERE ' + where.join(' AND ') + ' ORDER BY ' + order + ' LIMIT ? OFFSET ?';
        const rows = await db.prepare(sql).all(...values, Math.max(1, Math.min(60, limit)), Math.max(0, offset));
        const count = await db.prepare('SELECT COUNT(*) AS n FROM exchange_characters c WHERE ' + where.join(' AND ')).get(...values);
        return { items: rows.map(shape), total: Number(count && count.n) || 0 };
    }

    async function addView(characterId, viewer) {
        await db.prepare('INSERT INTO exchange_character_views (character_id, viewer) VALUES (?, ?)').run(String(characterId), viewer || null);
    }

    async function countRemixes(characterId) {
        const row = await db.prepare('SELECT COUNT(*) AS n FROM exchange_characters WHERE remix_of = ?').get(String(characterId));
        return Number(row && row.n) || 0;
    }

    async function tagsOf(characterId) {
        const rows = await db.prepare('SELECT tag FROM exchange_character_tags WHERE character_id = ? ORDER BY tag').all(String(characterId));
        return rows.map((r) => r.tag);
    }

    return { create, get, bySlug, update, listByOwner, gallery, allTags, addView, countRemixes, tagsOf, setTags, SORTS };
}

/**
 * One-character chats, with a branching tree. A turn is a group (turn_id) of user messages: editing a message
 * adds a variant to that group, and regenerating adds another answer to it. Nothing is overwritten, so the
 * tree keeps every branch and the arrows walk it.
 */
function createCompanionChatStore(s) {
    const db = s.db;

    async function create({ owner, characterId, title = 'New chat', settings = {} }) {
        const id = s.newId('exc');
        await db.prepare('INSERT INTO exchange_companion_chats (id, owner, character_id, title, model, preset, temperature, context_size, persona) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(id, owner, String(characterId), String(title).slice(0, 120) || 'New chat',
                settings.model ? String(settings.model).slice(0, 120) : null, settings.preset ? String(settings.preset).slice(0, 120) : null,
                settings.temperature == null ? null : Number(settings.temperature),
                settings.context_size == null ? null : Number(settings.context_size),
                settings.persona ? String(settings.persona).slice(0, 2000) : null);
        return get(owner, id);
    }

    async function get(owner, id) {
        const row = await db.prepare('SELECT * FROM exchange_companion_chats WHERE id = ? AND owner = ?').get(String(id || ''), owner);
        return row || null;
    }

    async function list(owner, limit = 60) {
        const rows = await db.prepare('SELECT c.*, ch.name AS character_name FROM exchange_companion_chats c JOIN exchange_characters ch ON ch.id = c.character_id WHERE c.owner = ? ORDER BY c.updated_at DESC LIMIT ?').all(owner, Math.max(1, Math.min(200, limit)));
        return rows;
    }

    async function messages(chatId) {
        const rows = await db.prepare('SELECT * FROM exchange_companion_messages WHERE chat_id = ? ORDER BY id').all(String(chatId));
        return rows.map((r) => ({ ...r, meta: parseJson(r.meta) }));
    }

    async function append({ owner, chatId, role, content = null, turnId, variant = 0, parentId = null, model = null, meta = {} }) {
        const id = s.newId('exm');
        await db.prepare('INSERT INTO exchange_companion_messages (id, chat_id, owner, role, content, turn_id, variant, parent_id, model, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .run(id, String(chatId), owner, role, content == null ? null : String(content), String(turnId), Number(variant) || 0,
                parentId ? String(parentId) : null, model ? String(model) : null, JSON.stringify(meta || {}));
        await db.prepare('UPDATE exchange_companion_chats SET updated_at = now() WHERE id = ? AND owner = ?').run(String(chatId), owner);
        return id;
    }

    /** The next variant number inside a turn group. */
    async function nextVariant(chatId, turnId, parentId = null) {
        const row = parentId
            ? await db.prepare('SELECT MAX(variant) AS v FROM exchange_companion_messages WHERE chat_id = ? AND parent_id = ?').get(String(chatId), String(parentId))
            : await db.prepare('SELECT MAX(variant) AS v FROM exchange_companion_messages WHERE chat_id = ? AND turn_id = ? AND role = \'user\'').get(String(chatId), String(turnId));
        return (Number(row && row.v) || -1) + 1;
    }

    async function settings(owner, chatId, next) {
        const sets = [];
        const values = [];
        for (const f of ['model', 'preset', 'temperature', 'context_size', 'persona', 'title']) {
            if (!(f in next)) continue;
            sets.push(f + ' = ?');
            if (f === 'temperature') values.push(next[f] == null || next[f] === '' ? null : Number(next[f]));
            else if (f === 'context_size') values.push(next[f] == null || next[f] === '' ? null : Number(next[f]));
            else values.push(next[f] == null || next[f] === '' ? null : String(next[f]).slice(0, 2000));
        }
        if (sets.length) {
            await db.prepare('UPDATE exchange_companion_chats SET ' + sets.join(', ') + ', updated_at = now() WHERE id = ? AND owner = ?')
                .run(...values, String(chatId), owner);
        }
        return get(owner, chatId);
    }

    async function remove(owner, chatId) {
        await db.prepare('DELETE FROM exchange_companion_chats WHERE id = ? AND owner = ?').run(String(chatId), owner);
    }

    /** Assistant turns answered today by this person: the daily allowance's counter. */
    async function countToday(owner) {
        const row = await db.prepare('SELECT COUNT(*) AS n FROM exchange_companion_messages WHERE owner = ? AND role = \'assistant\' AND created_at >= date_trunc(\'day\', now())').get(owner);
        return Number(row && row.n) || 0;
    }

    return { create, get, list, messages, append, nextVariant, settings, remove, countToday };
}

/**
 * The chat's tree, read as turns. Each turn is one user message (the variant the person is looking at) and the
 * answers to it. The chosen variant comes from the page's query string, so the arrows are plain links.
 */
function readTurns(messages, selected = {}) {
    const groups = new Map();
    for (const m of messages) {
        if (!groups.has(m.turn_id)) groups.set(m.turn_id, []);
        groups.get(m.turn_id).push(m);
    }
    const turns = [];
    for (const [turnId, all] of groups) {
        const users = all.filter((m) => m.role === 'user').sort((a, b) => a.variant - b.variant);
        const answers = all.filter((m) => m.role === 'assistant');
        if (!users.length) continue;
        const want = Number(selected['v_' + turnId]);
        const user = Number.isFinite(want) && users[want] ? users[want] : users[users.length - 1];
        const mine = answers.filter((a) => a.parent_id === user.id).sort((a, b) => a.variant - b.variant);
        const wantA = Number(selected['a_' + user.id]);
        const answer = Number.isFinite(wantA) && mine[wantA] ? mine[wantA] : (mine[mine.length - 1] || null);
        turns.push({ id: turnId, users, user, answers: mine, answer, index: turns.length });
    }
    return turns;
}

const parseJson = (v) => { try { return v ? JSON.parse(v) : {}; } catch (e) { return {}; } };
const text = (v) => (v == null ? '' : String(v));
const ageOf = (v) => {
    if (v == null || v === '') return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 && n <= 999 ? n : null;
};
const slugify = (s) => String(s || 'character').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'character';

module.exports = { createCharacterStore, createCompanionChatStore, readTurns, SORTS };
