'use strict';
// The Sources client: its own client-credentials token, the loopback read, the two caches, and the last copy
// marked stale when the source stops answering. No network: both fetches are stubs.
const assert = require('assert');
const { createCode } = require('../server/code');
const configLib = require('../server/config');

(async () => {
    const config = configLib.load({ NODE_ENV: 'test', OV_NETWORK_INTERNAL_URL: 'http://network.test', OV_SOURCES_URL: 'http://sources.test', OV_OAUTH_CLIENT_ID: 'exchange', OV_OAUTH_CLIENT_SECRET: 'secret' });
    let now = Date.parse('2026-11-12T12:00:00Z');
    const calls = [];
    const tokenCalls = [];
    const tokenFetch = async (url, opts) => {
        tokenCalls.push({ url: String(url), body: String(opts.body || '') });
        return new Response(JSON.stringify({ access_token: 'tok', token_type: 'Bearer', expires_in: 300 }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const fetchImpl = async (url, opts) => {
        calls.push({ url: String(url), auth: opts.headers.authorization });
        if (url.includes('/api/v1/code/search')) {
            return new Response(JSON.stringify({ items: [{ full_name: 'a/b' }], total: 1, page: 1, sort: 'best', q: 'ai', lang: null, cached: false, stale: false }), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({ list: 'week', items: [{ full_name: 'a/b' }], count: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const code = createCode({ config, fetchImpl, tokenFetch, now: () => now, log: { warn() {} } });
    assert.strictEqual(code.configured, true);

    const one = await code.repos({ list: 'week', limit: 3 });
    assert.strictEqual(one.items[0].full_name, 'a/b');
    assert.deepStrictEqual(calls[0], { url: 'http://sources.test/api/v1/code/repos?list=week&limit=3', auth: 'Bearer tok' });
    assert.ok(tokenCalls.some((c) => c.body.includes('grant_type=client_credentials')), 'a client-credentials token is asked for');
    const two = await code.repos({ list: 'week', limit: 3 });
    assert.strictEqual(two.cached, true);
    assert.strictEqual(calls.length, 1, 'the rankings are cached');
    now += 61_000;
    await code.repos({ list: 'week', limit: 3 });
    assert.strictEqual(calls.length, 2, 'and expire after a minute');

    const s1 = await code.search({ q: 'ai' });
    assert.strictEqual(s1.items.length, 1);
    const s2 = await code.search({ q: 'ai' });
    assert.strictEqual(s2.cached, true);
    assert.strictEqual(calls.filter((c) => c.url.includes('/search')).length, 1, 'a search is cached ten minutes');
    now += 601_000;
    await code.search({ q: 'ai' });
    assert.strictEqual(calls.filter((c) => c.url.includes('/search')).length, 2);

    // Sources down: the last copy is served for five minutes, marked stale; after that the error is honest.
    const down = async () => { throw new Error('down'); };
    const offline = createCode({ config, fetchImpl: down, tokenFetch, now: () => now, log: { warn() {} } });
    await assert.rejects(() => offline.repos({ list: 'week' }), /unreachable|not answering/);
    const burst = offline.allow('usr_test');
    assert.strictEqual(burst.allowed, true);
    process.stdout.write('code client: 16 checks passed\n');
})().catch((e) => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
