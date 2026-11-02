'use strict';
/**
 * The agent layer: /.well-known/agent.json, the home's discovery <link> and Link header, and Markdown twins of
 * the public pages rendered signed out. An unknown twin is a 404; the well-known prefix is not swallowed.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const fixtures = require('./helpers/fixtures');

(async () => {
    const t = await boot();
    const alice = t.network.addUser('alice');
    const listing = await fixtures.listed(t, alice, { title: 'A twin-tested template', summary: 'A template with a Markdown twin.' });
    try {
        await check('manifest is JSON with only the endpoints Exchange really serves', async () => {
            const r = await t.get('/.well-known/agent.json');
            assert.strictEqual(r.status, 200);
            assert.match(r.headers.get('content-type'), /application\/json/);
            const m = r.json();
            assert.strictEqual(m.id, 'exchange');
            assert.strictEqual(m.home, 'https://openvibe.exchange');
            assert.strictEqual(m.api, 'https://openvibe.exchange/api/v1');
            assert.strictEqual(m.docs, 'https://openvibe.exchange/developers');
            assert.deepStrictEqual(m.policy.auth, ['none', 'Network OIDC']);
            assert.strictEqual(m.openapi, undefined);
            assert.strictEqual(m.mcp, undefined);
        });

        await check('the home names its twin in the head and the Link header', async () => {
            const r = await t.get('/');
            assert.strictEqual(r.status, 200);
            assert.ok(r.text.includes('<link rel="alternate" type="text/markdown" href="https://openvibe.exchange/index.md">'));
            assert.ok(r.text.includes('<link rel="describedby" href="/llms.txt">'));
            assert.match(r.headers.get('link'), /https:\/\/openvibe\.exchange\/index\.md>; rel="alternate"; type="text\/markdown"/);
            assert.ok(r.text.includes('A twin-tested template'));
        });

        await check('/index.md is Markdown of the same home, and its listings', async () => {
            const r = await t.get('/index.md');
            assert.strictEqual(r.status, 200);
            assert.match(r.headers.get('content-type'), /text\/markdown/);
            assert.ok(r.text.startsWith('---\ntitle:'));
            assert.ok(r.text.includes('# OpenVibe.Exchange: Trade what people make.'));
            assert.ok(r.text.includes('A twin-tested template'));
        });

        await check('one listing twin is the public page, a signed-in-only page and an unknown .md are 404', async () => {
            const r = await t.get(`/listings/${listing.slug}.md`);
            assert.strictEqual(r.status, 200);
            assert.match(r.headers.get('content-type'), /text\/markdown/);
            assert.ok(r.text.includes('# A twin-tested template'), 'title heading');
            assert.ok(r.text.includes('CC0-1.0'), 'the licence from the same view');
            assert.ok(r.text.includes('A template with a Markdown twin.'), 'the summary');
            assert.ok(!r.text.includes('Run the sandbox'), 'a signed-out twin does not offer a sandbox run');
            assert.strictEqual((await t.get('/installs.md')).status, 404);
            assert.strictEqual((await t.get('/no-such-page.md')).status, 404);
        });

        await check('/.well-known/security.txt is not swallowed by the layer', async () => {
            const r = await t.get('/.well-known/security.txt');
            assert.strictEqual(r.status, 404);
            assert.doesNotMatch(r.headers.get('content-type') || '', /application\/json/);
        });
    } finally {
        await t.close();
        done();
    }
})();
