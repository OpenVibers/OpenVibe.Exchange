'use strict';
/**
 * Private AI on OpenVibe.Exchange (the plan of 2026-11-06, "Product lines and features", item 2):
 *
 *   - the strict-privacy switch on a chat sends the private preset, and the answer's receipt carries the label;
 *   - when the router refuses (no private offer can answer) the person sees its plain message, nothing else;
 *   - a chat sealed with the person's Locker stores only the envelope: the database never sees a turn, the chat
 *     list shows a neutral title, and the page never renders the conversation;
 *   - the switch on the API page is the account's "default" preset in AI;
 *   - one account never reads or writes another's sealed chat.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');

const ENVELOPE = Buffer.alloc(96, 7).toString('base64');
const PLAINTEXT = 'a secret question about clocks';

function makeAi({ chat = null } = {}) {
    const base = createFakeAi();
    const answer = async (args) => {
        if (chat) return chat(args);
        const out = await base.chat(args);
        return {
            ...out,
            privacy: args.preset === 'private' ? 'private' : 'anonymized',
            privacy_detail: { label: args.preset === 'private' ? 'private' : 'anonymized', retention: args.preset === 'private' ? 'none' : 'limited', training: args.preset === 'private' ? false : null, known: true },
            preset: args.preset || null,
        };
    };
    const ai = createFakeAi({ chat: answer });
    ai.presets = [];
    ai.presetCalls = [];
    ai.presetsFor = async () => ai.presets;
    ai.setKeyPrivacy = async (subject, on) => {
        ai.presetCalls.push({ subject, on });
        ai.presets = on ? [{ name: 'default', scope: 'owner', policy: { data_policy: 'private', community: false } }] : [];
        return { on };
    };
    return ai;
}

(async () => {
    const ai = makeAi();
    const t = await boot({ ai });
    const alice = t.network.addUser('alice');
    const bob = t.network.addUser('bob');
    try {
        await check('the chat page carries the strict-privacy switch, off by default', async () => {
            const r = await t.get('/chat/new', { as: alice });
            assert.strictEqual(r.status, 200, r.text);
            assert.ok(r.text.includes('name="strict_privacy"') && r.text.includes('Strict privacy'), 'the switch is there');
            assert.ok(!/name="strict_privacy" value="1" checked/.test(r.text), 'off by default');
        });

        let strictChat = null;
        await check('strict privacy sends the private preset and the receipt carries the label', async () => {
            const r = await t.get('/chat/send', {
                as: alice,
                form: { text: 'Who keeps my prompt?', strict_privacy: '1', 'models_deepseek/deepseek-chat': '1' },
            });
            assert.strictEqual(r.status, 303, r.text);
            strictChat = r.headers.get('location');
            assert.strictEqual(ai.calls.length, 1);
            assert.strictEqual(ai.calls[0].preset, 'private', 'the run names the private preset');
            assert.strictEqual(ai.calls[0].subject, alice.subject);

            const chat = await t.ctx.chats.get(alice.subject, strictChat.split('/').pop());
            assert.strictEqual(chat.strict_privacy, true, 'the switch is remembered on the chat');

            const page = await t.get(strictChat, { as: alice });
            assert.strictEqual(page.status, 200);
            assert.ok(/name="strict_privacy" value="1" checked/.test(page.text), 'the switch stays on');
            assert.ok(page.text.includes('<dt>Privacy</dt>'), 'the receipt has the privacy row');
            assert.ok(page.text.includes('Preset'), 'and the preset it used');
        });

        await check('turning the switch off sends no preset', async () => {
            const before = ai.calls.length;
            const r = await t.get(`${strictChat}/send`, { as: alice, form: { text: 'And now?', 'models_deepseek/deepseek-chat': '1' } });
            assert.strictEqual(r.status, 303);
            assert.strictEqual(ai.calls.length, before + 1);
            assert.strictEqual(ai.calls[ai.calls.length - 1].preset, null);
            const chat = await t.ctx.chats.get(alice.subject, strictChat.split('/').pop());
            assert.strictEqual(chat.strict_privacy, false);
        });

        const refusing = makeAi({
            chat: async () => {
                const err = new Error('Strict privacy is on: no offer that keeps nothing and trains on nothing can answer right now. Nothing was sent to a provider that keeps or trains on your prompt, and the router does not fall back to one.');
                err.code = 'policy.privacy_unavailable';
                err.status = 503;
                throw err;
            },
        });
        const rt = await boot({ ai: refusing });
        const carol = rt.network.addUser('carol');
        try {
            await check('a strict refusal is shown as its plain message, never an answer', async () => {
                const r = await rt.get('/chat/send', { as: carol, form: { text: 'hi', strict_privacy: '1' } });
                assert.strictEqual(r.status, 303, r.text);
                const page = await rt.get(r.headers.get('location'), { as: carol });
                assert.strictEqual(page.status, 200);
                assert.ok(page.text.includes('Strict privacy is on'), 'the router’s own words');
                assert.ok(page.text.includes('does not fall back'), 'and why it refused');
                assert.ok(!page.text.includes('An answer from'), 'no model answered');
            });
        } finally { await rt.close(); }

        let sealedId = null;
        await check('a sealed chat is created from an envelope alone', async () => {
            const r = await t.get('/chat/sealed/new', { json: { envelope: ENVELOPE }, as: alice });
            assert.strictEqual(r.status, 201, r.text);
            sealedId = r.json().id;
            assert.match(sealedId, /^exc_/);
            assert.strictEqual(r.json().url, `/chat/${sealedId}`);
        });

        await check('the chat list shows the sealed title, and the page never renders the conversation', async () => {
            const list = await t.get('/chat', { as: alice });
            assert.strictEqual(list.status, 303, 'the first chat opens');
            const page = await t.get(`/chat/${sealedId}`, { as: alice });
            assert.strictEqual(page.status, 200);
            assert.ok(page.text.includes('id="ex-sealed"') && page.text.includes('data-sealed-form'), 'the shell');
            assert.ok(page.text.includes('ov-locker.js'), 'the Locker loads');
            assert.ok(!page.text.includes(PLAINTEXT));
            const dump = await t.dbDump();
            assert.ok(!dump.includes(PLAINTEXT), 'the database holds no plaintext of a sealed chat');
            assert.ok(dump.includes(ENVELOPE), 'it holds the envelope');
            const chat = await t.ctx.chats.get(alice.subject, sealedId);
            assert.strictEqual(chat.sealed, true);
            assert.strictEqual(chat.title, 'Sealed chat', 'a neutral title until the owner opens it');
        });

        await check('the envelope is readable and replaceable only by its owner', async () => {
            const got = await t.get(`/chat/${sealedId}/sealed`, { as: alice, headers: { accept: 'application/json' } });
            assert.strictEqual(got.status, 200, got.text);
            assert.strictEqual(got.json().envelope, ENVELOPE);
            const next = Buffer.alloc(120, 9).toString('base64');
            const put = await t.get(`/chat/${sealedId}/sealed`, { as: alice, method: 'PUT', json: { envelope: next } });
            assert.strictEqual(put.status, 200, put.text);
            assert.strictEqual((await t.get(`/chat/${sealedId}/sealed`, { as: alice })).json().envelope, next);
            // Another account: nothing, and it can neither read nor write it.
            assert.strictEqual((await t.get(`/chat/${sealedId}`, { as: bob })).status, 404);
            assert.strictEqual((await t.get(`/chat/${sealedId}/sealed`, { as: bob })).status, 404);
            assert.strictEqual((await t.get(`/chat/${sealedId}/sealed`, { as: bob, method: 'PUT', json: { envelope: ENVELOPE } })).status, 404);
        });

        await check('a sealed send runs the model and stores nothing', async () => {
            const before = ai.calls.length;
            const messages = [{ role: 'user', content: PLAINTEXT }];
            const r = await t.get(`/chat/${sealedId}/sealed/send`, { as: alice, json: { model: 'deepseek/deepseek-chat@v1', messages, strict_privacy: true } });
            assert.strictEqual(r.status, 200, r.text);
            assert.strictEqual(ai.calls.length, before + 1);
            assert.strictEqual(ai.calls[ai.calls.length - 1].preset, 'private');
            assert.deepStrictEqual(ai.calls[ai.calls.length - 1].messages, messages, 'the turn goes to the model');
            assert.ok(r.json().answer.content.includes('An answer from'));
            // Nothing of that turn is in the database: no message row, no plaintext anywhere.
            assert.strictEqual(Number(await t.ctx.s.db.value('SELECT COUNT(*)::int AS n FROM exchange_chat_messages WHERE chat_id = $1', [sealedId])), 0);
            const dump = await t.dbDump();
            assert.ok(!dump.includes(PLAINTEXT));
        });

        await check('the strict switch on the API page is the account’s default preset in AI', async () => {
            const page = await t.get('/api', { as: alice });
            assert.strictEqual(page.status, 200);
            assert.ok(page.text.includes('Strict privacy on my keys') && page.text.includes('action="/privacy/keys"'), 'the switch');
            const off = await t.get('/privacy/keys', { as: alice, form: { strict: '1' } });
            assert.strictEqual(off.status, 200);
            assert.deepStrictEqual(ai.presetCalls[ai.presetCalls.length - 1], { subject: alice.subject, on: true });
            const on = await t.get('/api', { as: alice });
            assert.ok(/name="strict" value="1" checked/.test(on.text), 'the switch reads back on');
            await t.get('/privacy/keys', { as: alice, method: 'POST', form: {} });
            assert.deepStrictEqual(ai.presetCalls[ai.presetCalls.length - 1], { subject: alice.subject, on: false });
        });
    } finally { await t.close(); }
    done();
})();
