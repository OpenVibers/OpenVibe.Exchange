'use strict';
// A restarted Exchange starts warm (2026-11-15, the owner: "openvibe.exchange is failing to load": a deploy restarted
// Exchange while AI was restarting, and every page waited on AI). The last good catalogue, model directory, search
// engines, community offers and usage are kept on disk and read back at start, so the first page after a restart
// answers at once and refreshes behind it. The directory, the engines and the offers serve stale while they refresh,
// like the catalogue.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAi } = require('../server/ai');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exchange-warm-'));
const cacheFile = path.join(dir, 'data', 'ai-cache.json');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const answer = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body, headers: { get: () => 'application/json' } });
const config = (fetchTimeout) => ({ ai: { url: 'http://ai.test', timeoutMs: fetchTimeout, audience: 'ai', scope: '', cacheFile, keepMs: 20 }, oauth: {}, networkInternalUrl: 'http://network.test' });

(async () => {
    try {
        // The first process: AI answers; its answers are kept.
        const good = async (url) => {
            const u = String(url);
            if (u.includes('/exchange/catalog')) return answer({ count: 1, models: [{ slug: 'deepseek-flash', name: 'DeepSeek Flash', offers: [] }], families: [] });
            if (u.includes('/exchange/directory')) return answer({ models: [{ id: 'openrouter/x', name: 'X' }] });
            if (u.includes('/exchange/spotted')) return answer({ models: [] });
            if (u.includes('/search/engines')) return answer({ engines: [{ id: 'openvibe' }, { id: 'brave' }] });
            if (u.includes('/community/offers')) return answer({ offers: [{ id: 'pool' }] });
            return answer({});
        };
        const first = createAi({ config: config(30_000), fetchImpl: good, log: { warn() {} } });
        await first.catalog(); await first.directory(); await first.searchEngines(); await first.communityOffers();
        await pause(120);
        assert.ok(fs.existsSync(cacheFile), 'the answers are kept on disk');

        // The next process: AI does not answer at all. Every read answers at once from what was kept.
        let asked = 0;
        const hung = async (url, init) => { asked++; return new Promise((_, reject) => { if (init && init.signal) init.signal.addEventListener('abort', () => reject(new Error('aborted'))); }); };
        const second = createAi({ config: config(30_000), fetchImpl: hung, log: { warn() {} }, now: () => Date.now() + 10 * 60_000 });
        const t0 = Date.now();
        const [c, d, e, o] = await Promise.all([second.catalog(), second.directory(), second.searchEngines(), second.communityOffers()]);
        assert.ok(Date.now() - t0 < 300, `no wait for AI after a restart (${Date.now() - t0} ms)`);
        assert.strictEqual(c.models[0].slug, 'deepseek-flash');
        assert.strictEqual(d.models[0].id, 'openrouter/x');
        assert.deepStrictEqual(e.map((x) => x.id), ['openvibe', 'brave'], 'the engines, still a list');
        assert.strictEqual(o.offers[0].id, 'pool');
        assert.strictEqual(c.stale, true, 'an old answer says so');
        assert.ok(asked >= 1, 'and a refresh is on its way behind it');
        console.log('ai-warm-start: kept on disk, read back at start, every read at once while AI is down');
        process.exit(0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exit(1); });
