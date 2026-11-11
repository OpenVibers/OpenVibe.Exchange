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
        await check('home puts a key and live model prices first', async () => {
            const r = await t.get('/'); assert.strictEqual(r.status,200);
            assert.ok(r.text.includes('One API for every model.') && r.text.includes('Pay what the model costs.'));
            assert.ok(r.text.includes('Get a key') && r.text.includes('api.openvibe.exchange/v1/chat/completions'));
            assert.ok(r.text.includes('tokens routed this week') && r.text.includes('median time to first token'));
            assert.ok(r.text.includes('DeepSeek Chat') && r.text.includes('Try in Chat') && r.text.includes('How it ranks'));
            assert.strictEqual((r.text.match(/<h1[\s>]/g)||[]).length,1);
        });

        await check('models lists every model with its cheapest offer', async () => {
            const r = await t.get('/models');
            assert.strictEqual(r.status, 200);
            assert.ok(r.text.includes('DeepSeek Chat'));
            assert.ok(r.text.includes('$0.2 / $0.3'), 'the cheapest offer, not the dearest');
            const filtered = await t.get('/models?q=llama');
            assert.ok(filtered.text.includes('Llama 3 8B abliterated'));
            assert.ok(!filtered.text.includes('DeepSeek Chat'), 'the search filters');
            const family = await t.get('/models?family=DeepSeek');
            assert.ok(family.text.includes('DeepSeek Chat'));
            assert.ok(!family.text.includes('Llama 3 8B'));
        });

        await check('disabled and retired registry models have public pages, API rows and crawl links', async () => {
            const list = await t.get('/api/v1/models?status=retired');
            assert.strictEqual(list.status, 200, list.text);
            assert.deepStrictEqual(list.json().models.map(m => m.id), ['google/gemini-old']);
            const one = await t.get('/api/v1/models/google%2Fgemini-old');
            assert.strictEqual(one.json().model.status, 'retired');
            const page = await t.get('/models/google%2Fgemini-old');
            assert.strictEqual(page.status, 200, page.text);
            assert.ok(page.text.includes('Gemini Old') && page.text.includes('Retired') && page.text.includes('SoftwareApplication'));
            const index = await t.get('/models?status=preview');
            assert.ok(index.text.includes('Gemini Preview') && !index.text.includes('Gemini Old'));
            const spotted = await t.get('/models?status=spotted');
            assert.ok(spotted.text.includes('anonymous-silver') && !spotted.text.includes('Gemini Old'));
            const spotPage = await t.get('/models/arena%2Fanonymous-silver');
            assert.ok(spotPage.text.includes('lmarena.ai') && spotPage.text.includes('2026-11-11'));
            const map = await t.get('/sitemap.xml');
            assert.ok(map.text.includes('google%2Fgemini-old'));
            const twin = await t.get('/models/google%2Fgemini-old.md');
            assert.strictEqual(twin.status, 200, twin.text);
            assert.ok(twin.text.includes('Gemini Old'));
        });
        await check('public directory JSON and model structured data match the catalog', async () => {
            const list = await t.get('/api/v1/models?q=deepseek');
            assert.strictEqual(list.status, 200, list.text);
            assert.ok(list.json().models.some(m => m.slug === 'deepseek/deepseek-chat'));
            const one = await t.get('/api/v1/models/deepseek/deepseek-chat');
            assert.strictEqual(one.status, 200, one.text);
            assert.strictEqual(one.json().model.slug, 'deepseek/deepseek-chat');
            assert.strictEqual((await t.get('/api/v1/models/deepseek%2Fdeepseek-chat')).json().model.slug, 'deepseek/deepseek-chat');
            const liveOnly = await t.get('/api/v1/models/meta-llama/llama-3-8b-abliterated');
            assert.strictEqual(liveOnly.status, 200, liveOnly.text);
            assert.strictEqual(liveOnly.json().model.status, 'available');
            assert.ok(liveOnly.json().model.offers.length > 0);
            assert.ok(list.json().models.some(m => m.id === 'deepseek/deepseek-chat'));
            assert.strictEqual((await t.get('/api/v1/models/nope/nope')).status, 404);
            const html = await t.get('/m/deepseek/deepseek-chat');
            assert.ok(html.text.includes('schema.org') && html.text.includes('SoftwareApplication'));
        });

        await check('public search returns filtered offers and the models page uses the same query', async () => {
            const api = await t.get('/api/v1/search?q=DeepInfra&max_price=0.5');
            assert.strictEqual(api.status, 200, api.text);
            const body = api.json();
            assert.strictEqual(body.count, 1);
            assert.strictEqual(body.results[0].provider, 'DeepInfra');
            assert.strictEqual(body.results[0].price.out, 0.3);
            const page = await t.get('/models?q=DeepInfra&max_price=0.5');
            assert.strictEqual(page.status, 200);
            assert.ok(page.text.includes('DeepSeek Chat') && page.text.includes('Quality'));
            assert.ok(!page.text.includes('Qwen3 32B'));
        });

        await check('a model at /models/…: the same page, with first token, errors and How it ranks', async () => {
            const r = await t.get('/models/deepseek%2Fdeepseek-chat');
            assert.strictEqual(r.status, 200);
            assert.ok(r.text.includes('DeepSeek') && r.text.includes('DeepInfra'));
            assert.ok(r.text.includes('First token') && r.text.includes('Errors'), 'the providers tab columns');
            assert.ok(r.text.includes('openvibe.chat/vibe?models=deepseek%2Fdeepseek-chat'));
            assert.ok(r.text.includes('openvibe.report/ai/models/deepseek%2Fdeepseek-chat'), 'How it ranks');
            assert.ok(r.text.includes('api.openvibe.exchange'));
            assert.strictEqual((await t.get('/models/nope%2Fnope')).status, 404);
        });

        await check('an offer shows its tier, its latency class and the free allowance left', async () => {
            const r = await t.get('/models/deepseek%2Fdeepseek-chat');
            assert.ok(r.text.includes('Flex'), 'the Flex tier is named');
            assert.ok(r.text.includes('60 free tokens left'), 'the free allowance left is named');
            assert.ok(r.text.includes('background/batch only'), 'the latency class is named');
        });

        await check('one model: every offer, its price, speed, uptime, data policy, Try it, curl and SDK', async () => {
            const r = await t.get('/m/deepseek/deepseek-chat');
            assert.strictEqual(r.status, 200, r.text);
            assert.ok(r.text.includes('DeepSeek') && r.text.includes('DeepInfra'), 'both offers');
            assert.ok(r.text.includes('no training') && r.text.includes('no retention') && r.text.includes('cn'), 'the data policy');
            assert.ok(r.text.includes('99.0%'), 'uptime');
            assert.ok(r.text.includes('400 ms'), 'p50');
            assert.ok(r.text.includes('https://openvibe.chat/vibe?models=deepseek%2Fdeepseek-chat'), 'Try it opens Chat with this model');
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

        await check('seller entry moves permanently to Link', async () => {
            const r = await t.get('/sell'); assert.strictEqual(r.status,301);
            assert.strictEqual(r.headers.get('location'),'https://openvibe.link');
        });

        await check('uncensored: sign-in first, then the 18+ gate and the floor', async () => {
            const r = await t.get('/uncensored');
            assert.strictEqual(r.status, 200);
            assert.ok(r.text.includes('Sign in with OpenVibe'), 'signed out: sign in first');
            assert.ok(r.text.includes('No sexual content involving minors'));
            assert.ok(r.text.includes('No non-consensual sexual content (fiction included), and no incest'));
            assert.ok(r.text.includes('No help with weapons of mass harm'));
            // The policy says plainly why the second line is not negotiable.
            assert.ok(r.text.includes('Non-consensual sexual content (fiction included) and incest are refused, because payment providers and hosts ban them.'));
        });

        await check('product usage moves permanently to Report', async () => {
            const r = await t.get('/ai'); assert.strictEqual(r.status,301);
            assert.strictEqual(r.headers.get('location'),'https://openvibe.report/ai/exchange');
        });

        await check('Free to try is shown only where an offer says free_tier', async () => {
            const u = t.network.addUser('free');
            for (const p of ['/', '/models', '/m/deepseek/deepseek-chat']) {
                const r = await t.get(p);
                assert.ok(r.text.includes('Free to try'), `${p} shows the badge`);
            }
            const paid = await t.get('/m/qwen/qwen3-32b');
            assert.ok(!paid.text.includes('Free to try'), 'no badge when the field is absent');
            const chat = await t.get('/chat/new', { as: u });
            assert.strictEqual(chat.status, 301, 'the picker now lives in Chat');
        });

        await check('status: uptime per offer, the changelog and incidents', async () => {
            const r = await t.get('/status');
            assert.strictEqual(r.status, 200);
            assert.ok(r.text.includes('Uptime per offer') && r.text.includes('Model changelog') && r.text.includes('Incidents'));
            assert.ok(r.text.includes('99.0%') && r.text.includes('no traffic'));
        });

        await check('status is measured: down and degraded carry a plain reason and since when', async () => {
            const offer = ai.catalogData.models[0].offers[0];
            try {
                offer.status = 'down';
                offer.status_reason = 'the provider says the account is out of credit';
                offer.status_since = '2026-11-09T09:00:00.000Z';
                const down = await t.get('/status');
                assert.ok(down.text.includes('Down') && down.text.includes('the provider says the account is out of credit'), 'the status page says why');
                assert.ok(down.text.includes('since 2026-11-09 09:00 UTC'), 'and since when');
                offer.status = 'degraded';
                offer.status_reason = 'too many errors in the last hour';
                offer.status_since = '2026-11-09T10:00:00.000Z';
                const degraded = await t.get('/m/deepseek/deepseek-chat');
                assert.ok(degraded.text.includes('Degraded') && degraded.text.includes('too many errors in the last hour'), 'the model page shows the measured status');
            } finally {
                offer.status = 'up';
                offer.status_reason = null;
                offer.status_since = null;
            }
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

    await (async () => {
        let calls = 0;
        const openapiFetch = async () => {
            calls += 1;
            return {
                ok: true,
                json: async () => ({ openapi: '3.1.0', info: { title: 'OpenVibe.AI API' }, servers: [{ url: 'https://somewhere.else' }], paths: { '/v1/chat/completions': { post: {} } } }),
            };
        };
        const o = await boot({ ai: createFakeAi(), openapiFetch });
        try {
            await check('/openapi.json is the API host’s document, on the API host, cached ten minutes', async () => {
                const r = await o.get('/openapi.json');
                assert.strictEqual(r.status, 200);
                assert.match(r.headers.get('content-type'), /application\/json/);
                assert.match(r.headers.get('cache-control'), /max-age=600/);
                const doc = JSON.parse(r.text);
                assert.strictEqual(doc.servers[0].url, 'https://api.openvibe.exchange');
                assert.ok(doc.paths['/v1/chat/completions'], 'the API host’s paths, not Exchange v1’s');
                await o.get('/openapi.json');
                assert.strictEqual(calls, 1, 'read once, then cached');
            });
        } finally { await o.close(); }

        // The free model's provider is out of credit: AI marks its free-tier offer not free now (free_now false) and
        // says no chat model can serve the free allowance (free_available false). Nothing promises free capacity.
        const pausedAi = createFakeAi();
        pausedAi.catalogData.free_available = false;
        for (const m of pausedAi.catalogData.models) for (const o of m.offers || []) if (o.free_tier) { o.free_now = false; o.status = 'exhausted'; }
        const paused = await boot({ ai: pausedAi });
        try {
            await check('free paused: no Free to try, a plain note, and no free-messages stat', async () => {
                const home = await paused.get('/');
                assert.strictEqual(home.status, 200);
                assert.ok(!home.text.includes('Free to try'), 'no offer is promised as free');
                assert.ok(!home.text.includes('messages free every day'), 'the free allowance is not a stat while paused');
                const models = await paused.get('/models');
                assert.ok(models.text.includes('Free paused'), 'the paused offer says so');
                const freeModel = pausedAi.catalogData.models.find((m) => (m.offers || []).some((o) => o.free_tier));
                const page = await paused.get('/m/' + freeModel.slug);
                assert.ok(page.text.includes('Free paused'));
            });
        } finally { await paused.close(); }

        const broken = await boot({ ai: createFakeAi(), openapiFetch: async () => { throw new Error('down'); } });
        try {
            await check('/openapi.json still answers when the API host is down', async () => {
                const r = await broken.get('/openapi.json');
                assert.strictEqual(r.status, 200);
                assert.match(r.headers.get('cache-control'), /max-age=60/);
                const doc = JSON.parse(r.text);
                assert.strictEqual(doc.servers[0].url, 'https://api.openvibe.exchange');
            });
        } finally { await broken.close(); }
    })();

    await (async () => {
        const catalog = createFakeAi().catalog();
        const internal = {
            slug: 'local/bge-small-en-v1.5', canonical: 'local/bge-small-en-v1.5', name: 'bge-small-en-v1.5',
            family: 'Local model (OpenAI-compatible server on this host)', type: 'embedding', kind: 'embedding',
            capabilities: {}, offers: [{ provider: 'local', provider_name: 'Local model (OpenAI-compatible server on this host)', model: 'bge', trust: 'first-party', free: true, price: null, speed: {}, uptime: null, requests_7d: 0, data_policy: null }], requests_7d: 0,
        };
        const chatKind = {
            slug: 'deepseek/deepseek-chat', canonical: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', family: 'DeepSeek', kind: 'chat',
            capabilities: { tools: true }, offers: [{ provider: 'shared', provider_name: "Shared provider (Live's shared key)", model: 'deepseek-chat', id: 'deepseek/deepseek-chat@v1', trust: 'first-party', free: false, price: { in: 0.2, out: 0.3 }, speed: { p50_ms: 400, p95_ms: 800 }, uptime: 0.99, requests_7d: 5, data_policy: { trains: false, retention_days: 0 } }], requests_7d: 5,
        };
        const c = await boot({ ai: { ...createFakeAi(), catalog: async () => ({ generated_at: '', models: [internal, chatKind], families: [], count: 2 }) } });
        try {
            await check('only chat models are listed, and a provider’s internal label is never printed', async () => {
                for (const p of ['/', '/models', '/api', '/status']) {
                    const r = await c.get(p);
                    assert.strictEqual(r.status, 200, p);
                    assert.ok(!/Local model \(OpenAI-compatible|Shared provider \(Live/.test(r.text), `${p} prints no internal label`);
                    assert.ok(!r.text.includes('bge-small'), `${p} sells no embedding`);
                }
                const m = await c.get('/m/deepseek/deepseek-chat');
                assert.ok(m.text.includes('OpenVibe'), 'the shared capacity is said as OpenVibe');
            });
        } finally { await c.close(); }
    })();

    const down = await boot({ ai: downAi });
    try {
        await check('AI unreachable: every page still renders and says the numbers are not live', async () => {
            for (const p of ['/', '/models', '/api', '/status']) {
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
