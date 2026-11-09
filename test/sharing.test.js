'use strict';
/**
 * Sharing on Exchange (design 2026-11-06, visibility step 2): chats, arena rounds and character cards use the one
 * Share sheet (openvibe-sdk/share) and the one check, canView, on every read path.
 *
 *   - a new chat and a new round are Only me; the Share sheet changes just that one;
 *   - Anyone with the link reads a chat without its composer, and a shared round names both models and has no vote;
 *   - Specific people shows the gate, never the title or a turn, to somebody not on the list;
 *   - a sealed chat has no Share sheet and cannot be moved off Only me;
 *   - the person's default for new items, and "apply to all", work per kind.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');
const { createFakeBench } = require('./helpers/bench');

(async () => {
    const ai = createFakeAi({
        chat: (args) => ({
            content: `An answer from ${args.model}.`,
            model: args.model, provider: args.model.startsWith('deepseek') ? 'deepseek' : 'novita',
            run_id: `run_${args.model}`, cost_usd: 0.0002, tokens_in: 12, tokens_out: 30, latency_ms: 500,
            why: ['cheapest healthy offer'],
        }),
    });
    const bench = createFakeBench();
    const t = await boot({ ai, bench });
    const alice = t.network.addUser('alice');
    const bob = t.network.addUser('bob');
    const carol = t.network.addUser('carol');

    const call = (pathname, o = {}) => { const { headers, ...rest } = o; return t.get(pathname, { ...rest, headers: { 'x-requested-with': 'ov-share', ...(headers || {}) } }); };
    const share = (kind, id, o = {}) => call(`/api/v1/${kind}/${encodeURIComponent(id)}/share`, o);
    const setShare = async (kind, id, body, as) => {
        const first = await share(kind, id, { as });
        assert.strictEqual(first.status, 200, first.text);
        const etag = first.headers.get('etag');
        assert.ok(etag, 'the share read carries an ETag');
        return await share(kind, id, { as, method: 'PUT', json: body, headers: { 'if-match': etag } });
    };
    const audienceRow = async (kind, id) => await t.ctx.s.db.maybe(
        'SELECT audience FROM shares WHERE service = $1 AND kind = $2 AND resource_id = $3', ['exchange', kind, id]);

    try {
        let roundId;
        await check('a new Arena round is Only me, and a shared round names both models with no vote', async () => {
            const asked = await t.get('/arena/ask', { as: alice, form: { prompt: 'Write a function that reads a CSV and sums a column' } });
            assert.strictEqual(asked.status, 303, asked.text);
            roundId = asked.headers.get('location').split('/').pop();
            assert.deepStrictEqual(await audienceRow('arena-round', roundId), { audience: 'private' });
            const hidden = await t.get(`/arena/${roundId}`, { as: bob });
            assert.strictEqual(hidden.status, 404);
            const saved = await setShare('arena-round', roundId, { audience: 'public' }, alice);
            assert.strictEqual(saved.status, 200, saved.text);
            const seen = await t.get(`/arena/${roundId}`, { as: bob });
            assert.strictEqual(seen.status, 200, seen.text);
            assert.ok(seen.text.includes('A shared Arena round'));
            assert.ok(seen.text.includes('DeepSeek Chat') && seen.text.includes('Qwen3 32B'), 'both names are shown');
            assert.ok(!seen.text.includes('name="outcome"'), 'a reader does not vote on somebody else\'s round');
        });

        await check('characters: Only me while being written, Specific people to show one, the default for new cards', async () => {
            const FORM = { name: 'Ines', description: 'A cartographer', personality: 'patient', scenario: 'a map room', first_message: 'Where to?', rating: 'everyone' };
            const made = await t.get('/companions/new', { as: alice, form: FORM });
            assert.strictEqual(made.status, 303, made.text);
            const card = (await t.ctx.characters.listByOwner(alice.subject)).find((c) => c.name === 'Ines');
            assert.deepStrictEqual(await audienceRow('character', card.id), { audience: 'private' });
            const other = await t.get(made.headers.get('location'), { as: bob });
            assert.strictEqual(other.status, 403);
            assert.ok(!other.text.includes('A cartographer'));
            const saved = await setShare('character', card.id, { audience: 'people', members: [{ name: 'bob', role: 'viewer' }] }, alice);
            assert.strictEqual(saved.status, 200, saved.text);
            const reader = await t.get(made.headers.get('location'), { as: bob });
            assert.strictEqual(reader.status, 200, reader.text);
            assert.ok(reader.text.includes('A cartographer'));
            const stranger = await t.get(made.headers.get('location'), { as: carol });
            assert.strictEqual(stranger.status, 404);
            assert.ok(stranger.text.includes('shared with specific people'));
            assert.ok(!stranger.text.includes('A cartographer'));

            const defaults = await t.get('/companions/defaults', { as: alice, form: { audience: 'link' } });
            assert.strictEqual(defaults.status, 303);
            const second = await t.get('/companions/new', { as: alice, form: { ...FORM, name: 'Second Ines' } });
            const card2 = (await t.ctx.characters.listByOwner(alice.subject)).find((c) => c.name === 'Second Ines');
            assert.deepStrictEqual(await audienceRow('character', card2.id), { audience: 'link' });
            assert.ok(second.status === 303);
        });
    } finally {
        await t.close();
        done();
    }
})();
