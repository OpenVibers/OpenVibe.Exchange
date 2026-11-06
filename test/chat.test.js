'use strict';
/**
 * /chat on the shared conversation UI: one model or three side by side, a system prompt and a temperature, the
 * history in the person's account, the daily allowance, the 18+ gate for an uncensored model, and one account's
 * chat never readable by another.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');

(async () => {
    const ai = createFakeAi();
    const t = await boot({ ai });
    const alice = t.network.addUser('alice');
    const bob = t.network.addUser('bob');
    try {
        const confirmed = await t.get('/uncensored/confirm', { as: alice, form: { adult: 'yes' } });
        assert.strictEqual(confirmed.status, 303, 'alice confirms 18+ for the comparison');

        await check('signed out, chat asks for a sign-in', async () => {
            const r = await t.get('/chat');
            assert.strictEqual(r.status, 401);
            assert.ok(r.text.includes('Sign in with OpenVibe'));
        });

        await check('the start page is the shared conversation UI with model chips', async () => {
            const r = await t.get('/chat/new', { as: alice });
            assert.strictEqual(r.status, 200, r.text);
            assert.ok(r.text.includes('/shared/thread.css') && r.text.includes('/shared/ov-thread.js'));
            assert.ok(r.text.includes('ovt-composer') && r.text.includes('ovk-sidebar'));
            assert.ok(r.text.includes('DeepSeek Chat') && r.text.includes('Llama 3 8B abliterated'), 'the model chips');
            assert.ok(r.text.includes('System prompt') && r.text.includes('Temperature'));
        });

        let chatUrl = null;
        await check('a message runs the chosen models side by side and stores the history', async () => {
            const r = await t.get('/chat/send', {
                as: alice,
                form: {
                    text: 'What is a mutex?',
                    'models_deepseek/deepseek-chat': '1',
                    'models_meta-llama/llama-3-8b-abliterated': '1',
                    system: 'Be brief.',
                    temperature: '0.4',
                },
            });
            assert.strictEqual(r.status, 303, r.text);
            chatUrl = r.headers.get('location');
            assert.match(chatUrl, /^\/chat\/exc_/);
            assert.strictEqual(ai.calls.length, 2, 'one run per model');
            assert.deepStrictEqual(ai.calls.map((c) => c.model).sort(), ['deepseek/deepseek-chat@v1', 'openvibe/auto'], 'the exact id where one exists');
            assert.ok(ai.calls.every((c) => c.subject === alice.subject), 'each run is on the person’s behalf');
            assert.strictEqual(ai.calls[0].temperature, 0.4);
            assert.strictEqual(ai.calls[0].messages[0].role, 'system');

            const page = await t.get(chatUrl, { as: alice });
            assert.strictEqual(page.status, 200);
            assert.ok(page.text.includes('What is a mutex?'));
            assert.ok(page.text.includes('An answer from deepseek/deepseek-chat@v1.'));
            assert.ok(page.text.includes('An answer from openvibe/auto.'));
            assert.match(page.headers.get('cache-control'), /private|no-store/);
        });

        await check('the next message carries the history, and a second model’s answers never bleed across', async () => {
            const before = ai.calls.length;
            const r = await t.get(`${chatUrl}/send`, {
                as: alice,
                form: { text: 'And a semaphore?', 'models_deepseek/deepseek-chat': '1', 'models_meta-llama/llama-3-8b-abliterated': '1' },
            });
            assert.strictEqual(r.status, 303);
            const fresh = ai.calls.slice(before);
            assert.strictEqual(fresh.length, 2);
            const deep = fresh.find((c) => c.model === 'deepseek/deepseek-chat@v1');
            assert.deepStrictEqual(deep.messages.map((m) => m.role), ['user', 'assistant', 'user'], 'its own answer is in the history');
            assert.strictEqual(deep.messages[1].content, 'An answer from deepseek/deepseek-chat@v1.');
        });

        await check('another account cannot read the chat', async () => {
            assert.strictEqual((await t.get(chatUrl, { as: bob })).status, 404);
            assert.strictEqual((await t.get('/chat', { as: bob })).status, 200, 'bob has his own start page');
        });

        await check('an uncensored model needs the 18+ confirmation first', async () => {
            const before = ai.calls.length;
            const r = await t.get('/chat/send', { as: bob, form: { text: 'Hello', 'models_meta-llama/llama-3-8b-abliterated': '1' } });
            assert.strictEqual(r.status, 403);
            assert.ok(r.text.includes('18 or over'));
            assert.strictEqual(ai.calls.length, before, 'no run happened');
            const confirm = await t.get('/uncensored/confirm', { as: bob, form: { adult: 'yes' } });
            assert.strictEqual(confirm.status, 303);
            const ok = await t.get('/chat/send', { as: bob, form: { text: 'Hello', 'models_meta-llama/llama-3-8b-abliterated': '1' } });
            assert.strictEqual(ok.status, 303);
        });

        await check('a cross-site send is refused', async () => {
            const r = await t.get('/chat/send', { as: alice, json: { text: 'hi' }, origin: 'https://evil.test' });
            assert.strictEqual(r.status, 403);
        });

        await check('a chat belongs to the person who made it, and can be deleted', async () => {
            const del = await t.get(`${chatUrl}/delete`, { as: alice, method: 'POST' });
            assert.strictEqual(del.status, 303);
            assert.strictEqual((await t.get(chatUrl, { as: alice })).status, 404);
        });
    } finally { await t.close(); }

    const capped = await boot({ ai: createFakeAi(), env: { EXCHANGE_CHAT_PER_DAY: '1' } });
    const carol = capped.network.addUser('carol');
    try {
        await check('the daily allowance stops at its number', async () => {
            const first = await capped.get('/chat/send', { as: carol, form: { text: 'one' } });
            assert.strictEqual(first.status, 303);
            const second = await capped.get('/chat/send', { as: carol, form: { text: 'two' } });
            assert.strictEqual(second.status, 429);
            assert.ok(second.text.includes('resets at midnight UTC'));
        });
    } finally { await capped.close(); }
    done();
})();
