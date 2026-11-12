'use strict';
// POST /api/v1/estimate: what one run of an agents.blueprint@1 costs, from the person's choices or the public offers.
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');

const doc = (brain = {}) => ({
    id: 'bp_estimate_test', version: 1, state: 'draft', name: 'Estimate test',
    summary: 'One run of an agent, priced before it runs.',
    author: { type: 'user', id: 'usr_01JD8C4QJ7Z3K9W2X5V6N1M0PB' }, visibility: 'private',
    brain: { pick: 'auto', rungs: ['credits'], ...brain },
    knows: { instructions: 'Answer the question in one paragraph.' },
});

(async () => {
    const ai = createFakeAi();
    const calls = [];
    ai.meRequest = async (token, path) => {
        calls.push({ token, path });
        return { options: {
            openvibe: [
                // No per-million price here: the route joins AI's choice view to the public catalogue's prices.
                { model: 'deepseek/deepseek-chat', source: 'openvibe', name: 'DeepSeek Chat', maker: 'DeepSeek', tier: 'small', caps: ['tools'] },
                { model: 'qwen/qwen3-32b', source: 'openvibe', name: 'Qwen3 32B', maker: 'Qwen' },
                { model: 'dear/model', source: 'openvibe', name: 'Dear Model', maker: 'dear', price: { in: 2, out: 2 }, tier: 'strong' },
            ],
            keys: [{ model: 'key/model', source: 'keys', name: 'Key Model' }],
            machines: [{ model: 'machine/model', source: 'machines', name: 'Machine Model', machine: 'dev_01JD8C4QJ7Z3K9W2X5V6N1M0PB', machine_name: 'desk' }],
            plans: [{ model: 'plan/model', source: 'plans', name: 'Plan Model' }],
        } };
    };

    const t = await boot({ ai });
    const user = t.network.addUser('estimate-user');
    try {
        await check('a credits-only blueprint picks the cheapest credit model and multiplies by turns', async () => {
            const res = await t.get('/api/v1/estimate', { as: user, json: { blueprint: doc(), turns: 4 } });
            assert.strictEqual(res.status, 200, res.text);
            const data = res.json();
            // DeepSeek's cheapest catalogue offer is $0.20 in / $0.30 out per million: 2,000 in + 800 out,
            // four turns.
            assert.strictEqual(data.usd_per_run, 0.00256);
            assert.deepStrictEqual(data.cheapest, { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', rung: 'credits' });
            assert.strictEqual(data.turns, 4);
            assert.deepStrictEqual(data.tokens, { in: 2000, out: 800 });
            assert(calls.some((c) => c.path === '/api/v1/choices?task=chat' && c.token), 'the person’s choices are read for the chat task');
            assert.strictEqual(res.headers.get('cache-control'), 'private, no-store');
        });

        await check('max_usd_per_m excludes a dearer model', async () => {
            const pinned = doc({ pick: 'exact', model: 'dear/model', rungs: ['credits'], max_usd_per_m: 0.5 });
            const res = await t.get('/api/v1/estimate', { as: user, json: { blueprint: pinned, turns: 1 } });
            assert.strictEqual(res.status, 200, res.text);
            const data = res.json();
            assert.strictEqual(data.usd_per_run, 0.00064, 'the cheap model at one turn');
            assert.strictEqual(data.cheapest.id, 'deepseek/deepseek-chat', 'the dear model is over the blueprint’s ceiling');
        });

        await check('signed in, a machine, a plan and the free allowance are the person’s own rungs', async () => {
            const res = await t.get('/api/v1/estimate', { as: user, json: { blueprint: doc({ rungs: ['machine', 'plan', 'allowance'] }) } });
            assert.strictEqual(res.status, 200, res.text);
            const data = res.json();
            assert.strictEqual(data.usd_per_run, 0);
            assert.deepStrictEqual(data.cheapest, { id: 'machine/model', name: 'Machine Model', rung: 'machine' });
            assert.deepStrictEqual(data.free_on, ['machine', 'plan', 'allowance']);
        });

        await check('an invalid blueprint is 422 with the errors', async () => {
            const res = await t.get('/api/v1/estimate', { as: user, json: { blueprint: { id: 'nope', knows: {} } } });
            assert.strictEqual(res.status, 422, res.text);
            assert.strictEqual(res.headers.get('content-type').startsWith('application/problem+json'), true);
            const data = res.json();
            assert.strictEqual(data.code, 'blueprint.invalid');
            assert(Array.isArray(data.errors) && data.errors.length > 0);
            assert(data.errors.some((e) => e.at === '/id'), 'the invalid id is named');
        });

        await check('turns must be 1 to 50', async () => {
            for (const turns of [0, 51, 2.5, 'many']) {
                const res = await t.get('/api/v1/estimate', { as: user, json: { blueprint: doc(), turns } });
                assert.strictEqual(res.status, 422, `${turns}: ${res.text}`);
                assert.strictEqual(res.json().code, 'turns.invalid');
            }
        });

        await check('signed out uses only public offers on the allowance and credits rungs', async () => {
            calls.length = 0;
            const res = await t.get('/api/v1/estimate', { json: { blueprint: doc({ rungs: ['allowance', 'credits'] }) } });
            assert.strictEqual(res.status, 200, res.text);
            const data = res.json();
            // AI's catalogue has DeepSeek at $0.20/$0.30 and Qwen at $0.40/$0.90; the free tier puts DeepSeek
            // on the allowance first, and the response still names only a public rung.
            assert.strictEqual(data.cheapest.id, 'deepseek/deepseek-chat');
            assert(['allowance', 'credits'].includes(data.cheapest.rung));
            assert.deepStrictEqual(data.free_on, ['allowance']);
            assert.strictEqual(calls.length, 0, 'signed out never asks for a person’s choices');
            assert.strictEqual(res.headers.get('cache-control'), 'public, max-age=60');
        });

        await check('signed out cannot run on a machine, plan or key', async () => {
            const res = await t.get('/api/v1/estimate', { json: { blueprint: doc({ rungs: ['machine', 'plan', 'key'] }) } });
            assert.strictEqual(res.status, 200, res.text);
            const data = res.json();
            assert.strictEqual(data.usd_per_run, null);
            assert.strictEqual(data.cheapest, null);
            assert.deepStrictEqual(data.free_on, []);
            assert(data.why, 'the answer says why nothing can run it');
        });
    } finally { await t.close(); }
    done();
})().catch((err) => { console.error(err); process.exitCode = 1; });
