'use strict';

const assert = require('assert');
const express = require('express');
const { createServer } = require('http');
const { createPageRoutes } = require('../server/http/pages');

const secret = 'sk-cookie-secret-never-rendered';
const calls = [];
const app = express();
app.use((req, _res, next) => {
    req.viewer = req.get('x-person') === 'alice'
        ? { kind: 'user', subject: 'usr_alice', token: 'alice-session' }
        : { kind: 'anonymous' };
    next();
});
app.use(createPageRoutes({
    config: { baseUrl: 'http://localhost' },
    ai: {
        credentialsFor(token) {
            calls.push(token);
            return {
                async list() { return { credentials: [
                    { id: 'cred_alice', kind: 'session_cookie', provider: 'anthropic', created: '2026-11-08', cookie: secret },
                    { id: 'key_alice', kind: 'api_key', provider: 'openai', hint: '1234', key: secret },
                ] }; },
                async add(body) { calls.push(body); return {}; },
                async remove(id) { calls.push(id); return {}; },
                async balance(id) { calls.push(id); return { balance: { available_usd: 12 } }; },
            };
        },
    },
    network: {}, history: { async capture() {} }, openapi: async () => ({ doc: {} }),
    chats: {}, adult: {}, sharing: {}, log: console,
}));

(async () => {
    const server = createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        const guest = await fetch(`${base}/privacy/keys`, { redirect: 'manual' });
        assert.strictEqual(guest.status, 303, 'signed-out people are sent to Exchange sign-in');
        const page = await fetch(`${base}/privacy/keys`, { headers: { 'x-person': 'alice' } });
        const html = await page.text();
        assert.strictEqual(page.status, 200);
        assert.ok(html.includes('Your keys and accounts') && html.includes('Browser session cookie') && html.includes('openai'));
        assert.ok(!html.includes(secret), 'only metadata renders; saved key and cookie values stay private');

        const add = await fetch(`${base}/privacy/credentials`, {
            method: 'POST', headers: { 'x-person': 'alice', Origin: 'http://localhost', 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ kind: 'session_cookie', provider: 'anthropic', cookie: secret, org_id: 'org-123' }), redirect: 'manual',
        });
        assert.strictEqual(add.status, 303);
        assert.ok(!(await add.text()).includes(secret), 'save never echoes the cookie');
        assert.ok(calls.some((value) => value && value.kind === 'session_cookie' && value.cookie === secret));

        const remove = await fetch(`${base}/privacy/credentials/cred_alice/remove`, {
            method: 'POST', headers: { 'x-person': 'alice', Origin: 'http://localhost', 'content-type': 'application/x-www-form-urlencoded' }, body: '', redirect: 'manual',
        });
        assert.strictEqual(remove.status, 303);
        assert.ok(calls.includes('cred_alice'));
        const balance = await fetch(`${base}/privacy/credentials/cred_alice/balance`, {
            method: 'POST', headers: { 'x-person': 'alice', Origin: 'http://localhost', 'content-type': 'application/x-www-form-urlencoded' }, body: '',
        });
        assert.strictEqual(balance.status, 200);
        assert.ok((await balance.text()).includes('12'));
        assert.ok(calls.filter((value) => value === 'alice-session').length >= 4, 'each operation uses the signed-in person token');
    } finally { await new Promise((resolve) => server.close(resolve)); }
    process.stdout.write('credentials-settings: owner metadata, cookie CRUD and balance passed\n');
})().catch((err) => { process.stderr.write(`${err.stack || err}\n`); process.exitCode = 1; });
