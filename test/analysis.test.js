'use strict';
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');
const { createAnalysis, ratingFor } = require('../server/analysis');
const { createBench } = require('../server/bench');
(async () => {
    const ai = createFakeAi();
    const rating = { subject: 'deepseek-chat', kind_id: 'chat.arena', category: 'all', games: 20, elo: 1100, ci_lower: 1050, ci_upper: 1150 };
    const bench = { board: async () => ({ minimum_samples: 20, rows: [rating, { subject: 'qwen3-32b', games: 19, elo: 1500 }] }) };
    const cell = { day: '2026-11-09', model: 'deepseek/deepseek-chat', provider: 'deepseek', task_kind: 'chat', runs: 40, latency_p50_ms: 1234, latency_p95_ms: 2500, ttft_p50_ms: null, cost_per_run_usd: 0.001 };
    let reads = 0;
    const analysis = createAnalysis({ config: { ai: { url: 'https://unused.test', timeoutMs: 2000 } }, ai, bench, metrics: {
        model: async () => ({ series: [cell, { ...cell, provider: 'sparse', runs: 19 }] }),
        compare: async ({ models }) => { reads++; return { day: cell.day, minimum_samples: 20, models: models.map((model) => ({ model, cells: [{ ...cell, model }] })) }; },
    } });
    const t = await boot({ ai, bench, analysis });
    try {
        await check('comparison joins unchanged Bench scores to measured cells and withholds small samples', async () => {
            const response = await t.get('/api/v1/analysis/compare?models=deepseek/deepseek-chat,qwen/qwen3-32b');
            assert.strictEqual(response.status, 200, response.text);
            assert.strictEqual(response.headers.get('access-control-allow-origin'), '*');
            const preflight = await t.get('/api/v1/analysis/compare', { method: 'OPTIONS' });
            assert.strictEqual(preflight.status, 204);
            assert.match(preflight.headers.get('access-control-allow-headers'), /traceparent/);
            const data = response.json();
            assert.deepStrictEqual(data.models[0].rating, rating);
            assert.strictEqual(data.models[1].rating, null);
            assert.strictEqual(data.models[0].cells[0].latency_p50_ms, 1234);
            await t.get('/api/v1/analysis/compare?models=deepseek/deepseek-chat,qwen/qwen3-32b');
            assert.strictEqual(reads, 1, 'public comparison is cached');
            assert.strictEqual((await t.get('/api/v1/analysis/compare?models=a,b,c,d,e,f,g')).status, 422);
            assert.strictEqual((await t.get('/api/v1/analysis/compare?models=a&models=b')).status, 422);
        });
        await check('model page and JSON show the same measured latency and Bench rating', async () => {
            const data = (await t.get('/api/v1/analysis/models/deepseek%2Fdeepseek-chat')).json();
            assert.strictEqual(data.measured.series.length, 1);
            assert.deepStrictEqual(data.rating, rating);
            const page = await t.get('/m/deepseek/deepseek-chat');
            assert.strictEqual(page.status, 200, page.text);
            assert(page.text.includes('1,234') && page.text.includes('1,100') && page.text.includes('chat.arena'));
            assert(!page.text.includes('data-label="Provider">sparse'));
        });
        await check('several dated subjects never become an invented family rating', async () => {
            const model = { slug: 'openai/gpt-5-mini', offers: [{ model: 'gpt-5-mini' }] };
            const one = { ...rating, subject: 'gpt-5-mini-2025-08-07' };
            assert.deepStrictEqual(ratingFor(model, [one]), one);
            assert.strictEqual(ratingFor(model, [one, { ...one, subject: 'gpt-5-mini-2026-08-07' }]), null);
        });
        await check('a public Bench read works without service credentials', async () => {
            let path;
            const publicBench = createBench({ config: { oauth: {}, bench: { url: 'https://bench.test', timeoutMs: 2000 } }, fetchImpl: async (url, init) => {
                path = String(url);
                assert(!new Headers(init.headers).has('authorization'));
                return new Response(JSON.stringify({ board: { rows: [rating, { ...rating, games: 19 }] } }), { headers: { 'Content-Type': 'application/json' } });
            } });
            const data = await publicBench.board();
            assert.strictEqual(path, 'https://bench.test/api/v1/ratings/chat.arena?category=all');
            assert.deepStrictEqual(data.rows, [rating]);
        });
    } finally { await t.close(); }
    done();
})().catch((err) => { console.error(err); process.exitCode = 1; });
