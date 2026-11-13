'use strict';
/**
 * The Measured panel on a model page and "Your AI usage" on a signed-in person's dashboard (ai-metrics.md).
 *
 * Both are OpenVibe.Report reads: a public performance row per model, and the person's own rows with the Network
 * session Exchange already holds. The pages are server-rendered and carry the same numbers as plain text for a
 * reader without JavaScript; the OVMetrics builders draw the tiles, strips, spark and bars in the browser.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');
const { createReport, NOT_MEASURED } = require('../server/report');

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

const ROW = {
    group: 'model', key: 'deepseek-chat', calls: 13080,
    success_rate: 0.9941, cache_hit_rate: 0.42,
    ttft_ms: { p50: 540, p90: 980, p95: 1310, n: 13080 },
    latency_ms: { p50: 1200, p90: 2600, p95: 3400, n: 13080 },
    tps: { p50: 86, p90: 120, p95: 133, n: 13080 },
    tokens: { input: 130000, output: 54000 },
    cost: { charged_usd: 61.2, per_call_usd: 0.0042, per_million_output_usd: 12 },
};

const PERSON = {
    day: {
        group: 'day', source: 'raw', insights: [],
        rows: [{ key: yesterday, calls: 4 }, { key: today, calls: 6 }],
        totals: { calls: 10, input_tokens: 1000, output_tokens: 500, cached_tokens: 100, cache_write_tokens: 0, cost_usd: 0.02, fee_usd: 0, charged_usd: 0.012, saved_usd: 0.003 },
    },
    surface: {
        group: 'surface', source: 'raw', insights: [],
        rows: [{ key: 'ai.complete', calls: 8 }, { key: 'chat', calls: 2 }],
        totals: { calls: 10, input_tokens: 1000, output_tokens: 500, cached_tokens: 100, cache_write_tokens: 0, cost_usd: 0.02, fee_usd: 0, charged_usd: 0.012, saved_usd: 0.003 },
    },
};

function jsonOf(html, id) {
    const at = html.indexOf(`id="${id}"`);
    assert.ok(at >= 0, `no ${id} panel`);
    const start = html.indexOf('<script type="application/json">', at);
    assert.ok(start >= 0, `no metrics payload in ${id}`);
    const from = start + '<script type="application/json">'.length;
    const end = html.indexOf('</script>', from);
    return JSON.parse(html.slice(from, end));
}

(async () => {
    // ── The Report client: candidate keys, the five-minute cache, and the person's own Bearer ──
    await check('a performance read asks for AI’s own model key first and keeps it five minutes', async () => {
        const urls = [];
        const report = createReport({
            config: { report: { url: 'https://report.test', timeoutMs: 500, cacheMs: 300000 } },
            now: () => 1000,
            fetchImpl: async (url, init) => {
                urls.push(String(url));
                assert(!new Headers(init.headers).has('authorization'), 'the public read has no token');
                return new Response(JSON.stringify({ group: 'model', rows: [ROW] }), { headers: { 'content-type': 'application/json' } });
            },
        });
        const model = { slug: 'deepseek/deepseek-chat', canonical: 'deepseek/deepseek-chat', offers: [{ model: 'deepseek-chat' }] };
        assert.deepStrictEqual(await report.measuredModel(model), ROW);
        assert.match(urls[0], /group=model&days=30&model=deepseek-chat$/);
        await report.measuredModel(model);
        assert.strictEqual(urls.length, 1, 'the row is cached for five minutes');

        const missed = [];
        const later = createReport({
            config: { report: { url: 'https://report.test', timeoutMs: 500 } }, now: () => 1000,
            fetchImpl: async (url) => {
                missed.push(String(url));
                return new Response(JSON.stringify({ rows: [] }));
            },
        });
        assert.strictEqual(await later.measuredModel(model), null);
        assert.match(missed[0], /model=deepseek-chat$/);
        assert.match(missed[1], /model=deepseek%2Fdeepseek-chat$/);
        assert.strictEqual(await later.measuredModel(model), null, 'no row is cached too');
        assert.strictEqual(missed.length, 2, 'the slug is tried once and the miss is remembered');
    });

    await check('a Report failure is null, never a page error, and a person read carries their own Bearer', async () => {
        const report = createReport({
            config: { report: { url: 'https://report.test', timeoutMs: 500 } }, now: () => 1000,
            fetchImpl: async () => { throw new Error('report is down'); },
        });
        assert.strictEqual(await report.measuredModel({ slug: 'deepseek/deepseek-chat', offers: [{ model: 'deepseek-chat' }] }), null);
        const seen = [];
        const asPerson = createReport({
            config: { report: { url: 'https://report.test', timeoutMs: 500 } }, now: () => 1000,
            fetchImpl: async (url, init) => {
                seen.push([String(url), new Headers(init.headers).get('authorization')]);
                const group = new URL(String(url)).searchParams.get('group');
                return new Response(JSON.stringify(group === 'day' ? { ...PERSON.day } : { ...PERSON.surface }));
            },
        });
        const out = await asPerson.personUsage('session-token');
        assert.strictEqual(out.day.totals.calls, 10);
        assert.strictEqual(out.surface.rows.length, 2);
        assert.strictEqual(seen.length, 2);
        assert(seen.every(([url, auth]) => url.startsWith('https://report.test/api/v1/me/ai/usage?group=') && auth === 'Bearer session-token'));
    });

    // ── The Measured panel on a model page ──
    const ai = createFakeAi();
    const withRow = await boot({ ai, report: { measuredModel: async () => ROW, personUsage: async () => PERSON } });
    try {
        await check('the model page draws the Measured panel from the Report row', async () => {
            const r = await withRow.get('/m/deepseek/deepseek-chat');
            assert.strictEqual(r.status, 200, r.text);
            assert.ok(r.text.includes('Measured'), 'the panel is there');
            assert.ok(!r.text.includes(NOT_MEASURED), 'a measured model is not told to wait');
            assert.ok(r.text.includes('p50 540 ms') && r.text.includes('p95 1.3 s'), 'the plain numbers are readable without JavaScript');
            assert.ok(r.text.includes('86.0 tok/s') && r.text.includes('99.4%') && r.text.includes('42.0%'), 'speed, success and cache hit');
            assert.ok(r.text.includes('$0.0042') && r.text.includes('$12.00') && r.text.includes('13k'), 'cost and calls');
            const parts = jsonOf(r.text, 'measured');
            assert.strictEqual(parts[0].kind, 'tiles');
            assert.strictEqual(parts.filter((p) => p.kind === 'percentiles').length, 2, 'TTFT and latency strips');
            assert.ok(r.text.includes('/shared/ov-metrics.js') && r.text.includes('/js/metrics-panel.js'), 'the builders load');
        });
    } finally { await withRow.close(); }

    const noRow = await boot({ ai, report: { measuredModel: async () => null, personUsage: async () => PERSON } });
    try {
        await check('a model below Report’s floor says it is not measured yet', async () => {
            const r = await noRow.get('/m/deepseek/deepseek-chat');
            assert.strictEqual(r.status, 200, r.text);
            assert.ok(r.text.includes(NOT_MEASURED), 'the exact sentence');
            assert.ok(!r.text.includes('data-ov-metrics'), 'no metrics block is drawn');
        });
    } finally { await noRow.close(); }

    const down = await boot({ ai, report: { measuredModel: async () => { throw new Error('down'); }, personUsage: async () => PERSON } });
    try {
        await check('Report down leaves the model page whole and says it is not measured yet', async () => {
            const r = await down.get('/m/deepseek/deepseek-chat');
            assert.strictEqual(r.status, 200, r.text);
            assert.ok(r.text.includes(NOT_MEASURED));
            assert.ok(r.text.includes('Every offer that serves it'), 'the rest of the page is still there');
        });
    } finally { await down.close(); }

    // ── "Your AI usage" on the person's own dashboard ──
    const USAGE = [{ day: today, key_id: 'k1', model: 'deepseek/deepseek-chat', status: 'settled', requests: 2, tokens_in: 100, tokens_out: 20, cost_usd: 0.001 }];
    const personAi = { ...createFakeAi(), meRequest: async (_token, path) => (path.endsWith('key-usage') ? { rows: USAGE } : { keys: [{ id: 'k1', name: 'My app', prefix: 'ovx_1', monthly_cap_usd: 5 }] }) };
    const dashboard = await boot({ ai: personAi, report: { measuredModel: async () => ROW, personUsage: async () => PERSON } });
    try {
        const user = dashboard.network.addUser('alice');
        await check('a signed-in person sees their own AI usage: totals, a call a day and products', async () => {
            const r = await dashboard.get('/dashboard/usage', { as: user });
            assert.strictEqual(r.status, 200, r.text);
            assert.ok(r.text.includes('Your AI usage'), 'the panel is on their own usage page');
            assert.ok(r.text.includes('1.6k') && r.text.includes('$0.01'), 'tokens and what was charged');
            assert.ok(r.text.includes('By product') && r.text.includes('ai.complete'), 'the product bars');
            const parts = jsonOf(r.text, 'your-ai-usage');
            assert.strictEqual(parts[0].kind, 'tiles');
            assert.strictEqual(parts[1].kind, 'heading');
            assert.strictEqual(parts[2].kind, 'spark');
            assert.strictEqual(parts[2].args[0].length, 30, '30 days, with a measured zero');
            assert.ok(parts[2].args[0].includes(6) && parts[2].args[0].includes(4), 'the calls of the two days');
            assert.strictEqual(parts[3].kind, 'heading');
            assert.strictEqual(parts[4].kind, 'bars');
            assert.ok(r.text.includes('My app'), 'the keys’ own usage stays on the page');
        });

        await check('Report down on the dashboard says so and leaves the keys’ usage alone', async () => {
            const d = await boot({ ai: personAi, report: { measuredModel: async () => null, personUsage: async () => { throw new Error('down'); } } });
            try {
                const r = await d.get('/dashboard/usage', { as: user });
                assert.strictEqual(r.status, 200, r.text);
                assert.ok(r.text.includes('Your AI usage is not available right now.'));
                assert.ok(r.text.includes('My app'));
            } finally { await d.close(); }
        });

        await check('a person with no AI calls is told so, not shown zeros', async () => {
            const zero = { day: { group: 'day', rows: [], totals: { calls: 0, input_tokens: 0, output_tokens: 0, cached_tokens: 0, cache_write_tokens: 0, cost_usd: 0, fee_usd: 0, charged_usd: 0, saved_usd: 0 }, insights: [], source: 'raw' }, surface: { group: 'surface', rows: [] } };
            const d = await boot({ ai: personAi, report: { measuredModel: async () => null, personUsage: async () => zero } });
            try {
                const r = await d.get('/dashboard/usage', { as: user });
                assert.strictEqual(r.status, 200, r.text);
                assert.ok(r.text.includes('No AI calls yet'));
            } finally { await d.close(); }
        });
    } finally { await dashboard.close(); }

    done();
})().catch((err) => { console.error(err); process.exitCode = 1; });
