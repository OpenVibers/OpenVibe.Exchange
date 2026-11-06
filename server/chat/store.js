'use strict';
/**
 * A person's chats and their 18+ confirmation.
 *
 * Every read and write is scoped by the owner in the WHERE clause, not checked after the fact: a chat
 * id from another account finds nothing. Messages hang off their chat (ON DELETE CASCADE) and carry the
 * owner too, so an export or a deletion is one column and never a join.
 */
function createChatStore(s) {
    const db = s.db;

    async function create({ owner, models = [], title = 'New chat' }) {
        const id = s.newId('exc');
        await db.prepare(`INSERT INTO exchange_chats (id, owner, title, models) VALUES (?, ?, ?, ?)`)
            .run(id, owner, String(title).slice(0, 120) || 'New chat', JSON.stringify(models.slice(0, 3)));
        return get(owner, id);
    }

    async function get(owner, id) {
        const row = await db.prepare('SELECT * FROM exchange_chats WHERE id = ? AND owner = ?').get(String(id || ''), owner);
        return row ? { ...row, models: parseModels(row.models) } : null;
    }

    async function list(owner, limit = 60) {
        const rows = await db.prepare('SELECT id, title, models, updated_at FROM exchange_chats WHERE owner = ? ORDER BY updated_at DESC LIMIT ?')
            .all(owner, Math.max(1, Math.min(200, limit)));
        return rows.map((r) => ({ ...r, models: parseModels(r.models) }));
    }

    async function messages(owner, chatId) {
        const rows = await db.prepare('SELECT * FROM exchange_chat_messages WHERE chat_id = ? AND owner = ? ORDER BY created_at, id')
            .all(String(chatId || ''), owner);
        return rows.map((r) => ({ ...r, meta: parseJson(r.meta) }));
    }

    async function append(owner, chatId, { role, model = null, content = null, error = null, meta = {} }) {
        const id = s.newId('exm');
        await db.prepare(`INSERT INTO exchange_chat_messages (id, chat_id, owner, role, model, content, error, meta)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, chatId, owner, role, model, content == null ? null : String(content), error == null ? null : String(error).slice(0, 2000), JSON.stringify(meta || {}));
        await db.prepare('UPDATE exchange_chats SET updated_at = now() WHERE id = ? AND owner = ?').run(chatId, owner);
        return id;
    }

    async function rename(owner, chatId, title) {
        await db.prepare('UPDATE exchange_chats SET title = ?, updated_at = now() WHERE id = ? AND owner = ?')
            .run(String(title).slice(0, 120), chatId, owner);
    }

    async function settings(owner, chatId, { models, systemPrompt, temperature }) {
        await db.prepare(`UPDATE exchange_chats SET models = ?, system_prompt = ?, temperature = ?, updated_at = now()
            WHERE id = ? AND owner = ?`)
            .run(JSON.stringify((models || []).slice(0, 3)), systemPrompt == null ? null : String(systemPrompt).slice(0, 4000),
                temperature == null ? null : Number(temperature), chatId, owner);
    }

    async function clear(owner, chatId) {
        await db.prepare('DELETE FROM exchange_chat_messages WHERE chat_id = ? AND owner = ?').run(chatId, owner);
        await db.prepare('UPDATE exchange_chats SET updated_at = now() WHERE id = ? AND owner = ?').run(chatId, owner);
    }

    async function remove(owner, chatId) {
        await db.prepare('DELETE FROM exchange_chats WHERE id = ? AND owner = ?').run(chatId, owner);
    }

    /** Assistant turns answered today by this person: the daily allowance's counter. */
    async function countToday(owner) {
        const row = await db.prepare(`SELECT COUNT(*) AS n FROM exchange_chat_messages
            WHERE owner = ? AND role = 'assistant' AND created_at >= date_trunc('day', now())`).get(owner);
        return Number(row && row.n) || 0;
    }

    return { create, get, list, messages, append, rename, settings, clear, remove, countToday };
}

function createAdultStore(s) {
    const db = s.db;
    async function confirmed(subject) {
        if (!subject) return false;
        return Boolean(await db.prepare('SELECT subject FROM exchange_adult_confirmations WHERE subject = ?').get(subject));
    }
    async function confirm(subject, version) {
        await db.prepare(`INSERT INTO exchange_adult_confirmations (subject, version) VALUES (?, ?)
            ON CONFLICT (subject) DO UPDATE SET version = excluded.version, confirmed_at = now()`).run(subject, version);
    }
    async function forget(subject) {
        await db.prepare('DELETE FROM exchange_adult_confirmations WHERE subject = ?').run(subject);
    }
    return { confirmed, confirm, forget };
}

const parseJson = (v) => { try { return v ? JSON.parse(v) : {}; } catch (e) { return {}; } };
const parseModels = (v) => { const a = parseJson(v); return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []; };

module.exports = { createChatStore, createAdultStore };
