'use strict';
/** Exchange's chat storage is retained for export, and its browser routes have moved to Chat. */
const assert = require('node:assert/strict');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');

(async () => {
    const ai = createFakeAi();
    ai.presets = [];
    ai.presetCalls = [];
    ai.presetsFor = async () => ai.presets;
    ai.setKeyPrivacy = async (subject, on) => {
        ai.presetCalls.push({ subject, on });
        ai.presets = on ? [{ name: 'default', scope: 'owner', policy: { data_policy: 'private', community: false } }] : [];
        return { on };
    };
    const t = await boot({ ai });
    const alice = t.network.addUser('alice');
    try {
        await check('sealed chat browser routes redirect without writing an envelope', async () => {
            const r = await t.get('/chat/sealed/new', { as: alice, json: { envelope: Buffer.alloc(96, 7).toString('base64') } });
            assert.equal(r.status, 301);
            assert.equal(r.headers.get('location'), 'https://openvibe.chat/vibe');
            assert.equal((await t.ctx.chats.list(alice.subject)).length, 0);
        });
        await check('the strict switch on the API page remains the account default preset in AI', async () => {
            const page = await t.get('/api', { as: alice });
            assert.equal(page.status, 200);
            assert.ok(page.text.includes('Strict privacy on my keys'));
            const on = await t.get('/privacy/keys', { as: alice, form: { strict: '1' } });
            assert.equal(on.status, 200);
            assert.deepEqual(ai.presetCalls.at(-1), { subject: alice.subject, on: true });
            await t.get('/privacy/keys', { as: alice, method: 'POST', form: {} });
            assert.deepEqual(ai.presetCalls.at(-1), { subject: alice.subject, on: false });
        });
    } finally { await t.close(); done(); }
})().catch((err) => { console.error(err); process.exitCode = 1; });
