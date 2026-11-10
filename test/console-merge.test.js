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
        const consolePaths = ['/console', ...Object.keys(READS).map((section) => `/console/${section}`), '/console/providers/new', '/console/providers/openai', '/console/providers/openai/models', '/console/gpus/model-a/quote', '/console/data/providers', '/console/data/models', '/console/data/pricebook'];
        for (const path of consolePaths) for (const headers of [{}, { 'x-test-role': 'user' }, { 'x-test-role': 'admin' }]) {
            const response = await fetch(`${base}${path}`, { headers });
            assert.strictEqual(response.status, headers['x-test-role'] ? 403 : 404, `${path}: signed-in non-owners are forbidden; signed-out people see no console route`);
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
        for (const section of ['providers', 'models', 'pricebook']) {
            const data = await fetch(`${base}/console/data/${section}`, { headers: { 'x-test-role': 'owner' } });
            assert.strictEqual(data.status, 200);
            assert.ok((data.headers.get('content-type') || '').includes('application/json'));
            assert.ok(!JSON.stringify(await data.json()).includes(fakeSecret), `${section} data omits key values`);
        }
        const keyWrite = await fetch(`${base}/console/providers/openai/key`, {
            method: 'POST', headers: { 'x-test-role': 'owner', Origin: 'https://openvibe.exchange', 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ api_key: fakeSecret }), redirect: 'manual',
        });
        const keyAnswer = await keyWrite.text();
        assert.strictEqual(keyWrite.status, 303);
        assert.ok(!keyAnswer.includes(fakeSecret), 'a provider key POST never echoes its value');
        assert.deepStrictEqual(writes[0], { path: '/api/v1/admin/console/providers/openai/key', method: 'POST', subject: 'usr_01JAB2C3D4E5F6G7H8J9K0MNPX', body: { api_key: fakeSecret } });
        for (const action of ['key', 'remove-key', 'check', 'sync', 'model-settings']) {
            for (const role of ['user', 'admin']) {
                const count = writes.length;
                const denied = await fetch(`${base}/console/providers/openai/${action}`, {
                    method: 'POST', headers: { 'x-test-role': role, Origin: 'https://openvibe.exchange' },
                });
                assert.strictEqual(denied.status, 403);
                assert.strictEqual(writes.length, count, 'non-owners cannot reach the AI service');
            }
            const csrf = await fetch(`${base}/console/providers/openai/${action}`, {
                method: 'POST', headers: { 'x-test-role': 'owner', Origin: 'https://evil.example' },
            });
            assert.strictEqual(csrf.status, 403);
        }
        for (const [action, method, endpoint] of [['check', 'POST', 'check'], ['remove-key', 'DELETE', 'key']]) {
            const count = writes.length;
            const result = await fetch(`${base}/console/providers/openai/${action}`, {
                method: 'POST', headers: { 'x-test-role': 'owner', Origin: 'https://openvibe.exchange' }, redirect: 'manual',
            });
            assert.strictEqual(result.status, 303);
            assert.strictEqual(writes.length, count + 1);
            assert.deepStrictEqual(writes.at(-1), { path: `/api/v1/admin/console/providers/openai/${endpoint}`, method, subject: 'usr_01JAB2C3D4E5F6G7H8J9K0MNPX' });
        }
        const sync = await fetch(`${base}/console/providers/openai/sync`, {
            method: 'POST', headers: { 'x-test-role': 'owner', Origin: 'https://openvibe.exchange' }, redirect: 'manual',
        });
        assert.strictEqual(sync.status, 303);
        assert.strictEqual(sync.headers.get('location'), '/console/providers/openai/models');
        assert.strictEqual(writes.at(-1).path, '/api/v1/admin/console/providers/openai/sync');
        const schedule = await fetch(`${base}/console/providers/openai/model-settings`, {
            method: 'POST', headers: { 'x-test-role': 'owner', Origin: 'https://openvibe.exchange', 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ auto_list_new_models: '1', model_sync_interval_minutes: '360' }), redirect: 'manual',
        });
        assert.strictEqual(schedule.status, 303);
        assert.deepStrictEqual(writes.at(-1).body, { auto_list_new_models: true, model_sync_interval_minutes: 360 });
        const modelSettings = await fetch(`${base}/console/models/openai/model-a/settings`, {
            method: 'POST', headers: { 'x-test-role': 'owner', Origin: 'https://openvibe.exchange', 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ display_name: 'Owner name', content_tier: 'uncensored' }), redirect: 'manual',
        });
        assert.strictEqual(modelSettings.status, 303);
        assert.deepStrictEqual(writes.at(-1).body, { display_name: 'Owner name', content_tier: 'uncensored' });

        const createProvider = await fetch(`${base}/console/providers`, {
            method: 'POST', headers: { 'x-test-role': 'owner', Origin: 'https://openvibe.exchange', 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ preset: 'custom', key: 'custom-one', base_url: 'https://api.example.test/v1', api_key: fakeSecret }), redirect: 'manual',
        });
        assert.strictEqual(createProvider.status, 303);
        assert.ok(writes.some((write) => write.path === '/api/v1/admin/console/providers' && write.body.api_key === fakeSecret), 'provider creation uses AI JSON admin API');

        const providerSettings = await fetch(`${base}/console/providers/groq/settings`, {
            method: 'POST', headers: { 'x-test-role': 'owner', Origin: 'https://openvibe.exchange', 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ status: 'active', provider_access: 'AUTHORIZED_WHOLESALE', preference_order: '7', markup_percent: '12.5', uncensored: '1' }), redirect: 'manual',
        });
        assert.strictEqual(providerSettings.status, 303);
        assert.ok(writes.some((write) => write.path === '/api/v1/providers/groq' && write.body.markup_percent === 12.5 && write.body.uncensored === true));
        const modelOverride = await fetch(`${base}/console/models/groq/openai%2Fgpt-oss-120b/override`, {
            method: 'POST', headers: { 'x-test-role': 'owner', Origin: 'https://openvibe.exchange', 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ input_per_million: '0.2', cached_per_million: '', output_per_million: '0.7', reason: 'Owner approved adjustment' }), redirect: 'manual',
        });
        assert.strictEqual(modelOverride.status, 303);
        assert.ok(writes.some((write) => write.path === '/api/v1/models/groq/openai%2Fgpt-oss-120b' && write.body.owner_override.reason === 'Owner approved adjustment'));

    } finally { await new Promise((resolve) => server.close(resolve)); }
    process.stdout.write('console-merge: owner gate and secret redaction passed\n');
})().catch((err) => { process.stderr.write(`${err.stack || err}\n`); process.exitCode = 1; });
