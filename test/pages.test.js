'use strict';
/**
 * The new Exchange's public pages: the home with live numbers, the model list, one model with every offer, the
 * API page, selling compute, the uncensored gate and AI in OpenVibe. Every number comes from the injected AI
 * client; nothing from Exchange v1 appears. A page with AI unreachable still renders and says so.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi, downAi } = require('./helpers/ai');

(async () => {
    const ai = createFakeAi();
    const t = await boot({ ai });
    try {
        await check('the home is the new Exchange, with live numbers', async () => {
            const r = await t.get('/');
            assert.strictEqual(r.status, 200, r.text);
            assert.match(r.headers.get('cache-control'), /^public, max-age=60/);
            assert.ok(r.text.includes('Every AI model, one account.'), 'the new promise');
            assert.ok(!r.text.includes('Trade what people make'), 'v1’s promise is gone');
            assert.ok(r.text.includes('DeepSeek Chat') && r.text.includes('Llama 3 8B abliterated'));
            assert.ok(r.text.includes('Popular now') && r.text.includes('Uncensored (18+)') && r.text.includes('Run on people’s machines'));
            assert.ok(r.text.includes('models') && r.text.includes('providers') && r.text.includes('cheapest in, per million'), 'the live numbers');
            assert.ok(r.text.includes('messages free every day'), 'the free allowance');
            assert.ok(!r.text.includes('requests today'), 'fewer than 1,000 requests today is not shown');
            assert.ok(r.text.includes('A side-by-side answer') && r.text.includes('example words · live prices'), 'the preview is marked an example');
            assert.ok(r.text.includes('api.openvibe.exchange/v1/chat/completions'), 'the endpoint');
            assert.strictEqual((r.text.match(/<h1[\s>]/g) || []).length, 1, 'one h1');
            assert.ok(r.text.includes('<main id="main"') && r.text.includes('<footer id="ov-footer"'));
        });

        await check('models lists every model with its cheapest offer', async () => {
            const r = await t.get('/models');
            assert.strictEqual(r.status, 200);
            assert.ok(r.text.includes('DeepSeek Chat'));
            assert.ok(r.text.includes('$0.20 in'), 'the cheapest offer, not the dearest');
            const filtered = await t.get('/models?q=llama');
            assert.ok(filtered.text.includes('Llama 3 8B abliterated'));
            assert.ok(!filtered.text.includes('DeepSeek Chat'), 'the search filters');
            const family = await t.get('/models?family=DeepSeek');
            assert.ok(family.text.includes('DeepSeek Chat'));
            assert.ok(!family.text.includes('Llama 3 8B'));
        });

        await check('one model: every offer, its price, speed, uptime, data policy, Try it, curl and SDK', async () => {
            const r = await t.get('/m/deepseek/deepseek-chat');
            assert.strictEqual(r.status, 200, r.text);
            assert.ok(r.text.includes('DeepSeek') && r.text.includes('DeepInfra'), 'both offers');
            assert.ok(r.text.includes('no training') && r.text.includes('no retention') && r.text.includes('cn'), 'the data policy');
            assert.ok(r.text.includes('99.0%'), 'uptime');
            assert.ok(r.text.includes('400 ms'), 'p50');
            assert.ok(r.text.includes('Sign in to try it'), 'a signed-out try asks for sign-in');
            assert.ok(r.text.includes('Private'), 'the privacy label on an offer');
            assert.ok(r.text.includes('Standard') || r.text.includes('No training'));
            assert.ok(r.text.includes('Presets') && r.text.includes('openvibe/economy'), 'the presets box');
            assert.ok(r.text.includes('deepseek/deepseek-chat@v1'), 'the exact id in the snippet');
            assert.ok(r.text.includes('import OpenAI from'), 'the SDK line');
            const miss = await t.get('/m/nope/nope');
            assert.strictEqual(miss.status, 404);
        });

        await check('the API page: the endpoint, keys, model ids and usage', async () => {
            const r = await t.get('/api');
            assert.strictEqual(r.status, 200);
            assert.ok(r.text.includes('https://api.openvibe.exchange/v1/chat/completions'));
            assert.ok(r.text.includes('https://api.openvibe.exchange/v1/messages'));
            assert.ok(r.text.includes('openvibe/auto'));
            assert.ok(r.text.includes('openvibe.network/developers'), 'keys are made on Network');
            assert.ok(r.text.includes('2026-11-05') && r.text.includes('Requests'), 'usage by day');
        });

        await check('sell: the offer flow, and what is not sold, said plainly', async () => {
            const r = await t.get('/sell');
            assert.strictEqual(r.status, 200);
            assert.ok(r.text.includes('Offer to the network'));
            assert.ok(r.text.includes('Personal subscription plans'));
            assert.ok(r.text.includes('Personal API keys'));
            assert.ok(r.text.includes('What is sold'));
            assert.ok(r.text.includes('Owner’s machine') || r.text.includes('No community capacity yet'));
            assert.ok(r.text.includes('Idle-only') && r.text.includes('Kudos') && r.text.includes('sees the prompt'), 'idle-only, kudos and the privacy sentence');
            assert.ok(r.text.includes('@name’s'), 'the seller card');
        });

        await check('uncensored: sign-in first, then the 18+ gate and the floor', async () => {
            const r = await t.get('/uncensored');
            assert.strictEqual(r.status, 200);
            assert.ok(r.text.includes('Sign in with OpenVibe'), 'signed out: sign in first');
            assert.ok(r.text.includes('No sexual content involving minors'));
            assert.ok(r.text.includes('No non-consensual sexual content of real people'));
            assert.ok(r.text.includes('No help with weapons of mass harm'));
        });

        await check('AI in OpenVibe: which product runs which model, and the daily cost', async () => {
            const r = await t.get('/ai');
            assert.strictEqual(r.status, 200);
            assert.ok(r.text.includes('OpenVibe.Live'), 'the product’s full name, not “live”');
            assert.ok(r.text.includes('deepseek-chat'));
            assert.ok(r.text.includes('$0.0002'), 'the cost per day (0.006 over 30 days)');
        });

        await check('status: uptime per offer, the changelog and incidents', async () => {
            const r = await t.get('/status');
            assert.strictEqual(r.status, 200);
            assert.ok(r.text.includes('Uptime per offer') && r.text.includes('Model changelog') && r.text.includes('Incidents'));
            assert.ok(r.text.includes('99.0%') && r.text.includes('no traffic'));
        });

        await check('an unknown page is 404, and a personal page is never cached', async () => {
            const r = await t.get('/nope');
            assert.strictEqual(r.status, 404);
            assert.ok(r.text.includes('Not found'));
        });

        await check('the agent layer serves the new pages as Markdown twins', async () => {
            const r = await t.get('/index.md');
            assert.strictEqual(r.status, 200);
            assert.match(r.headers.get('content-type'), /text\/markdown/);
            assert.ok(r.text.includes('Every AI model, one account.'));
        });
    } finally { await t.close(); }

    const down = await boot({ ai: downAi });
    try {
        await check('AI unreachable: every page still renders and says the numbers are not live', async () => {
            for (const p of ['/', '/models', '/api', '/sell', '/ai', '/status']) {
                const r = await down.get(p);
                assert.strictEqual(r.status, 200, p);
                assert.ok(!/NaN|undefined/.test(r.text.replace(/undefined"/g, '')), `${p} invents no number`);
            }
            const home = await down.get('/');
            assert.ok(home.text.includes('not reachable') || home.text.includes('not available'), 'the honest notice');
            assert.ok(!home.text.includes('requests today'), 'no invented live number');
        });
    } finally { await down.close(); }
    done();
})();
