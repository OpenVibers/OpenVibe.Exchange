'use strict';
// Exchange tells AI who the person is AND where they are (2026-11-16, the gaps log: AI judges a person's trust tier by
// their network, and Exchange's own server is a hosting address, so every person on Exchange was "new"). AI takes
// X-OV-Client-IP from a first-party service only (exchange is one by default); Exchange sends the person's own address,
// a single well-formed one, never a forwarded list, and never its own loopback.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createAi, clientIpHeader } = require('../server/ai');

assert.deepStrictEqual(clientIpHeader('203.0.113.7'), { 'X-OV-Client-IP': '203.0.113.7' });
assert.deepStrictEqual(clientIpHeader('::ffff:203.0.113.7'), { 'X-OV-Client-IP': '203.0.113.7' }, 'an IPv4-mapped address, as IPv4');
assert.deepStrictEqual(clientIpHeader('2001:db8::1'), { 'X-OV-Client-IP': '2001:db8::1' });
for (const not of [null, '', '127.0.0.1', '::1', '203.0.113.7, 10.0.0.1', 'evil<script>', 'a'.repeat(60)]) assert.deepStrictEqual(clientIpHeader(not), {}, `nothing sent for ${not}`);

(async () => {
    const seen = [];
    const fetchImpl = async (url, init = {}) => {
        const u = String(url);
        if (u.endsWith('/oauth/token')) return new Response(JSON.stringify({ access_token: 'svc', expires_in: 300, token_type: 'Bearer' }), { status: 200, headers: { 'content-type': 'application/json' } });
        seen.push({ url: u, headers: init.headers || {} });
        return new Response(JSON.stringify({ run: { id: 'run_1', status: 'succeeded', output: { text: 'hi' }, usage: {}, provenance: {} } }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const config = { ai: { url: 'http://ai.test', timeoutMs: 30_000, waitMs: 1000, audience: 'ai', scope: '' }, oauth: { clientId: 'exchange', clientSecret: 's' }, networkInternalUrl: 'http://network.test' };
    const ai = createAi({ config, fetchImpl, log: { warn() {} } });
    await ai.chat({ model: 'openvibe/auto', messages: [{ role: 'user', content: 'hi' }], subject: 'usr_1', clientIp: '198.51.100.23' }).catch(() => null);
    const run = seen.find((s) => s.url.includes('/api/v1/runs'));
    assert.ok(run, 'the run was asked for');
    assert.strictEqual(run.headers['X-OV-Client-IP'], '198.51.100.23', 'the person\'s address goes with the run');
    await ai.chat({ model: 'openvibe/auto', messages: [{ role: 'user', content: 'hi' }], subject: 'usr_1' }).catch(() => null);
    assert.ok(!('X-OV-Client-IP' in seen[seen.length - 1].headers), 'none when there is none to send');

    // Every person's chat on Exchange's pages sends it.
    const src = ['pages.js', 'arena.js'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'server', 'http', f), 'utf8')).join('\n');
    const calls = src.match(/ai\.chat\(\{[\s\S]*?\}\)/g) || [];
    assert.ok(calls.length >= 4, `the page calls are found (${calls.length})`);
    calls.forEach((c) => assert.match(c, /clientIp: req\.ip/, `a chat call sends the person's address: ${c.slice(0, 80)}`));
    console.log('ai-client-ip: Exchange sends the person\'s address with their runs');
})().catch((e) => { console.error(e); process.exit(1); });
