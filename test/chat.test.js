'use strict';
/** Exchange's former chat redirects; Chat alone can export a signed-in person's history. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { serviceAuth } = require('openvibe-contracts');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');

(async () => {
    const t = await boot({ ai: createFakeAi() });
    const alice = t.network.addUser('alice');
    const bob = t.network.addUser('bob');
    const token = (caps) => {
        const now = Math.floor(Date.now() / 1000);
        return serviceAuth.signServiceToken({ iss: t.network.issuer(), sub: 'svc:chat', actor_type: 'service',
            aud: ['openvibe.exchange'], cap: caps, iat: now, exp: now + 300, jti: crypto.randomUUID() }, t.network.privatePem);
    };
    try {
        await check('every old chat path redirects to Vibe and carries selected models', async () => {
            for (const path of ['/chat', '/chat/new', '/chat/exc_old', '/chat/exc_old/send']) {
                const r = await t.get(path, { as: alice });
                assert.equal(r.status, 301, path);
                assert.equal(r.headers.get('location'), 'https://openvibe.chat/vibe');
            }
            const selected = await t.get('/chat?models=deepseek%2Fdeepseek-chat%2Cqwen%2Fqwen3-32b');
            assert.equal(selected.status, 301);
            assert.equal(selected.headers.get('location'), 'https://openvibe.chat/vibe?models=deepseek%2Fdeepseek-chat%2Cqwen%2Fqwen3-32b');
            const old = await t.get('/chat?models=deepseek%2Fdeepseek-chat%40v1');
            assert.equal(old.headers.get('location'), 'https://openvibe.chat/vibe?models=deepseek%2Fdeepseek-chat');
            const page = await t.get('/m/deepseek/deepseek-chat');
            assert.ok(page.text.includes('https://openvibe.chat/vibe?models=deepseek%2Fdeepseek-chat'));
        });
        await check('export requires Chat capability and contains only the named person’s unsealed chats', async () => {
            const mine = await t.ctx.chats.create({ owner: alice.subject, title: 'Alice history', models: ['deepseek/deepseek-chat'] });
            await t.ctx.chats.append(alice.subject, mine.id, { role: 'user', content: 'Hello' });
            await t.ctx.chats.append(alice.subject, mine.id, { role: 'assistant', model: 'deepseek/deepseek-chat', content: 'Hi' });
            const theirs = await t.ctx.chats.create({ owner: bob.subject, title: 'Bob history' });
            await t.ctx.chats.append(bob.subject, theirs.id, { role: 'user', content: 'Private' });
            await t.ctx.chats.create({ owner: alice.subject, title: 'Sealed', sealed: true });
            const path = '/internal/exchange/chat/export';
            assert.equal((await t.get(path, { bearer: token([]), headers: { 'x-ov-subject': alice.subject } })).status, 403);
            const out = await t.get(path, { bearer: token(['exchange.chat.export']), headers: { 'x-ov-subject': alice.subject } });
            assert.equal(out.status, 200, out.text);
            assert.equal(out.json().count, 1);
            assert.deepEqual(out.json().chats[0].messages.map((m) => m.content), ['Hello', 'Hi']);
            const other = await t.get(path, { bearer: token(['exchange.chat.export']), headers: { 'x-ov-subject': bob.subject } });
            assert.equal(other.json().count, 1);
            assert.equal(other.json().chats[0].title, 'Bob history');
        });
    } finally { await t.close(); done(); }
})().catch((err) => { console.error(err); process.exitCode = 1; });
