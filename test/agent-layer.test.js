'use strict';
/**
 * The agent layer: /.well-known/agent.json, the home's discovery <link> and Link header, and Markdown twins of the
 * new public pages rendered signed out. A chat has no twin and is a 404; the well-known prefix is not swallowed.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');

(async () => {
    const t = await boot({ ai: createFakeAi() });
    try {
        await check('manifest is JSON with only the endpoints Exchange really serves', async () => {
            const r = await t.get('/.well-known/agent.json');
            assert.strictEqual(r.status, 200);
            assert.match(r.headers.get('content-type'), /application\/json/);
            const m = r.json();
            assert.strictEqual(m.id, 'exchange');
            assert.strictEqual(m.home, 'https://openvibe.exchange');
            assert.strictEqual(m.api, 'https://api.openvibe.exchange/v1');
            assert.strictEqual(m.docs, 'https://openvibe.exchange/api');
            assert.deepStrictEqual(m.policy.auth, ['none', 'Network OIDC']);
            assert.strictEqual(m.openapi, undefined, 'the API document is AI’s, not this site’s');
        });

        await check('the home names its twin in the head and the Link header', async () => {
            const r = await t.get('/');
            assert.strictEqual(r.status, 200);
            assert.ok(r.text.includes('<link rel="alternate" type="text/markdown" href="https://openvibe.exchange/index.md">'));
            assert.ok(r.text.includes('<link rel="describedby" href="/llms.txt">'));
            assert.match(r.headers.get('link'), /https:\/\/openvibe\.exchange\/index\.md>; rel="alternate"; type="text\/markdown"/);
        });

        await check('/index.md is Markdown of the same home', async () => {
            const r = await t.get('/index.md');
            assert.strictEqual(r.status, 200);
            assert.match(r.headers.get('content-type'), /text\/markdown/);
            assert.ok(r.text.startsWith('---\ntitle:'));
            assert.ok(r.text.includes('Every AI model, one account.'));
            assert.ok(r.text.includes('DeepSeek Chat'));
        });

        await check('a model page has a twin; a chat and an unknown .md are 404', async () => {
            const r = await t.get('/m/deepseek/deepseek-chat.md');
            assert.strictEqual(r.status, 200);
            assert.ok(r.text.includes('# DeepSeek Chat'));
            assert.ok(r.text.includes('no training'));
            assert.strictEqual((await t.get('/chat.md')).status, 404);
            assert.strictEqual((await t.get('/no-such-page.md')).status, 404);
        });

        await check('/.well-known/security.txt is not swallowed by the layer', async () => {
            const r = await t.get('/.well-known/security.txt');
            assert.notStrictEqual(r.status, 200, 'the layer only takes agent.json');
        });
    } finally {
        await t.close();
        done();
    }
})();
