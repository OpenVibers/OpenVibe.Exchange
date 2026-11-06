'use strict';
/**
 * The Arena: a prompt runs two models, the pair is blind, a vote is the person's own Bench judgement once and
 * only once, and the reveal names both models with their receipts. The category classifier is checked on its own.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');
const { createFakeBench } = require('./helpers/bench');
const { classify } = require('../server/arena/category');

(async () => {
    const ai = createFakeAi({
        chat: (args) => ({
            content: `An answer from ${args.model} about the question.`,
            model: args.model, provider: args.model.startsWith('deepseek') ? 'deepseek' : 'novita',
            run_id: `run_${args.model}`, cost_usd: 0.0002, usage: { tokens_in: 12, tokens_out: 30 },
            tokens_in: 12, tokens_out: 30, latency_ms: 500, why: ['cheapest healthy offer'],
        }),
    });
    const bench = createFakeBench();
    const t = await boot({ ai, bench });
    const alice = t.network.addUser('alice');
    const bob = t.network.addUser('bob');

    try {
        await check('the classifier puts a prompt on the right task board', async () => {
            assert.strictEqual(classify('Write a function that reads a CSV and sums a column'), 'code');
            assert.strictEqual(classify('Debug this stack trace: TypeError at line 12'), 'code');
            assert.strictEqual(classify('Translate “good morning” into Japanese'), 'translation');
            assert.strictEqual(classify('Write a poem about the sea at night'), 'writing');
            assert.strictEqual(classify('Prove that the square root of 2 is irrational, step by step'), 'reasoning');
            assert.strictEqual(classify('Compare the pros and cons of two pricing strategies'), 'analysis');
            assert.strictEqual(classify('Hello! How are you?'), 'chat');
        });

        await check('signed out, the Arena offers a sign-in and refuses to ask', async () => {
            const home = await t.get('/arena');
            assert.strictEqual(home.status, 200, home.text);
            assert.ok(home.text.includes('Sign in to ask'));
            const ask = await t.get('/arena/ask', { form: { prompt: 'Hello' } });
            assert.strictEqual(ask.status, 401);
        });

        let roundUrl;
        await check('one prompt runs two models on the person’s own allowance and records the pair', async () => {
            const r = await t.get('/arena/ask', { as: alice, form: { prompt: 'Write a function that reads a CSV and sums a column' } });
            assert.strictEqual(r.status, 303, r.text);
            roundUrl = r.headers.get('location');
            assert.match(roundUrl, /^\/arena\/exa_/);
            assert.strictEqual(ai.calls.length, 2, 'two runs, one per model');
            assert.ok(ai.calls.every((c) => c.subject === alice.subject), 'both runs are on the person’s behalf');
            assert.deepStrictEqual(ai.calls.map((c) => c.model).sort(), ['deepseek/deepseek-chat@v1', 'qwen/qwen3-32b@v1']);

            assert.strictEqual(bench.calls.rounds.length, 1);
            const made = bench.calls.rounds[0];
            assert.strictEqual(made.category, 'code');
            assert.strictEqual(made.entries.length, 2);
            assert.deepStrictEqual(made.entries.map((e) => e.model), ['deepseek/deepseek-chat', 'qwen/qwen3-32b']);
            assert.ok(made.entries.every((e) => e.answer.includes('An answer from')));
        });

        await check('the pair is blind: the words, and no model name or provider', async () => {
            const r = await t.get(roundUrl, { as: alice });
            assert.strictEqual(r.status, 200, r.text);
            assert.ok(r.text.includes('Model A') && r.text.includes('Model B'));
            assert.ok(r.text.includes('An answer from deepseek/deepseek-chat@v1'));
            assert.ok(!r.text.includes('DeepSeek Chat'), 'no model name before the vote');
            assert.ok(!r.text.includes('Qwen3 32B'), 'no model name before the vote');
            assert.ok(!r.text.includes('Receipt'), 'no receipt before the vote');
            assert.ok(r.text.includes('A is better') && r.text.includes('Both bad'));
            assert.ok(r.text.includes('code'), 'the task category is said');
        });

        await check('a vote is the person’s own Bench judgement, once', async () => {
            const r = await t.get(`${roundUrl}/vote`, { as: alice, form: { outcome: 'left' } });
            assert.strictEqual(r.status, 303, r.text);
            assert.strictEqual(bench.calls.votes.length, 1);
            const vote = bench.calls.votes[0];
            assert.strictEqual(vote.subject, alice.subject);
            assert.strictEqual(vote.outcome, 'left');
            assert.strictEqual(vote.roundId, 'brd_TEST1');
            assert.deepStrictEqual(vote.pair, { left: 'bte_TEST10', right: 'bte_TEST11' });

            const page = await t.get(roundUrl, { as: alice });
            assert.strictEqual(page.status, 200);
            assert.ok(page.text.includes('DeepSeek Chat') && page.text.includes('Qwen3 32B'), 'both names revealed');
            assert.ok(page.text.includes('Receipt') && page.text.includes('Why this offer'), 'the receipts are open');
            assert.ok(page.text.includes('You chose A'), 'the person’s vote is shown');
            assert.ok(page.text.includes('$0.000200'), 'the run’s cost');
        });

        await check('a second vote on the same round is refused and never counted again', async () => {
            const again = await t.get(`${roundUrl}/vote`, { as: alice, form: { outcome: 'right' } });
            assert.strictEqual(again.status, 409, again.text);
            assert.strictEqual(bench.calls.votes.length, 1, 'Bench was asked once');
            const row = await t.ctx.s.db.maybe('SELECT COUNT(*)::int AS n FROM exchange_arena_votes WHERE owner = $1', [alice.subject]);
            assert.strictEqual(Number(row.n), 1, 'one local vote');
        });

        await check('another account cannot open or vote on this round', async () => {
            assert.strictEqual((await t.get(roundUrl, { as: bob })).status, 404);
            assert.strictEqual((await t.get(`${roundUrl}/vote`, { as: bob, form: { outcome: 'left' } })).status, 404);
            assert.strictEqual(bench.calls.votes.length, 1);
        });

        await check('a cross-site vote is refused', async () => {
            const r = await t.get(`${roundUrl}/vote`, { as: alice, form: { outcome: 'left' }, origin: 'https://evil.test' });
            assert.strictEqual(r.status, 403);
        });
    } finally { await t.close(); }

    const capped = await boot({ ai: createFakeAi(), bench: createFakeBench(), env: { EXCHANGE_ARENA_VOTES_PER_HOUR: '1' } });
    const carol = capped.network.addUser('carol');
    try {
        await check('votes are rate-limited per person', async () => {
            const first = await capped.get('/arena/ask', { as: carol, form: { prompt: 'Explain a mutex' } });
            const second = await capped.get('/arena/ask', { as: carol, form: { prompt: 'Explain a semaphore' } });
            assert.strictEqual(first.status, 303, first.text);
            assert.strictEqual(second.status, 303, second.text);
            const one = await capped.get(`${first.headers.get('location')}/vote`, { as: carol, form: { outcome: 'tie' } });
            assert.strictEqual(one.status, 303, one.text);
            const two = await capped.get(`${second.headers.get('location')}/vote`, { as: carol, form: { outcome: 'left' } });
            assert.strictEqual(two.status, 429, two.text);
            assert.ok(two.text.includes('votes in an hour'));
        });

        await check('the daily arena allowance stops at its number', async () => {
            const cappedTwo = await boot({ ai: createFakeAi(), bench: createFakeBench(), env: { EXCHANGE_ARENA_PER_DAY: '1' } });
            const dave = cappedTwo.network.addUser('dave');
            try {
                assert.strictEqual((await cappedTwo.get('/arena/ask', { as: dave, form: { prompt: 'one' } })).status, 303);
                const second = await cappedTwo.get('/arena/ask', { as: dave, form: { prompt: 'two' } });
                assert.strictEqual(second.status, 429, second.text);
                assert.ok(second.text.includes('arena prompts'));
            } finally { await cappedTwo.close(); }
        });
    } finally { await capped.close(); }

    const broken = createFakeBench({
        vote: async () => { const err = new Error('Bench is down'); err.status = 503; err.code = 'bench.failed'; throw err; },
    });
    const t2 = await boot({ ai: createFakeAi(), bench: broken });
    const erin = t2.network.addUser('erin');
    try {
        await check('when Bench is down the vote is refused and nothing is recorded locally', async () => {
            const ask = await t2.get('/arena/ask', { as: erin, form: { prompt: 'Hello there' } });
            assert.strictEqual(ask.status, 303, ask.text);
            const vote = await t2.get(`${ask.headers.get('location')}/vote`, { as: erin, form: { outcome: 'left' } });
            assert.strictEqual(vote.status, 503, vote.text);
            assert.ok(vote.text.includes('cannot count yet'));
            const row = await t2.ctx.s.db.maybe('SELECT COUNT(*)::int AS n FROM exchange_arena_votes WHERE owner = $1', [erin.subject]);
            assert.strictEqual(Number(row.n), 0, 'no local vote without a Bench judgement');
        });
    } finally { await t2.close(); }

    done();
})();
