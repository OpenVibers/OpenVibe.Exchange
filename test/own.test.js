'use strict';
/**
 * Your own endpoint on OpenVibe.Exchange (the Exchange remake, build order 7): the page shows the plain
 * reason the feature is off, then (once it is on) the model / own-weights forms and the person's
 * endpoints. It never talks to a GPU itself: every call goes to AI with the person's own Network token.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');

(async () => {
    const ai = createFakeAi();
    const state = {
        status: { enabled: false, reason: 'The owner has not added a GPU provider key (Vast.ai or RunPod) yet, so no endpoint can start.', models: [], idle_minutes: 10, max_idle_minutes: 120, public_base: 'https://ai.openvibe.services/api/v1/own-endpoints' },
        endpoints: [], calls: [],
    };
    ai.gpuQuote = async (model, strategy) => { state.calls.push({ kind: 'quote', model, strategy }); return { dry_run: true, selected: { marketplace: 'vast', gpu_name: 'RTX 3090', region: 'US', price_per_hour: '0.20' }, reasons: ['objective cheapest'] }; };
    ai.ownStatus = async () => state.status;
    ai.ownList = async (token) => { state.calls.push({ kind: 'list', token }); return { endpoints: state.endpoints, status: state.status }; };
    ai.ownCreate = async (token, body) => { state.calls.push({ kind: 'create', token, body }); return { endpoint: { id: 'oep_TEST' } }; };
    ai.ownStop = async (token, id) => { state.calls.push({ kind: 'stop', token, id }); return { endpoint: { id, status: 'stopping' } }; };
    const t = await boot({ ai });
    try {
        await check('off: the reason is on the page, with no form', async () => {
            const r = await t.get('/own');
            assert.strictEqual(r.status, 200, r.text);
            assert.ok(r.text.includes('Your own endpoint'), 'the page title');
            assert.ok(r.text.includes('has not added a GPU provider key'), 'the plain reason');
            assert.ok(!r.text.includes('Start my endpoint'), 'no form while it is off');
            assert.ok(!r.text.includes('bring your own weights'), 'no weights form while it is off');
        });

        await check('on but signed out: it asks to sign in and names no private data', async () => {
            state.status = { enabled: true, models: [{ key: 'deepseek-r1-32b', display_name: 'DeepSeek R1 32B distill, Q4', vram_mb: 22000 }], idle_minutes: 10, max_idle_minutes: 120, public_base: 'https://ai.openvibe.services/api/v1/own-endpoints' };
            const r = await t.get('/own');
            assert.strictEqual(r.status, 200);
            assert.ok(r.text.includes('Sign in to start a private endpoint'));
            assert.ok(r.text.includes('DeepSeek R1 32B distill'), 'the model is named');
            assert.ok(!r.text.includes('Start my endpoint'), 'the submit is only for a signed-in person');
        });

        await check('quote works signed out, shows live price, and creates no rental', async () => {
            const r = await t.get('/own/quote?model=deepseek-r1-32b&strategy=cheapest');
            assert.strictEqual(r.status, 200, r.text);
            assert.ok(r.text.includes('0.20 per hour'));
            assert.ok(r.text.includes('Nothing was rented'));
            assert.ok(!state.calls.some(c => c.kind === 'create'));
        });

        const u = t.network.addUser('gpu-owner');
        await check('signed in: the model and own-weights forms, with the private promise', async () => {
            const r = await t.get('/own', { as: u });
            assert.strictEqual(r.status, 200, r.text);
            assert.ok(r.text.includes('Start my endpoint'));
            assert.ok(r.text.includes('bring your own weights'));
            assert.ok(r.text.includes('never listed as an offer'), 'says the endpoint is private');
            assert.ok(r.text.includes('scales to zero') || r.text.includes('idle'), 'says it scales to zero');
            assert.ok(r.text.includes('Your Balance pays'));
        });

        await check('create posts to AI with the person\'s own token and the chosen model', async () => {
            const r = await t.get('/own', { as: u, form: { model: 'deepseek-r1-32b', idle_minutes: '5', strategy: 'automatic' }, method: 'POST' });
            assert.strictEqual(r.status, 303, r.text);
            assert.strictEqual(r.headers.get('location'), '/own');
            const call = state.calls.find((c) => c.kind === 'create');
            assert.ok(call, 'AI was asked to create it');
            assert.ok(call.token, 'with the person\'s token, never the service token');
            assert.deepStrictEqual(call.body, { model: 'deepseek-r1-32b', idle_minutes: 5, strategy: 'automatic' });
        });

        await check('own weights are passed as a weights object', async () => {
            state.calls.length = 0;
            const r = await t.get('/own', { as: u, form: { weights_repo: 'someone/My-GGUF', weights_file: 'm.gguf', lora_repo: 'someone/lora', lora_file: 'adapter.gguf', display_name: 'Mine' }, method: 'POST' });
            assert.strictEqual(r.status, 303, r.text);
            const call = state.calls.find((c) => c.kind === 'create');
            assert.deepStrictEqual(call.body.weights, { repo: 'someone/My-GGUF', file: 'm.gguf', lora_repo: 'someone/lora', lora_file: 'adapter.gguf' });
            assert.strictEqual(call.body.display_name, 'Mine');
        });

        await check('the list shows the URL and a stop button; stop posts to AI', async () => {
            state.endpoints = [{
                id: 'oep_01JAB2C3D4E5F6G7H8J9K0MNPQ', status: 'running', display_name: 'DeepSeek R1 32B distill, Q4',
                idle_minutes: 5, price_per_hour: '0.1348', charged_nano: '2246667', url: 'https://ai.openvibe.services/api/v1/own-endpoints/oep_01JAB2C3D4E5F6G7H8J9K0MNPQ/v1',
            }];
            state.calls.length = 0;
            const r = await t.get('/own', { as: u });
            assert.ok(r.text.includes('https://ai.openvibe.services/api/v1/own-endpoints/oep_01JAB2C3D4E5F6G7H8J9K0MNPQ/v1'), 'the endpoint URL');
            assert.ok(r.text.includes('$0.13 an hour'), 'the price');
            assert.ok(r.text.includes('/own/oep_01JAB2C3D4E5F6G7H8J9K0MNPQ/stop'), 'the stop form');
            const stopped = await t.get('/own/oep_01JAB2C3D4E5F6G7H8J9K0MNPQ/stop', { as: u, method: 'POST' });
            assert.strictEqual(stopped.status, 303);
            assert.ok(state.calls.some((c) => c.kind === 'stop' && c.id === 'oep_01JAB2C3D4E5F6G7H8J9K0MNPQ'));
        });

        await check('a cross-site post is refused before AI is called', async () => {
            state.calls.length = 0;
            const r = await t.get('/own', { as: u, form: { model: 'deepseek-r1-32b' }, method: 'POST', origin: 'https://evil.example' });
            assert.strictEqual(r.status, 403);
            assert.ok(!state.calls.some((c) => c.kind === 'create'));
        });

        await check('AI unreachable: the page says so and does not invent a reason', async () => {
            ai.ownStatus = async () => { throw Object.assign(new Error('down'), { code: 'ai.unavailable' }); };
            const r = await t.get('/own');
            assert.strictEqual(r.status, 200);
            assert.ok(r.text.includes('not reachable right now'));
        });
    } finally {
        await t.close();
        done();
    }
})().catch((err) => { console.error(err); process.exit(1); });
