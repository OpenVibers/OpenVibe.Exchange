'use strict';
/**
 * A stand-in OpenVibe.AI client for the page tests: the shape of GET /api/v1/exchange/catalog and /usage, and a
 * chat that answers in the run's voice. It records every chat call so a test can assert what was sent.
 */
function createFakeAi({ chat = null, community = [] } = {}) {
    const calls = [];
    const catalog = {
        generated_at: '2026-11-06T09:00:00.000Z', window_days: 7, count: 3,
        families: [{ name: 'DeepSeek', models: 1, offers: 2 }, { name: 'Qwen', models: 1, offers: 1 }, { name: 'Llama', models: 1, offers: 1 }],
        models: [
            {
                slug: 'deepseek/deepseek-chat', canonical: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', family: 'DeepSeek',
                variant: null, uncensored: false, type: 'chat', context: 131072, max_output: 8192,
                capabilities: { tools: true, json: true, vision: false, stream: true }, modalities: ['text'], description: null,
                requests_7d: 120, requests_today: 20, community: false,
                offers: [
                    {
                        provider: 'deepseek', provider_name: 'DeepSeek', model: 'deepseek-chat', id: 'deepseek/deepseek-chat@v1',
                        trust: 'first-party', access: 'OWN_DEPLOYMENT', free: false, free_tier: true,
                        price: { in: 0.28, out: 0.42, cached: 0.028, per: '1M tokens', currency: 'USD' },
                        speed: { p50_ms: 400, p95_ms: 900 }, uptime: 0.99, requests_7d: 100, requests_today: 15,
                        data_policy: { trains: false, retention_days: 0, region: 'cn' }, updated_at: null,
                    },
                    {
                        provider: 'deepinfra', provider_name: 'DeepInfra', model: 'deepseek-chat', id: 'deepseek/deepseek-chat@v1',
                        trust: 'first-party', access: 'AUTHORIZED_WHOLESALE', free: false,
                        price: { in: 0.2, out: 0.3, cached: 0.02, per: '1M tokens', currency: 'USD' },
                        speed: { p50_ms: 700, p95_ms: 2000 }, uptime: 0.9, requests_7d: 20, requests_today: 5,
                        data_policy: null, updated_at: null,
                    },
                ],
            },
            {
                slug: 'qwen/qwen3-32b', canonical: 'qwen/qwen3-32b', name: 'Qwen3 32B', family: 'Qwen',
                variant: null, uncensored: false, type: 'chat', context: 131072, max_output: 8192,
                capabilities: { tools: true, json: true, vision: false, stream: true }, modalities: ['text'], description: null,
                requests_7d: 40, requests_today: 3, community: false,
                offers: [{
                    provider: 'novita', provider_name: 'Novita', model: 'qwen3-32b', id: 'qwen/qwen3-32b@v1',
                    trust: 'first-party', access: 'AUTHORIZED_WHOLESALE', free: false,
                    price: { in: 0.4, out: 0.9, cached: 0.04, per: '1M tokens', currency: 'USD' },
                    speed: { p50_ms: 520, p95_ms: 1200 }, uptime: 0.97, requests_7d: 40, requests_today: 3,
                    data_policy: { trains: false, retention_days: 30, region: 'sg' }, updated_at: '2026-11-06T00:00:00.000Z',
                }],
            },
            {
                slug: 'meta-llama/llama-3-8b-abliterated', canonical: 'meta-llama/llama-3-8b-abliterated', name: 'Llama 3 8B abliterated',
                family: 'Llama', variant: 'abliterated', uncensored: true, type: 'chat', context: 8192, max_output: 4096,
                capabilities: { tools: false, json: false, vision: false, stream: true }, modalities: ['text'], description: null,
                requests_7d: 12, requests_today: 2, community: true,
                offers: [{
                    provider: 'owner-box', provider_name: 'Owner’s machine', model: 'llama-3-8b-abliterated', id: null,
                    trust: 'community', access: 'OWN_DEPLOYMENT', free: true, price: null,
                    speed: { p50_ms: 900, p95_ms: 2400 }, uptime: 0.97, requests_7d: 12, requests_today: 2,
                    data_policy: null, updated_at: null,
                }],
            },
        ],
    };
    const usage = {
        generated_at: '2026-11-06T09:00:00.000Z', days: 30, from: '2026-10-07', to: '2026-11-06',
        today: { requests: 8, tokens_in: 800, tokens_out: 200, cost_usd: 0.0012 },
        totals: { requests: 40, tokens_in: 4000, tokens_out: 1000, cost_usd: 0.006 },
        by_day: [{ day: '2026-11-05', requests: 20, tokens_in: 2000, tokens_out: 500, cost_usd: 0.003 }, { day: '2026-11-06', requests: 8, tokens_in: 800, tokens_out: 200, cost_usd: 0.0012 }],
        by_model: [{ provider: 'deepseek', model: 'deepseek-chat', requests: 40, tokens_in: 4000, tokens_out: 1000, cost_usd: 0.006 }],
        by_product: [{ product: 'live', requests: 30, tokens_in: 3000, tokens_out: 800, cost_usd: 0.005, models: [{ provider: 'deepseek', model: 'deepseek-chat', requests: 30 }] }],
    };
    const communityData = { generated_at: '2026-11-06T09:00:00.000Z', offers: community };
    return {
        calls,
        configured: true,
        // AI's search engines as GET /api/v1/exchange/search/engines answers them.
        async searchEngines() {
            return [
                { id: 'openvibe', kinds: ['web'], price_per_1000: 0, byok: false, available: true, healthy: true },
                { id: 'searxng', kinds: ['web'], price_per_1000: 0, byok: false, available: false, healthy: true },
                { id: 'openverse', kinds: ['images'], price_per_1000: 0, byok: false, available: true, healthy: true },
                { id: 'commons', kinds: ['images'], price_per_1000: 0, byok: false, available: true, healthy: true },
                { id: 'iconify', kinds: ['icons'], price_per_1000: 0, byok: false, available: true, healthy: true },
            ];
        },
        async catalog() { return catalog; },
        async usage() { return usage; },
        async communityOffers() { return communityData; },
        async ownStatus() { return { enabled: false, reason: 'The owner has not added a GPU provider key yet, so no endpoint can start.', models: [], idle_minutes: 10, public_base: 'https://ai.openvibe.services/api/v1/own-endpoints' }; },
        async ownList() { return { endpoints: [] }; },
        async chat(args) {
            calls.push(args);
            if (chat) return chat(args);
            return {
                content: `An answer from ${args.model}.`, model: args.model, provider: 'deepseek', run_id: 'run_TEST', cost_usd: 0.00012,
                usage: { tokens_in: 10, tokens_out: 20 }, tokens_in: 10, tokens_out: 20, latency_ms: 420,
                why: ['cheapest healthy offer within your ceiling'],
                explain: {
                    objective: 'balanced',
                    reasons: ['cheapest healthy offer within your ceiling', 'the provider answered and the latency is measured'],
                    selected: 'deepseek/deepseek-chat',
                    candidates: [
                        { provider: 'deepseek', model: 'deepseek-chat', eligible: true, excluded_reason: null, cost: 0.00012, latency: 420 },
                        { provider: 'deepinfra', model: 'deepseek-chat', eligible: false, excluded_reason: 'over your price ceiling', cost: 0.0003, latency: 700 },
                    ],
                },
            };
        },
        catalogData: catalog,
        usageData: usage,
        communityData,
    };
}

const downAi = {
    configured: false,
    async catalog() { return { generated_at: '2026-11-06T09:00:00.000Z', unavailable: true, count: 0, models: [], families: [], what: 'catalog' }; },
    async usage() { return { generated_at: '2026-11-06T09:00:00.000Z', unavailable: true, days: 30, by_day: [], by_model: [], by_product: [], today: null, totals: null, what: 'usage' }; },
    async communityOffers() { return { generated_at: '2026-11-06T09:00:00.000Z', unavailable: true, offers: [] }; },
    async chat() { const e = new Error('AI is not configured for this service'); e.code = 'ai.not_configured'; e.status = 503; throw e; },
};

module.exports = { createFakeAi, downAi };
