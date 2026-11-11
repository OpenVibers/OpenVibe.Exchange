'use strict';
/**
 * openvibe.compare's API (plan 296/297/300/301).
 *
 * The comparison is a join of two reads: AI's catalogue (price, speed, privacy, tier) and Bench's boards
 * (quality). These tests hold both stand-ins fixed and check the shape, the dates, the version deltas, the
 * two-to-four side-by-side, and the remark that becomes a pending case and nothing more until the owner reviews it.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');
const { createFakeBench } = require('./helpers/bench');

(async () => {
    const ai = createFakeAi();
    // A fourth and a fifth model on one line, so versions have something to compare.
    ai.catalogData.models.push(
        {
            slug: 'openai/gpt-5-mini', canonical: 'openai/gpt-5-mini', name: 'gpt-5-mini', family: 'GPT', variant: null,
            uncensored: false, kind: 'chat', context: 400000, max_output: 128000, open_weights: false,
            capabilities: { tools: true, json: true, vision: true, stream: true }, modalities: ['text', 'image'], description: null,
            requests_7d: 50, requests_today: 4, community: false,
            offers: [{
                provider: 'openai', provider_name: 'OpenAI', model: 'gpt-5-mini', id: 'openai/gpt-5-mini@v1', trust: 'first-party',
                access: 'OWN_DEPLOYMENT', free: false, free_tier: false, status: 'up',
                price: { in: 0.25, out: 2, cached: 0.025, per: '1M tokens', currency: 'USD' },
                speed: { p50_ms: 900, p95_ms: 3000 }, uptime: 0.99, requests_7d: 50, requests_today: 4,
                privacy: { label: 'anonymized', retention: '0', training: false, region: 'us', known: true },
                updated_at: '2026-11-06T00:00:00.000Z',
            }],
        },
        {
            slug: 'openai/gpt-5.1-mini', canonical: 'openai/gpt-5.1-mini', name: 'gpt-5.1-mini', family: 'GPT', variant: null,
            uncensored: false, kind: 'chat', context: 400000, max_output: 128000, open_weights: false,
            capabilities: { tools: true, json: true, vision: true, stream: true }, modalities: ['text', 'image'], description: null,
            requests_7d: 80, requests_today: 6, community: false,
            offers: [{
                provider: 'openai', provider_name: 'OpenAI', model: 'gpt-5.1-mini', id: 'openai/gpt-5.1-mini@v1', trust: 'first-party',
                access: 'OWN_DEPLOYMENT', free: false, free_tier: false, status: 'up',
                price: { in: 0.2, out: 1.5, cached: 0.02, per: '1M tokens', currency: 'USD' },
                speed: { p50_ms: 700, p95_ms: 2400 }, uptime: 0.995, requests_7d: 80, requests_today: 6,
                privacy: { label: 'anonymized', retention: '0', training: false, region: 'us', known: true },
                updated_at: '2026-11-06T00:00:00.000Z',
            }],
        },
    );
    ai.catalogData.count = ai.catalogData.models.length;
    // AI's offer carries its own privacy label and the tier fields; the page must not invent one.
    ai.catalogData.models[0].offers[0].privacy = { label: 'anonymized', retention: '0', training: false, region: 'cn', known: true };
    ai.catalogData.models[0].offers[0].on_our_gpus = false;
    ai.catalogData.models[0].offers[1].on_our_gpus = false;

    const bench = createFakeBench({
        boards: {
            'chat.arena': [
                { subject: 'deepseek/deepseek-chat', elo: 1040, games: 20, wins: 12, losses: 6, ties: 2, win_rate: 0.65, ci_lower: 1020, ci_upper: 1060, provisional: false },
                { subject: 'qwen/qwen3-32b', elo: 990, games: 12, wins: 5, losses: 6, ties: 1, win_rate: 0.46, ci_lower: 970, ci_upper: 1010, provisional: false },
                { subject: 'openai/gpt-5-mini', elo: 1100, games: 30, wins: 20, losses: 8, ties: 2, win_rate: 0.7, ci_lower: 1080, ci_upper: 1120, provisional: false },
                { subject: 'openai/gpt-5.1-mini', elo: 1120, games: 30, wins: 22, losses: 6, ties: 2, win_rate: 0.77, ci_lower: 1125, ci_upper: 1145, provisional: false },
            ],
        },
    });

    const t = await boot({ ai, bench });
    const owner = t.network.addUser('owner', { role: 'owner' });
    const reader = t.network.addUser('reader');

    try {
        await check('the index names the kind, the sources and the method', async () => {
            const r = await t.get('/api/v1/compare');
            assert.strictEqual(r.status, 200, r.text);
            const body = r.json();
            assert.strictEqual(body.kind, 'compare');
            assert.strictEqual(body.kinds[0].id, 'ai.models');
            assert.ok(body.method.price && body.method.quality && body.method.versions);
        });

        await check('the models list is priced per provider, dated, and honest about missing quality', async () => {
            const r = await t.get('/api/v1/compare/ai/models');
            assert.strictEqual(r.status, 200, r.text);
            const body = r.json();
            assert.strictEqual(body.kind, 'ai.models');
            assert.strictEqual(body.total, 5);
            assert.deepStrictEqual(body.sources.map((s) => s.service), ['OpenVibe.AI', 'OpenVibe.Bench']);
            const deep = body.models.find((m) => m.slug === 'deepseek/deepseek-chat');
            assert.ok(deep, 'DeepSeek is listed');
            assert.strictEqual(deep.price.in, 0.2, 'the cheapest offer wins the headline');
            assert.strictEqual(deep.price.out, 0.3);
            assert.strictEqual(deep.price.provider, 'DeepInfra');
            assert.strictEqual(deep.speed.p50_ms, 400);
            assert.strictEqual(deep.quality.available, true);
            assert.strictEqual(deep.quality.score, 1040);
            assert.strictEqual(deep.quality.games, 20);
            assert.strictEqual(deep.measured_at, '2026-11-06T09:00:00.000Z', 'the AI read carries its date');
            assert.ok(deep.privacy.label, 'a privacy label is read, not invented');
            assert.strictEqual(deep.tiers['first-party'], 2);
            const llama = body.models.find((m) => m.slug === 'meta-llama/llama-3-8b-abliterated');
            assert.strictEqual(llama.quality.available, false);
            assert.match(llama.quality.reason, /No public Bench rounds/);
            assert.strictEqual(llama.quality.score, null, 'no invented score');
        });

        await check('one model carries its whole price book, quality by board, and its line', async () => {
            const r = await t.get('/api/v1/compare/ai/models/deepseek/deepseek-chat');
            assert.strictEqual(r.status, 200, r.text);
            const body = r.json();
            assert.strictEqual(body.model.slug, 'deepseek/deepseek-chat');
            assert.strictEqual(body.offers.length, 2);
            assert.deepStrictEqual(body.offers.map((o) => o.price.in).sort((a, b) => a - b), [0.2, 0.28]);
            assert.strictEqual(body.offers.find((o) => o.provider === 'deepseek').tier, 'first-party');
            assert.strictEqual(body.quality.by_benchmark.length, 1);
            assert.strictEqual(body.versions, null, 'a model with one version has no version table');
            assert.ok(body.alternatives.length >= 1);
            const missing = await t.get('/api/v1/compare/ai/models/nope/nothing');
            assert.strictEqual(missing.status, 404);
            assert.strictEqual(missing.json().code, 'compare.model_not_found');
        });

        await check('two to four models are compared on every criterion, with a per-criterion winner', async () => {
            const r = await t.get('/api/v1/compare/ai?models=openai/gpt-5.1-mini,deepseek/deepseek-chat,qwen/qwen3-32b');
            assert.strictEqual(r.status, 200, r.text);
            const body = r.json();
            assert.strictEqual(body.models.length, 3);
            assert.deepStrictEqual(body.models.map((m) => m.slug), ['openai/gpt-5.1-mini', 'deepseek/deepseek-chat', 'qwen/qwen3-32b']);
            const price = body.criteria.find((c) => c.key === 'price_out');
            assert.strictEqual(price.winner, 'deepseek/deepseek-chat', '0.3 output is the cheapest');
            const speed = body.criteria.find((c) => c.key === 'p50_ms');
            assert.strictEqual(speed.winner, 'deepseek/deepseek-chat');
            const quality = body.criteria.find((c) => c.key === 'elo');
            assert.strictEqual(quality.winner, 'openai/gpt-5.1-mini');
            assert.ok(body.price_spread, 'the price spread is said');
            assert.ok(body.verdict.headline.includes('cheapest'));
            assert.ok(body.verdict.caveat.includes('never one invented overall score'));

            const one = await t.get('/api/v1/compare/ai?models=deepseek/deepseek-chat');
            assert.strictEqual(one.status, 400);
            assert.strictEqual(one.json().code, 'compare.selection');
            const five = await t.get('/api/v1/compare/ai?models=a,b,c,d,e');
            assert.strictEqual(five.status, 400);
            const none = await t.get('/api/v1/compare/ai?models=deepseek/deepseek-chat,nope/nothing');
            assert.strictEqual(none.status, 404);
        });

        await check('versions of one line are ordered and each says what changed, with the interval caveat', async () => {
            const r = await t.get('/api/v1/compare/ai/versions');
            assert.strictEqual(r.status, 200, r.text);
            const body = r.json();
            const line = body.lineages.find((l) => l.key === 'gpt-mini');
            assert.ok(line, `gpt-mini line in ${body.lineages.map((l) => l.key).join(',')}`);
            assert.deepStrictEqual(line.models.map((m) => m.name), ['gpt-5-mini', 'gpt-5.1-mini']);
            const newer = line.models[1];
            const priceIn = newer.changes.changes.find((c) => c.key === 'price_in');
            assert.strictEqual(priceIn.from, 0.25);
            assert.strictEqual(priceIn.to, 0.2);
            assert.strictEqual(priceIn.direction, 'better');
            const speed = newer.changes.changes.find((c) => c.key === 'p50_ms');
            assert.strictEqual(speed.direction, 'better');
            const elo = newer.changes.changes.find((c) => c.key === 'elo');
            assert.strictEqual(elo.direction, 'better');
            assert.strictEqual(newer.changes.quality.meaningful, true);
            assert.match(newer.changes.summary, /better/);

            const one = await t.get('/api/v1/compare/ai/versions/gpt-mini');
            assert.strictEqual(one.status, 200);
            assert.strictEqual(one.json().lineages.length, 1);
            const missing = await t.get('/api/v1/compare/ai/versions/nope');
            assert.strictEqual(missing.status, 404);
        });

        let remarkId;
        await check('a reader’s remark becomes a pending benchmark case, not a result', async () => {
            const r = await t.get('/api/v1/compare/remarks', {
                json: {
                    models: ['openai/gpt-5.1-mini', 'deepseek/deepseek-chat'],
                    comparison: 'openai/gpt-5.1-mini-vs-deepseek/deepseek-chat',
                    field: 'quality',
                    remark: 'On a long refactor the newer mini kept the whole file in view where the other dropped the last function.',
                },
            });
            assert.strictEqual(r.status, 201, r.text);
            const body = r.json();
            remarkId = body.remark.id;
            assert.match(remarkId, /^excr_/);
            assert.strictEqual(body.remark.status, 'pending');
            assert.deepStrictEqual(body.remark.models, ['openai/gpt-5.1-mini', 'deepseek/deepseek-chat']);
            assert.strictEqual(body.remark.subject, null, 'an anonymous remark stores no person');
            assert.match(body.remark.proposed_prompt, /^Test gpt-5\.1-mini, DeepSeek Chat:/);
            assert.match(body.next, /nothing runs or publishes/);

            const short = await t.get('/api/v1/compare/remarks', { json: { models: ['deepseek/deepseek-chat'], remark: 'too short' } });
            assert.strictEqual(short.status, 400);
            const unknown = await t.get('/api/v1/compare/remarks', { json: { models: ['nope/nothing'], remark: 'A remark of enough length.' } });
            assert.strictEqual(unknown.status, 400);
            const badField = await t.get('/api/v1/compare/remarks', { json: { models: ['deepseek/deepseek-chat'], field: 'vibes', remark: 'A remark of enough length.' } });
            assert.strictEqual(badField.status, 400);
        });

        await check('the pending queue is the owner’s, and reviewing it is the only thing that moves a case', async () => {
            const anon = await t.get('/api/v1/compare/remarks');
            assert.strictEqual(anon.status, 401);
            const normal = await t.get('/api/v1/compare/remarks', { as: reader });
            assert.strictEqual(normal.status, 403);
            const pending = await t.get('/api/v1/compare/remarks', { as: owner });
            assert.strictEqual(pending.status, 200, pending.text);
            assert.strictEqual(pending.json().count, 1);
            assert.strictEqual(pending.json().remarks[0].id, remarkId);

            const accepted = await t.get(`/api/v1/compare/remarks/${remarkId}`, { as: owner, method: 'PATCH', json: { decision: 'accepted', note: 'A real case: hold the file at 8k tokens.' } });
            assert.strictEqual(accepted.status, 200, accepted.text);
            assert.strictEqual(accepted.json().remark.status, 'accepted');
            assert.strictEqual(accepted.json().remark.reviewer_note, 'A real case: hold the file at 8k tokens.');
            const again = await t.get(`/api/v1/compare/remarks/${remarkId}`, { as: owner, method: 'PATCH', json: { decision: 'rejected' } });
            assert.strictEqual(again.status, 404, 'only a pending case can be reviewed');
            const noneLeft = await t.get('/api/v1/compare/remarks', { as: owner });
            assert.strictEqual(noneLeft.json().count, 0);
        });

        await check('Exchange v1 still answers its 410 elsewhere, so the compare API is not a hole', async () => {
            const r = await t.get('/api/v1/listings');
            assert.strictEqual(r.status, 410);
            const posted = await t.get('/api/v1/compare/remarks', { json: { models: [], remark: 'A remark long enough to pass.' } });
            assert.strictEqual(posted.status, 400);
        });
    } finally {
        await t.close();
    }
    done();
})();
