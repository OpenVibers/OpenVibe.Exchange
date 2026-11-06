'use strict';
/**
 * A person's arena rounds and votes. Every read and write is scoped by the owner in the WHERE clause; a round
 * id from another account finds nothing. The pair and its receipts live here so a refresh never runs the models
 * again, and the vote row is the local half of the Bench judgement (one per person per round).
 */
function createArenaStore(s) {
    const db = s.db;

    async function create({ owner, prompt, category, models, benchRoundId = null, benchLeft = null, benchRight = null }) {
        const id = s.newId('exa');
        await db.prepare(`INSERT INTO exchange_arena_rounds
            (id, owner, prompt, category, models, bench_round_id, bench_left, bench_right)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, owner, String(prompt).slice(0, 8000), String(category).slice(0, 40), JSON.stringify(models || []),
                benchRoundId, benchLeft, benchRight);
        return get(owner, id);
    }

    function parse(row) {
        if (!row) return null;
        let models = [];
        try { models = JSON.parse(row.models || '[]'); } catch { models = []; }
        return { ...row, models: Array.isArray(models) ? models : [] };
    }

    async function get(owner, id) {
        return parse(await db.prepare('SELECT * FROM exchange_arena_rounds WHERE id = ? AND owner = ?').get(String(id || ''), owner));
    }

    /** A round without its owner in the query, for the sharing check to decide who may read it. */
    async function find(id) {
        return parse(await db.prepare('SELECT * FROM exchange_arena_rounds WHERE id = ?').get(String(id || '')));
    }

    async function recent(owner, limit = 8) {
        const rows = await db.prepare('SELECT id, prompt, category, created_at FROM exchange_arena_rounds WHERE owner = ? ORDER BY created_at DESC LIMIT ?')
            .all(owner, Math.max(1, Math.min(30, limit)));
        return rows.map((r) => ({ ...r }));
    }

    async function voteOf(owner, roundId) {
        return await db.prepare('SELECT * FROM exchange_arena_votes WHERE round_id = ? AND owner = ?').get(String(roundId || ''), owner) || null;
    }

    /** Record the vote after Bench accepted it. A second row for the same person and round is never written. */
    async function castVote({ owner, roundId, outcome, benchJudgementId = null }) {
        const row = await db.prepare(`INSERT INTO exchange_arena_votes (round_id, owner, outcome, bench_judgement_id)
            VALUES (?, ?, ?, ?) ON CONFLICT (round_id, owner) DO NOTHING RETURNING *`)
            .get(String(roundId), owner, String(outcome), benchJudgementId);
        return row ? { ...row } : voteOf(owner, roundId);
    }

    /** Rounds this person asked for today: the arena's own daily allowance, apart from the chat's. */
    async function askedToday(owner) {
        const row = await db.prepare("SELECT COUNT(*) AS n FROM exchange_arena_rounds WHERE owner = ? AND created_at >= date_trunc('day', now())").get(owner);
        return Number(row && row.n) || 0;
    }

    /** Votes this person cast in the last hour: the rate limit on the vote, per person. */
    async function votesLastHour(owner) {
        const row = await db.prepare("SELECT COUNT(*) AS n FROM exchange_arena_votes WHERE owner = ? AND created_at >= now() - interval '1 hour'").get(owner);
        return Number(row && row.n) || 0;
    }

    return { create, get, find, recent, voteOf, castVote, askedToday, votesLastHour };
}

module.exports = { createArenaStore };
