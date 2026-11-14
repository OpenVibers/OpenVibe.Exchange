'use strict';
// The home and the models page never wait for AI once there is something to show (11-14: the home took 27 s whenever
// its 30-second catalogue cache had run out). A read past freshness answers with the last value at once and refreshes
// behind it, one fetch at a time; only the first read of a process waits; a failed refresh keeps the last value.
const assert = require('assert');
const { createAi } = require('../server/ai');

(async () => {
    let clock = 1_000_000;
    const calls = [];
    let release = null, slow = false, fail = false, version = 1;
    const fetchImpl = async (url) => {
        calls.push(String(url));
        if (slow) await new Promise((r) => { release = r; });
        if (fail) return { ok: false, status: 502, text: async () => '{}', json: async () => ({}) };
        const body = String(url).includes('/catalog') ? { count: 1, models: [{ slug: `m${version}`, name: `Model ${version}`, offers: [] }], families: [] } : { by_day: [], version };
        return { ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body, headers: { get: () => 'application/json' } };
    };
    const config = { ai: { url: 'http://ai.test', timeoutMs: 30_000, audience: 'ai', scope: '' }, oauth: {}, networkInternalUrl: 'http://network.test' };
    const ai = createAi({ config, fetchImpl, log: { warn() {} }, now: () => clock });

    // The first read waits (nothing to show yet).
    let c = await ai.catalog();
    assert.strictEqual(c.models[0].slug, 'm1');
    assert.strictEqual(calls.length, 1);
    // Fresh: no fetch.
    clock += 10_000; c = await ai.catalog();
    assert.strictEqual(calls.length, 1, 'a fresh value is served without asking AI');
    // Past freshness, with AI slow: the last value at once, one refresh behind it.
    clock += 60_000; slow = true; version = 2;
    const started = Date.now();
    c = await ai.catalog();
    assert.ok(Date.now() - started < 200, 'no wait for AI');
    assert.strictEqual(c.models[0].slug, 'm1', 'the last value');
    await ai.catalog(); await ai.catalog();
    assert.strictEqual(calls.length, 2, 'one refresh at a time, however many reads');
    release(); slow = false;
    await new Promise((r) => setTimeout(r, 20));
    c = await ai.catalog();
    assert.strictEqual(c.models[0].slug, 'm2', 'the refreshed value next');
    // A failed refresh keeps the last value; past five minutes it says stale.
    clock += 6 * 60_000; fail = true;
    c = await ai.catalog();
    assert.strictEqual(c.models[0].slug, 'm2'); assert.strictEqual(c.stale, true, 'old: marked stale');
    await new Promise((r) => setTimeout(r, 20));
    // Usage the same way.
    fail = false;
    const u1 = await ai.usage(7);
    clock += 120_000; slow = true;
    const t0 = Date.now(); const u2 = await ai.usage(7);
    assert.ok(Date.now() - t0 < 200 && u2.version === u1.version, 'usage: the last value at once');
    release(); slow = false;
    console.log('ai-serve-stale: ok');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
