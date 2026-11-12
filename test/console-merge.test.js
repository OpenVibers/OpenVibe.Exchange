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
    ai: { async adminRequest(path, options = {}) {
        calls.push(path); if (options.method) writes.push({ path, ...options });
        if (path === '/api/v1/admin/console/pricebook') return { confirmed: [{ provider_key: 'sable', model_key: 'deepseek-v4.1-flash-1017-uncensored', in_per_mtok: 0.15, out_per_mtok: 0.6, source: 'https://sableapi.com/models', checked_at: '2026-11-10' }] };
        if (path === '/api/v1/admin/console/gpu-policy') return {
            global: { quote_only: true, monthly_cap_nano: '50000000000', interactive_cap_nano: '20000000000', batch_cap_nano: '30000000000' },
            providers: [
                { key: 'vast', enabled: true, configured: true, order: 3, classes: ['interactive', 'batch'], interruptible_allowed: true, max_hourly_nano: '500000000', max_replicas: 2, regions: ['US'], monthly_cap_share_percent: 40, key_state: { present: true, last_four: '4321' } },
                { key: 'salad', enabled: false, configured: false, order: 50, classes: ['batch'], interruptible_allowed: false, max_replicas: 3, regions: [], monthly_cap_share_percent: 100, key_state: { present: false } },
            ],
        };
        if (path === '/api/v1/admin/console/gpus') return { state: { enabled: true, reason: '', dry_run: true, cap_nano: '50000000000', spent_nano: '1000000000', committed_nano: '2000000000', by_class: { interactive: '1000000000' }, instances: [] } };
        if (path === '/api/v1/admin/console/provider-credit-plans' && options.body && options.body.label === 'fail') throw Object.assign(new Error('provider credit plans are not configured'), { status: 503 });
        if (path === '/api/v1/admin/console/providers') return {
            providers: [{ key: 'openai', status: 'active', api_key: fakeSecret }],
            credit_estimates: [
                { provider: 'openai', plans: [{ id: 7, label: 'ChatGPT Pro API credits', monthly_usd: 100, renews_day: 1, starts_on: '2026-11-12', ends_on: null, active: true, notes: 'API credits' }],
                    estimate: { plans: [{ applies_to: 'plan:7:2026-11-01', amount_usd: 100, used_usd: 25, remaining_usd: 75, expires_at: '2026-12-01T00:00:00.000Z' }] } },
                { provider: 'altare', plans: [{ id: 8, label: 'Altare free monthly credits', monthly_usd: 100, renews_day: 1, starts_on: '2026-12-01', ends_on: null, active: false, notes: null }],
                    estimate: { plans: [] } },
            ],
        };
        return { providers: [{ key: 'openai', status: 'active', api_key: fakeSecret }] };
    } },
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
        assert.ok(html.includes('Monthly credits from a plan') && html.includes('action="/console/provider-credit-plans"'), 'the plan form is in the providers section');
        assert.ok(html.includes('name="monthly_usd"') && html.includes('name="renews_day"') && html.includes('name="starts_on"') && html.includes('name="ends_on"'), 'a plan records its amount and its cycle');
        assert.ok(html.includes('name="prorate_first" type="checkbox" value="1" checked'), 'the first month is prorated by default');
        assert.ok(html.includes('ChatGPT Pro API credits') && html.includes('$100.00 a month') && html.includes('renews on day 1'), 'a recorded plan shows its label, amount and renewal day');
        assert.ok(html.includes('$75.00 left this cycle') && html.includes('ends 2026-12-01'), 'the cycle remaining comes from the estimate');
        assert.ok(html.includes('action="/console/provider-credit-plans/7"') && html.includes('role="switch"'), 'a plan has its own on/off switch');
        assert.ok(html.includes('No credit for this cycle yet.'), 'a plan with no cycle yet says so');
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
        for (const role of ['user', 'global_mod', 'admin']) {
            const count = writes.length;
            const deniedOrder = await fetch(`${base}/console/orders/chat`, { method: 'POST', headers: { 'x-test-role': role, Origin: 'https://openvibe.exchange' } });
            assert.strictEqual(deniedOrder.status, 403);
            for (const path of ['/console/gpu-policy/vast', '/console/gpu-policy/vast/key']) {
                const denied = await fetch(`${base}${path}`, { method: 'POST', headers: { 'x-test-role': role, Origin: 'https://openvibe.exchange' } });
                assert.strictEqual(denied.status, 403, `${role} cannot change GPU policy`);
            }
            assert.strictEqual(writes.length, count);
        }
        const orderCsrf = await fetch(`${base}/console/orders/chat`, { method: 'POST', headers: { 'x-test-role': 'owner', Origin: 'https://evil.example' } });
        assert.strictEqual(orderCsrf.status, 403);
        const keyWrite = await fetch(`${base}/console/providers/openai/key`, {
            method: 'POST', headers: { 'x-test-role': 'owner', Origin: 'https://openvibe.exchange', 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ api_key: fakeSecret }), redirect: 'manual',
        });
        const keyAnswer = await keyWrite.text();
        assert.strictEqual(keyWrite.status, 303);
        assert.ok(!keyAnswer.includes(fakeSecret), 'a provider key POST never echoes its value');
        assert.deepStrictEqual(writes[0], { path: '/api/v1/admin/console/providers/openai/key', method: 'POST', subject: 'usr_01JAB2C3D4E5F6G7H8J9K0MNPX', body: { api_key: fakeSecret } });
        const orderWrite = await fetch(`${base}/console/orders/chat`, {
            method: 'POST', headers: { 'x-test-role': 'owner', Origin: 'https://openvibe.exchange', 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ enabled: '1', choices: '[{"provider":"openai","model":"m"}]' }), redirect: 'manual',
        });
        assert.strictEqual(orderWrite.status, 303);
        assert.deepStrictEqual(writes.at(-1).body, { enabled: true, choices: [{ provider: 'openai', model: 'm' }] });
        const orderHtml = require('../server/views/console').consolePage({ section: 'orders', data: { orders: [{ capability: 'chat', enabled: true, choices: [{ provider: '<x>', model: 'm' }] }] } });
        assert.ok(orderHtml.includes('/console/orders/chat'));
        assert.ok(orderHtml.includes('&lt;x&gt;'));
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

        for (const role of ['user', 'admin']) {
            const count = writes.length;
            for (const path of ['/console/provider-credit-plans', '/console/provider-credit-plans/7']) {
                const denied = await fetch(`${base}${path}`, { method: 'POST', headers: { 'x-test-role': role, Origin: 'https://openvibe.exchange' } });
                assert.strictEqual(denied.status, 403, `${role} cannot record a provider credit plan`);
            }
            assert.strictEqual(writes.length, count, 'non-owners cannot reach the AI service');
        }
        const planCsrf = await fetch(`${base}/console/provider-credit-plans`, { method: 'POST', headers: { 'x-test-role': 'owner', Origin: 'https://evil.example' } });
        assert.strictEqual(planCsrf.status, 403);
        const planWrite = await fetch(`${base}/console/provider-credit-plans`, {
            method: 'POST', headers: { 'x-test-role': 'owner', Origin: 'https://openvibe.exchange', 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ provider: 'openai', label: 'ChatGPT Pro API credits', monthly_usd: '100', renews_day: '1', starts_on: '2026-11-12', ends_on: '', prorate_first: '1', notes: 'API credits' }),
            redirect: 'manual',
        });
        assert.strictEqual(planWrite.status, 303);
        assert.strictEqual(planWrite.headers.get('location'), '/console/providers');
        assert.deepStrictEqual(writes.at(-1), { path: '/api/v1/admin/console/provider-credit-plans', method: 'POST', subject: 'usr_01JAB2C3D4E5F6G7H8J9K0MNPX', body: {
            provider: 'openai', label: 'ChatGPT Pro API credits', monthly_usd: 100, renews_day: 1, starts_on: '2026-11-12', ends_on: null, prorate_first: true, notes: 'API credits',
        } });
        const planOn = await fetch(`${base}/console/provider-credit-plans/7`, {
            method: 'POST', headers: { 'x-test-role': 'owner', Origin: 'https://openvibe.exchange', 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ active: '1' }), redirect: 'manual',
        });
        assert.strictEqual(planOn.status, 303);
        assert.deepStrictEqual(writes.at(-1), { path: '/api/v1/admin/console/provider-credit-plans/7', method: 'POST', subject: 'usr_01JAB2C3D4E5F6G7H8J9K0MNPX', body: { active: true } });
        const planOff = await fetch(`${base}/console/provider-credit-plans/7`, {
            method: 'POST', headers: { 'x-test-role': 'owner', Origin: 'https://openvibe.exchange', 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({}), redirect: 'manual',
        });
        assert.strictEqual(planOff.status, 303);
        assert.deepStrictEqual(writes.at(-1).body, { active: false }, 'an unchecked switch turns the plan off');
        const planError = await fetch(`${base}/console/provider-credit-plans`, {
            method: 'POST', headers: { 'x-test-role': 'owner', Origin: 'https://openvibe.exchange', 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ provider: 'openai', label: 'fail', monthly_usd: '100', renews_day: '1', starts_on: '2026-11-12' }),
        });
        const planErrorHtml = await planError.text();
        assert.strictEqual(planError.status, 502);
        assert.ok(planErrorHtml.includes('provider credit plans are not configured'), 'the AI error is shown on the page');
        const loadConfirmed = await fetch(`${base}/console/pricebook/confirmed`, {
            method: 'POST', headers: { 'x-test-role': 'owner', Origin: 'https://openvibe.exchange' }, redirect: 'manual',
        });
        assert.strictEqual(loadConfirmed.status, 303);
        assert.strictEqual(writes.at(-1).path, '/api/v1/admin/console/pricebook/proposals');
        assert.strictEqual(writes.at(-1).body.proposals.length, 1);
        assert.strictEqual(writes.at(-1).body.proposals[0].provider_key, 'sable');
        const modelOpen = await fetch(`${base}/console/models/groq/openai%2Fgpt-oss-120b/open`, {
            method: 'POST', headers: { 'x-test-role': 'owner', Origin: 'https://openvibe.exchange' }, redirect: 'manual',
        });
        assert.strictEqual(modelOpen.status, 303);
        assert.strictEqual(writes.at(-1).path, '/api/v1/admin/console/models/groq/openai%2Fgpt-oss-120b/open');
        assert.strictEqual(writes.at(-1).method, 'POST');
        const supplyConfirm = await fetch(`${base}/console/supply`, {
            method: 'POST', headers: { 'x-test-role': 'owner', Origin: 'https://openvibe.exchange', 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ model: 'm', runtime: 'vllm', input_per_million: '1', output_per_million: '2', hourly_ceiling_usd: '1',
                monthly_ceiling_usd: '100', required_vram_mb: '24000', idle_minutes: '10', enabled: '1' }),
        });
        assert.strictEqual(supplyConfirm.status, 422, 'live supply needs the typed confirmation');
        const beforeSupply = writes.length;
        const supplyOn = await fetch(`${base}/console/supply`, {
            method: 'POST', headers: { 'x-test-role': 'owner', Origin: 'https://openvibe.exchange', 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ model: 'm', runtime: 'vllm', input_per_million: '1', output_per_million: '2', hourly_ceiling_usd: '1',
                monthly_ceiling_usd: '100', required_vram_mb: '24000', idle_minutes: '10', enabled: '1', confirm: 'open' }), redirect: 'manual',
        });
        assert.strictEqual(supplyOn.status, 303);
        assert.strictEqual(writes.length, beforeSupply + 1);
        assert.strictEqual(writes.at(-1).path, '/api/v1/admin/console/supply');
        assert.strictEqual(writes.at(-1).body.enabled, true);
        const supplyOff = await fetch(`${base}/console/supply`, {
            method: 'POST', headers: { 'x-test-role': 'owner', Origin: 'https://openvibe.exchange', 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ model: 'm', runtime: 'vllm', input_per_million: '1', output_per_million: '2', hourly_ceiling_usd: '1',
                monthly_ceiling_usd: '100', required_vram_mb: '24000', idle_minutes: '10', enabled: '0' }), redirect: 'manual',
        });
        assert.strictEqual(supplyOff.status, 303);
        assert.strictEqual(writes.at(-1).body.enabled, false);
        const gpuPolicy = await fetch(`${base}/console/gpu-policy/vast`, {
            method: 'POST', headers: { 'x-test-role': 'owner', Origin: 'https://openvibe.exchange', 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ enabled: '1', classes: 'batch', max_hourly_nano: '500000000', order: '2' }), redirect: 'manual',
        });
        assert.strictEqual(gpuPolicy.status, 303);
        assert.deepStrictEqual(writes.at(-1), { path: '/api/v1/admin/console/gpu-policy/vast', method: 'POST',
            subject: 'usr_01JAB2C3D4E5F6G7H8J9K0MNPX', role: 'owner', body: { enabled: true, order: 2, max_hourly_nano: '500000000', classes: ['batch'] } });
        const gpuKey = await fetch(`${base}/console/gpu-policy/vast/key`, {
            method: 'POST', headers: { 'x-test-role': 'owner', Origin: 'https://openvibe.exchange', 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ api_key: fakeSecret }), redirect: 'manual',
        });
        assert.strictEqual(gpuKey.status, 303);
        assert.strictEqual(writes.at(-1).path, '/api/v1/admin/console/gpu-policy/vast/key');
        assert.strictEqual(writes.at(-1).role, 'owner');
        const modelOverride = await fetch(`${base}/console/models/groq/openai%2Fgpt-oss-120b/override`, {
            method: 'POST', headers: { 'x-test-role': 'owner', Origin: 'https://openvibe.exchange', 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ input_per_million: '0.2', cached_per_million: '', output_per_million: '0.7', reason: 'Owner approved adjustment' }), redirect: 'manual',
        });
        assert.strictEqual(modelOverride.status, 303);
        assert.ok(writes.some((write) => write.path === '/api/v1/models/groq/openai%2Fgpt-oss-120b' && write.body.owner_override.reason === 'Owner approved adjustment'));
        // The GPU supply page carries the provider policy and the class caps as data with forms.
        const supplyPage = await fetch(`${base}/console/supply`, { headers: { 'x-test-role': 'owner' } });
        const supplyHtml = await supplyPage.text();
        assert.strictEqual(supplyPage.status, 200, supplyHtml);
        assert.ok(supplyHtml.includes('GPU providers and job classes'), 'the policy section is on the GPU supply page');
        assert.ok(supplyHtml.includes('/console/gpu-policy/vast'), 'each provider has its form');
        assert.ok(supplyHtml.includes('Key ends 4321'), 'the key shows its last four only');
        assert.ok(supplyHtml.includes('Batch cap (USD)'), 'the owner sets the class caps');
        assert.ok(supplyHtml.includes('Class routing and caps'), 'the class routing is data on the page');
        assert.ok(!supplyHtml.includes(fakeSecret), 'no provider key reaches the page');
        // The USD forms become the exact nano values AI stores; options are JSON.
        const policyUsd = await fetch(`${base}/console/gpu-policy/vast`, {
            method: 'POST', headers: { 'x-test-role': 'owner', Origin: 'https://openvibe.exchange', 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ enabled: '1', classes: ['batch', 'interactive'], max_hourly_usd: '0.50', max_replicas: '2',
                monthly_cap_share_percent: '40', regions: 'US, EU', options: '{"organization":"org","project":"proj"}' }), redirect: 'manual',
        });
        assert.strictEqual(policyUsd.status, 303);
        assert.deepStrictEqual(writes.at(-1).body, { enabled: true, max_replicas: 2, monthly_cap_share_percent: 40,
            max_hourly_nano: '500000000', classes: ['batch', 'interactive'], regions: ['US', 'EU'],
            options: { organization: 'org', project: 'proj' } });

    } finally { await new Promise((resolve) => server.close(resolve)); }
    process.stdout.write('console-merge: owner gate and secret redaction passed\n');
})().catch((err) => { process.stderr.write(`${err.stack || err}\n`); process.exitCode = 1; });
