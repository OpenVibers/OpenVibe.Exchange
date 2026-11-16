'use strict';
// The last good AI answers live in the unit's StateDirectory (2026-11-16): under ProtectSystem=strict the code tree is
// read-only, so the old default (<cwd>/data/ai-cache.json) failed on every save, 3,250 warnings a day, and a restart
// never started warm. And a path that cannot be written warns once per ten minutes, not on every save.
//   node test/ai-cache-state-dir.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createAi } = require('../server/ai');

// The config is read in a child process: load() in production mode sets up process-wide state this file must not share.
const { execFileSync } = require('child_process');
const cacheFileFor = (env) => execFileSync(process.execPath, ['-e', "process.stdout.write(String(require('./server/config').load(JSON.parse(process.argv[1])).ai.cacheFile), () => process.exit(0))", JSON.stringify({ NODE_ENV: 'production', PORT: '4900', ...env })],
    { cwd: path.join(__dirname, '..'), encoding: 'utf8', timeout: 20000 });
assert.strictEqual(cacheFileFor({ STATE_DIRECTORY: '/var/lib/openvibe-exchange' }), '/var/lib/openvibe-exchange/ai-cache.json', 'the StateDirectory systemd gives the unit');
assert.strictEqual(cacheFileFor({ STATE_DIRECTORY: '/var/lib/a:/var/lib/b' }), '/var/lib/a/ai-cache.json', 'the first of several');
assert.strictEqual(cacheFileFor({ STATE_DIRECTORY: '/var/lib/a', EXCHANGE_AI_CACHE_FILE: '/x/y.json' }), '/x/y.json', 'the variable wins');

// The unit asks for it and names the file.
const unit = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'systemd', 'openvibe-exchange.service'), 'utf8');
assert.match(unit, /^StateDirectory=openvibe-exchange$/m);
assert.match(unit, /^Environment=EXCHANGE_AI_CACHE_FILE=\/var\/lib\/openvibe-exchange\/ai-cache\.json$/m);

// A cache path that cannot be written warns once, however many saves fail (a file where its folder should be).
const blocker = path.join(require('os').tmpdir(), `exchange-cache-blocker-${process.pid}`);
fs.writeFileSync(blocker, 'not a folder');
(async () => {
    const warnings = [];
    let t = 1_000_000;
    const answer = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body, headers: { get: () => 'application/json' } });
    const ai = createAi({
        config: { ai: { url: 'http://ai.test', timeoutMs: 1000, audience: 'ai', scope: '', cacheFile: path.join(blocker, 'data', 'ai-cache.json'), keepMs: 5 }, oauth: {}, networkInternalUrl: 'http://network.test' },
        fetchImpl: async () => answer({ count: 0, models: [], families: [] }),
        log: { warn: (m) => warnings.push(m), log() {}, error() {} },
        now: () => t,
    });
    for (let i = 0; i < 4; i++) {
        await ai.catalog();
        t += 60_000;   // past the catalog's freshness, so each read refreshes and saves again
        await new Promise((r) => setTimeout(r, 30));
    }
    const kept = warnings.filter((m) => /could not be kept/.test(m));
    assert.strictEqual(kept.length, 1, `one warning for four failed saves (${kept.length})`);
    console.log('ai-cache-state-dir: the cache lives in the StateDirectory; a failing path warns once per ten minutes');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
