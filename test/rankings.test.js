'use strict';
/**
 * The rankings join Bench's board with AI's catalogue: a rating, the price per million out and in, the measured
 * speed and uptime, and the value column. The status changelog reads the daily catalogue snapshots: new, gone
 * and repriced, each with the dates they were recorded.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');
const { createFakeBench } = require('./helpers/bench');

const BOARD = {
    unavailable: false, kind_id: 'chat.arena', category: 'all',
    rows: [
        { subject: 'deepseek/deepseek-chat', elo: 1120, games: 24, wins: 15, losses: 7, ties: 2, win_rate: 0.6667, provisional: false },
        { subject: 'qwen/qwen3-32b', elo: 980, games: 4, wins: 1, losses: 3, ties: 0, win_rate: 0.25, provisional: true },
        { subject: 'no-catalog/model', elo: 1200, games: 12, wins: 9, losses: 3, ties: 0, win_rate: 0.75, provisional: false },
    ],
};

const boardFor = (category) => ({ ...BOARD, category });

(async () => {
    const bench = createFakeBench({ board: async (args) => boardFor(args.category) });
    const ai = createFakeAi();
    ai.usageData.by_product.push({
        product: 'app_demo', type: 'app', requests: 5, tokens_in: 10, tokens_out: 20,
        models: [{ model: 'deepseek-chat', requests: 5 }],
    });
    const t = await boot({ ai, bench });

    try {
        await check('the rankings join the board with price, speed and uptime', async () => {
            const r = await t.get('/rankings?category=code');
            assert.strictEqual(r.status, 200, r.text);
            assert.strictEqual(bench.calls.boards[0].category, 'code');
            assert.ok(r.text.includes('DeepSeek Chat'), 'the catalog model by name');
            assert.ok(r.text.includes('1120'), 'the Elo');
            assert.ok(r.text.includes('$0.30'), 'the cheapest output price per million');
            assert.ok(r.text.includes('$0.20'), 'the cheapest input price');
            assert.ok(r.text.includes('520 ms'), 'the measured p50');
            assert.ok(r.text.includes('97.0%'), 'the uptime');
            assert.ok(r.text.includes('Elo per $/M out'), 'the value column');
            assert.ok(r.text.includes('400'), 'rating above 1000 per dollar of output');
            assert.ok(r.text.includes('provisional'), 'a model with four games is provisional');
            assert.ok(r.text.includes('no-catalog/model'), 'a subject with no catalogue match is still listed');
            assert.ok(r.text.includes('Code'), 'the category tab');
            assert.match(r.headers.get('cache-control'), /^public, max-age=60/);
        });

        await check('best value sorts by the value column', async () => {
            const r = await t.get('/rankings?category=code&sort=value');
            assert.strictEqual(r.status, 200, r.text);
            assert.ok(r.text.includes('Best value'));
        });

        await check('the products and apps panel is aggregate only', async () => {
            const r = await t.get('/rankings');
            assert.strictEqual(r.status, 200);
            assert.ok(r.text.includes('Products and apps'));
            assert.ok(/OpenVibe\.Live|Live/.test(r.text), 'the product name');
            assert.ok(r.text.includes('app_demo'), 'a public app is named');
            assert.ok(r.text.includes('App'), 'the app is labelled as an app');
            assert.ok(r.text.includes('never a person') || r.text.includes('never a person.'), 'the aggregate promise');
            assert.strictEqual(bench.calls.boards[bench.calls.boards.length - 1].category, 'all');
        });

        await check('the changelog reads the last two daily snapshots: new, gone, repriced', async () => {
            const db = t.ctx.s.db;
            const old = [['deepseek/deepseek-chat', 'DeepSeek Chat', 'DeepSeek', 0.10, 0.20], ['qwen/qwen3-32b', 'Qwen3 32B', 'Qwen', 0.40, 0.90], ['old/model', 'Old Model', 'Other', 1, 2]];
            for (const [slug, name, family, priceIn, priceOut] of old) {
                await db.prepare(`INSERT INTO exchange_model_snapshots (day, slug, name, family, price_in, price_out, provider)
                    VALUES ('2026-11-05', ?, ?, ?, ?, ?, 'test')`).run(slug, name, family, priceIn, priceOut);
            }
            const status = await t.get('/status');
            assert.strictEqual(status.status, 200, status.text);
            assert.ok(status.text.includes('2026-11-05'), 'the earlier day is named');
            assert.ok(status.text.includes('New') && status.text.includes('Llama 3 8B abliterated'), 'the model new today');
            assert.ok(status.text.includes('Gone') && status.text.includes('Old Model'), 'the model that left');
            assert.ok(status.text.includes('Price changed') && status.text.includes('DeepSeek Chat'), 'the repriced model');
            assert.ok(status.text.includes('$0.20 in / $0.30 out'), 'the new price');
            assert.ok(status.text.includes('$0.10 in / $0.20 out'), 'the old price');
            const today = await db.prepare("SELECT COUNT(*) AS n FROM exchange_model_snapshots WHERE day = CURRENT_DATE").get();
            assert.strictEqual(Number(today.n), 3, 'today’s three chat models were recorded by the status read');
        });
    } finally { await t.close(); }

    const down = await boot({ ai: createFakeAi(), bench: createFakeBench({ board: async () => ({ unavailable: true, category: 'all', rows: [] }) }) });
    try {
        await check('an unavailable board says so and invents no rating', async () => {
            const r = await down.get('/rankings');
            assert.strictEqual(r.status, 200);
            assert.ok(r.text.includes('The Bench board is not reachable right now'));
            assert.ok(!r.text.includes('1120'));
        });
    } finally { await down.close(); }

    done();
})();
