'use strict';

const assert = require('assert');
const express = require('express');
const { createServer } = require('http');
const { createConsoleRoutes, READS } = require('../server/http/console');

const calls = [];
const writes = [];
const fakeSecret = 'sk-provider-secret-must-never-render';
const app = express();
app.use((req, _res, next) => {
    const role = req.get('x-test-role');
    if (role) req.viewer = { kind: 'user', subject: 'usr_01JAB2C3D4E5F6G7H8J9K0MNPX', role, displayName: 'Owner' };
    next();
});
app.use(createConsoleRoutes({
    config: { baseUrl: 'https://openvibe.exchange' },
    ai: { async adminRequest(path, options = {}) { calls.push(path); if (options.method) writes.push({ path, ...options }); return { providers: [{ key: 'openai', status: 'active', api_key: fakeSecret }] }; } },
}));

(async () => {
    const server = createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        const consolePaths = ['/console', ...Object.keys(READS).map((section) => `/console/${section}`), '/console/providers/new', '/console/providers/openai', '/console/gpus/model-a/quote'];
        for (const path of consolePaths) for (const headers of [{}, { 'x-test-role': 'user' }, { 'x-test-role': 'admin' }]) {
            const response = await fetch(`${base}${path}`, { headers });
            assert.strictEqual(response.status, 404, `${path}: signed-out people and non-owners see no console route`);
        }
        const response = await fetch(`${base}/console/providers`, { headers: { 'x-test-role': 'owner' } });
        const html = await response.text();
        assert.strictEqual(response.status, 200, html);
        assert.ok(html.includes('AI operator console'));
        assert.ok(!html.includes(fakeSecret), 'admin JSON values that resemble secrets never reach page HTML');
        assert.deepStrictEqual(calls, [READS.providers]);
        for (const path of consolePaths) {
            const page = await fetch(`${base}${path}`, { headers: { 'x-test-role': 'owner' } });
            assert.strictEqual(page.status, 200, `${path}: ${await page.text()}`);
        }
        const keyWrite = await fetch(`${base}/console/providers/openai/key`, {
            method: 'POST', headers: { 'x-test-role': 'owner', Origin: 'https://openvibe.exchange', 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ api_key: fakeSecret }), redirect: 'manual',
        });
        const keyAnswer = await keyWrite.text();
        assert.strictEqual(keyWrite.status, 303);
        assert.ok(!keyAnswer.includes(fakeSecret), 'a provider key POST never echoes its value');
        assert.deepStrictEqual(writes[0], { path: '/api/v1/admin/console/providers/openai/key', method: 'POST', subject: 'usr_01JAB2C3D4E5F6G7H8J9K0MNPX', body: { api_key: fakeSecret } });

        const createProvider = await fetch(`${base}/console/providers`, {
            method: 'POST', headers: { 'x-test-role': 'owner', Origin: 'https://openvibe.exchange', 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ preset: 'custom', key: 'custom-one', base_url: 'https://api.example.test/v1', api_key: fakeSecret }), redirect: 'manual',
        });
        assert.strictEqual(createProvider.status, 303);
        assert.ok(writes.some((write) => write.path === '/api/v1/admin/console/providers' && write.body.api_key === fakeSecret), 'provider creation uses AI JSON admin API');

    } finally { await new Promise((resolve) => server.close(resolve)); }
    process.stdout.write('console-merge: owner gate and secret redaction passed\n');
})().catch((err) => { process.stderr.write(`${err.stack || err}\n`); process.exitCode = 1; });
