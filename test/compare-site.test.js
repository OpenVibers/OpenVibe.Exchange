'use strict';
/**
 * openvibe.compare's pages (plan 297). One process serves Exchanges's own site and the compare site; the Host
 * header decides which. These tests ask for the compare pages with the compare name, check the plain-kit markup,
 * the version table, the remark form, the sitemap — and that the same paths on openvibe.exchange never become the
 * compare site.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');
const { createFakeBench } = require('./helpers/bench');

const HOST = { 'x-forwarded-host': 'openvibe.compare' };

(async () => {
    const ai = createFakeAi();
    ai.catalogData.models.push(
        {
            slug: 'openai/gpt-5-mini', canonical: 'openai/gpt-5-mini', name: 'gpt-5-mini', family: 'GPT', variant: null,
            uncensored: false, kind: 'chat', context: 400000, max_output: 128000, open_weights: false,
            capabilities: { tools: true, json: true, vision: true, stream: true }, modalities: ['text'], description: null,
            requests_7d: 50, requests_today: 4, community: false,
            offers: [{
                provider: 'openai', provider_name: 'OpenAI', model: 'gpt-5-mini', id: 'openai/gpt-5-mini@v1', trust: 'first-party',
                access: 'OWN_DEPLOYMENT', free: false, free_tier: false, status: 'up',
                price: { in: 0.25, out: 2, cached: 0.025, per: '1M tokens', currency: 'USD' },
                speed: { p50_ms: 900, p95_ms: 3000 }, uptime: 0.99, requests_7d: 50, requests_today: 4,
                privacy: { label: 'anonymized', retention: '0', training: false, region: 'us', known: true },
                data_policy: { trains: false, retention_days: 0, region: 'us' },
                updated_at: '2026-11-06T00:00:00.000Z',
            }],
        },
        {
            slug: 'openai/gpt-5.1-mini', canonical: 'openai/gpt-5.1-mini', name: 'gpt-5.1-mini', family: 'GPT', variant: null,
            uncensored: false, kind: 'chat', context: 400000, max_output: 128000, open_weights: false,
            capabilities: { tools: true, json: true, vision: true, stream: true }, modalities: ['text'], description: null,
            requests_7d: 80, requests_today: 6, community: false,
            offers: [{
                provider: 'openai', provider_name: 'OpenAI', model: 'gpt-5.1-mini', id: 'openai/gpt-5.1-mini@v1', trust: 'first-party',
                access: 'OWN_DEPLOYMENT', free: false, free_tier: false, status: 'up',
                price: { in: 0.2, out: 1.5, cached: 0.02, per: '1M tokens', currency: 'USD' },
                speed: { p50_ms: 700, p95_ms: 2400 }, uptime: 0.995, requests_7d: 80, requests_today: 6,
                privacy: { label: 'anonymized', retention: '0', training: false, region: 'us', known: true },
                data_policy: { trains: false, retention_days: 0, region: 'us' },
                updated_at: '2026-11-06T00:00:00.000Z',
            }],
        },
    );
    ai.catalogData.count = ai.catalogData.models.length;

    const bench = createFakeBench({
        boards: {
            'chat.arena': [
                { subject: 'deepseek/deepseek-chat', elo: 1040, games: 20, wins: 12, losses: 6, ties: 2, win_rate: 0.65, ci_lower: 1020, ci_upper: 1060, provisional: false },
                { subject: 'openai/gpt-5-mini', elo: 1100, games: 30, wins: 20, losses: 8, ties: 2, win_rate: 0.7, ci_lower: 1080, ci_upper: 1120, provisional: false },
                { subject: 'openai/gpt-5.1-mini', elo: 1120, games: 30, wins: 22, losses: 6, ties: 2, win_rate: 0.77, ci_lower: 1125, ci_upper: 1145, provisional: false },
            ],
        },
    });

    const t = await boot({ ai, bench });

    try {
        await check('the compare home is plain kit markup, complete without JavaScript', async () => {
            const r = await t.get('/', { headers: HOST });
            assert.strictEqual(r.status, 200, r.text);
            assert.ok(r.text.includes('OpenVibe.Compare'), 'the compare name');
            assert.ok(r.text.includes('Compare AI models'));
            assert.ok(r.text.includes('DeepSeek Chat') && r.text.includes('gpt-5.1-mini'));
            assert.ok(r.text.includes('Bench quality'));
            assert.ok(r.text.includes('name="models"'), 'checkboxes to compare');
            assert.ok(r.text.includes('/api/v1/compare'), 'the API is named');
            assert.ok(!r.text.includes('OpenVibe.Exchange: Every AI model'), 'not the Exchange home');
        });

        await check('one model is its price book, its Bench boards and its versions', async () => {
            const r = await t.get('/models/openai/gpt-5.1-mini', { headers: HOST });
            assert.strictEqual(r.status, 200, r.text);
            assert.ok(r.text.includes('gpt-5.1-mini'));
            assert.ok(r.text.includes('Every offer that serves it'));
            assert.ok(r.text.includes('OpenAI'));
            assert.ok(r.text.includes('$0.20') && r.text.includes('$1.50'), 'the price book');
            assert.ok(r.text.includes('Bench quality'));
            assert.ok(r.text.includes('1120'), 'the Bench score');
            assert.ok(r.text.includes('Versions of the gpt-mini line'));
            assert.ok(r.text.includes('gpt-5-mini'), 'the older version');
            assert.ok(r.text.includes('Teach the benchmarks'), 'the remark form');
            assert.ok(r.text.includes('send it for review') || r.text.includes('Send it for review'));
            const missing = await t.get('/models/nope/nothing', { headers: HOST });
            assert.strictEqual(missing.status, 404);
            assert.ok(missing.text.includes('No such model'));
        });

        await check('two models side by side name a winner per criterion and no invented overall score', async () => {
            const r = await t.get('/compare?models=openai/gpt-5.1-mini,deepseek/deepseek-chat', { headers: HOST });
            assert.strictEqual(r.status, 200, r.text);
            assert.ok(r.text.includes('gpt-5.1-mini vs DeepSeek Chat'));
            assert.ok(r.text.includes('Price out, per 1M'));
            assert.ok(r.text.includes('Bench Elo'));
            assert.ok(r.text.includes('best'));
            assert.ok(r.text.includes('never one invented overall score') || r.text.includes('no invented overall score'));
            assert.ok(r.text.includes('Price spread'));
            assert.ok(r.text.includes('Teach the benchmarks'));
            const one = await t.get('/compare?models=deepseek/deepseek-chat', { headers: HOST });
            assert.strictEqual(one.status, 200);
            assert.ok(one.text.includes('Choose the models'), 'one model goes back to the picker');
            const five = await t.get('/compare?models=a,b,c,d,e', { headers: HOST });
            assert.strictEqual(five.status, 200);
            assert.ok(five.text.includes('between two and four') || five.text.includes('Choose the models'));
        });

        await check('the versions pages order a line and say what changed, with the interval rule', async () => {
            const list = await t.get('/versions', { headers: HOST });
            assert.strictEqual(list.status, 200, list.text);
            assert.ok(list.text.includes('gpt-mini'));
            const line = await t.get('/versions/gpt-mini', { headers: HOST });
            assert.strictEqual(line.status, 200, line.text);
            assert.ok(line.text.includes('gpt-5-mini') && line.text.includes('gpt-5.1-mini'));
            assert.ok(line.text.includes('What changed'));
            assert.ok(line.text.includes('better'));
            assert.ok(line.text.includes('An Elo move whose intervals overlap is not called a change'));
            const missing = await t.get('/versions/nope', { headers: HOST });
            assert.strictEqual(missing.status, 404);
        });

        await check('method, robots, sitemap and llms.txt are there and say where they came from', async () => {
            const method = await t.get('/method', { headers: HOST });
            assert.strictEqual(method.status, 200);
            assert.ok(method.text.includes('OpenVibe.AI catalog') && method.text.includes('OpenVibe.Bench'));
            assert.ok(method.text.includes('reader’s remark') || method.text.includes('reader'));
            const robots = await t.get('/robots.txt', { headers: HOST });
            assert.strictEqual(robots.status, 200);
            assert.ok(robots.text.includes('Sitemap: https://openvibe.compare/sitemap.xml'));
            assert.ok(robots.text.includes('Disallow: /api/'));
            const sitemap = await t.get('/sitemap.xml', { headers: HOST });
            assert.strictEqual(sitemap.status, 200);
            assert.ok(sitemap.text.includes('<loc>https://openvibe.compare/</loc>'));
            assert.ok(sitemap.text.includes('https://openvibe.compare/models/openai/gpt-5.1-mini'));
            assert.ok(sitemap.text.includes('https://openvibe.compare/versions/gpt-mini'));
            const llms = await t.get('/llms.txt', { headers: HOST });
            assert.strictEqual(llms.status, 200);
            assert.ok(llms.text.includes('# OpenVibe.Compare'));
        });

        await check('a remark posted from the page is pending, and the thanks page says nothing ran', async () => {
            const r = await t.get('/remarks', {
                headers: HOST,
                form: {
                    models: 'openai/gpt-5.1-mini',
                    comparison: 'openai/gpt-5.1-mini-vs-deepseek/deepseek-chat',
                    field: 'quality',
                    remark: 'The newer mini kept the whole file in view where the other dropped the last function.',
                },
            });
            assert.strictEqual(r.status, 303, r.text);
            assert.strictEqual(r.headers.get('location'), '/remarks/thanks');
            const row = await t.ctx.s.db.maybe('SELECT * FROM exchange_compare_remarks');
            assert.ok(row, 'stored');
            assert.strictEqual(row.status, 'pending');
            const thanks = await t.get('/remarks/thanks', { headers: HOST });
            assert.strictEqual(thanks.status, 200);
            assert.ok(thanks.text.includes('Nothing runs and nothing is published'));
        });

        await check('the same paths on openvibe.exchange are Exchange, never the compare site', async () => {
            const home = await t.get('/');
            assert.strictEqual(home.status, 200);
            assert.ok(home.text.includes('OpenVibe.Exchange'));
            assert.ok(!home.text.includes('OpenVibe.Compare: Compare anything'));
            const model = await t.get('/models/openai/gpt-5.1-mini');
            assert.strictEqual(model.status, 200, 'Exchange has its own model page at the same path');
            assert.ok(model.text.includes('OpenVibe.Exchange'), 'the Exchange name, not the compare site');
            assert.ok(!model.text.includes('Teach the benchmarks'), 'Exchange does not get the compare page');
            const api = await t.get('/api/v1/compare/ai/models');
            assert.strictEqual(api.status, 200, 'the API is reachable on both names');
            const unknown = await t.get('/nope', { headers: HOST });
            assert.strictEqual(unknown.status, 404);
        });
    } finally {
        await t.close();
    }
    done();
})();
