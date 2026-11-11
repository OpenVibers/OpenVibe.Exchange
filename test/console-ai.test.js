'use strict';
// The owner console's designed AI sections (views/console-ai.js): providers, models and the price book.
const assert = require('assert');
const { providersSection, modelsSection, pricebookSection, supplySection, syncSection } = require('../server/views/console-ai');

const secret = 'sk-live-never-on-a-page';
const providers = [
    { key: 'openai', kind: 'openai', display_name: 'OpenAI', base_url: 'https://api.openai.com/v1', status: 'active', key_present: true, preference_order: 10, markup_percent: 0, provider_access: 'AUTHORIZED_WHOLESALE', health: { state: 'up' }, api_key: secret,
        metadata: { auto_list_new_models: true, model_sync_interval_minutes: 60 },
        key_state: { source: 'stored', hint: '…abcd', set_at: '2026-11-10T00:00:00.000Z' },
        last_check: { ok: false, error: 'http_401', latency_ms: 42, checked_at: '2026-11-10T00:01:00.000Z' } },
    { key: 'venice', display_name: 'Venice AI', base_url: 'https://api.venice.ai/api/v1', status: 'disabled', key_present: false, preference_order: 60, uncensored: true, provider_access: 'UNVERIFIED' },
];
const presets = [
    { key: 'pricey', display_name: 'Pricey', base_url: 'https://api.pricey.example/v1', provider_access: 'UNVERIFIED', models: [{ model_key: 'big', cost: { in_per_mtok: 3, out_per_mtok: 15 } }] },
    { key: 'unpriced', display_name: 'Unpriced', base_url: 'https://api.unpriced.example/v1', provider_access: 'UNVERIFIED', uncensored: true, models: [{ model_key: 'x', cost: { in_per_mtok: null, out_per_mtok: null } }] },
    { key: 'cheap', display_name: 'Cheap', base_url: 'https://api.cheap.example/v1', provider_access: 'UNVERIFIED', models: [{ model_key: 'small', cost: { in_per_mtok: 0.02, out_per_mtok: 0.08 }, source: 'https://cheap.example/pricing', checked: '2026-11-09' }] },
    { key: 'openai', display_name: 'OpenAI', base_url: 'https://api.openai.com/v1', models: [] },
];

const html = providersSection({ providers, models: [], presets });
assert.ok(!html.includes(secret), 'a key value never reaches the page');
assert.ok(html.includes('Key stored') && html.includes('No key'), 'a key is only present or not');
assert.ok(html.includes('18+'), 'the uncensored tier is marked 18+');
assert.ok(html.includes('type="password"'), 'keys are typed into password fields');
assert.ok(html.includes('Key ends in …abcd') && html.includes('set on 2026-11-10'), 'only the key marker and date are rendered');
assert.ok(html.includes('http_401') && html.includes('42 ms'), 'the last check and latency are visible');
assert.ok(html.includes('action="/console/providers/openai/check"') && html.includes('action="/console/providers/openai/remove-key"'), 'explicit check and removal controls');
assert.ok(html.includes('formaction="/console/providers/openai/check"') && html.includes('Check pasted key'), 'the key field can be checked before saving');
assert.ok(html.includes('action="/console/providers/openai/sync"') && html.includes('href="/console/providers/openai/models"'), 'models can be read and opened per provider');
assert.ok(html.includes('name="auto_list_new_models" value="1" checked') && html.includes('value="60" selected'), 'stored model sync preferences render');
const locked = providersSection({ providers: [{ ...providers[0], key_present: false }], models: [], presets: [] });
assert.ok(locked.includes('action="/console/providers/openai/remove-key"'), 'a stored key remains removable when it cannot be decrypted');
const order = ['Cheap', 'Pricey', 'Unpriced'].map((n) => html.indexOf(`<b>${n}</b>`));
assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], 'presets: cheapest first, unpriced last');
assert.ok(!html.includes('<b>OpenAI</b><small>api.openai.com · 0'), 'an added provider is not offered again as a preset');
assert.ok(html.includes('No price confirmed on their own page yet.'), 'a missing price says so');
assert.ok(!/\$0(?!\.)/.test(html), 'a missing price is never $0');
assert.ok(html.includes('From <b>$0.08</b>') && html.includes('href="https://cheap.example/pricing"'), 'the cheapest price with its own page');
assert.ok(!html.includes('ovk-button'), 'kit buttons only');

const models = modelsSection({ models: [
    { provider: 'openai', model: 'gpt-5-mini', accepted_price: { in_per_mtok: 0.25, out_per_mtok: 2 }, owner_override: { cost: { in_per_mtok: 0.2, out_per_mtok: 1.6 }, reason: 'promo' } },
] });
assert.ok(models.includes('Your price') && models.includes('promo'), 'the owner price shows with its reason');
assert.ok(models.includes('name="clear" value="1"'), 'the owner price can be cleared');
assert.ok(models.includes('name="reason" required'), 'a price needs a reason');
assert.ok(models.includes('name="display_name"') && models.includes('name="content_tier"'), 'model names and content tiers are editable');

// The offer's route: waiting prices are approved and the offer switched on in one owner action, and a
// missing key is said before the button rather than after a failed write.
const routed = modelsSection({ models: [
    { provider: 'refuseless', model: 'abliterated-model', accepted_price: { in_per_mtok: 1, out_per_mtok: 3 }, status: 'disabled',
        route: { live: false, reasons: ['provider_off', 'model_off'], key_present: true, pending_prices: 2 } },
    { provider: 'keyless', model: 'abliterated-model', accepted_price: { in_per_mtok: 1, out_per_mtok: 3 }, status: 'disabled',
        route: { live: false, reasons: ['provider_off', 'no_key', 'model_off'], key_present: false, pending_prices: 0 } },
    { provider: 'openai', model: 'gpt-5-mini', accepted_price: { in_per_mtok: 0.25, out_per_mtok: 2 },
        route: { live: true, reasons: [], key_present: true, pending_prices: 0 } },
] });
assert.ok(routed.includes('Not routed') && routed.includes('provider off · model off'), 'the closed gates are named');
assert.ok(routed.includes('action="/console/models/refuseless/abliterated-model/open"'), 'the owner can open the offer');
assert.ok(routed.includes('Approve prices and open route') && routed.includes('2 waiting prices'), 'waiting prices show beside the action');
assert.ok(routed.includes('Add the provider key first'), 'a missing key disables the action with its reason');
assert.ok(routed.includes('Live route') && !routed.includes('action="/console/models/openai/gpt-5-mini/open"'), 'a live route needs no open action');

// GPU supply: fixed per-token prices, the approved ceilings, the selected host and the fixed route it serves.
const supply = supplySection({ gate: { ok: true }, live: true, settings: [{ model: 'deepseek-r1-32b-abliterated', runtime: 'vllm',
    input_per_million: 1, output_per_million: 2, hourly_ceiling_usd: 0.5, monthly_ceiling_usd: 300, required_vram_mb: 24000, idle_minutes: 10, enabled: true }],
    reports: [{ model: 'deepseek-r1-32b-abliterated', enabled: true, active: true, action: 'would_rent', price: { in: 1, out: 2 },
        selected: { provider: 'vast', gpu: 'RTX 4090', region: 'US', hourly_usd: 0.5 }, rental_cost_usd: 12, reseller_cost_usd: null,
        route: { registered: true, provider_key: 'gpu.deepseek-r1-32b-abliterated', provider_status: 'active', model_status: 'active', fixed: true, price: { in: 1, out: 2 }, live: true } }] });
assert.ok(supply.includes('Fixed route live') && supply.includes('gpu.deepseek-r1-32b-abliterated'), 'the fixed route is named');
assert.ok(supply.includes('RTX 4090') && supply.includes('$0.50') && supply.includes('Would rent the selected host'), 'the selected host and the decision');
assert.ok(supply.includes('name="enabled"') && supply.includes('value="1" selected'), 'the owner switch renders on the saved plan');
assert.ok(supply.includes('Type open to confirm a live plan'), 'live supply needs the typed confirmation');
const closed = supplySection({ gate: { ok: false, reason: 'Add a Vast.ai or RunPod API key first; nothing was changed.' }, settings: [], reports: [] });
assert.ok(closed.includes('Gate closed: Add a Vast.ai or RunPod API key first'), 'the owner gate is said in words');
assert.ok(!/\$0(?!\.)/.test(supply), 'a missing price is never $0');

const book = pricebookSection({ pending: [{ id: 'pc_1', provider_key: 'deepseek', model_key: 'v4-flash', field: 'out_per_mtok', old_price: 1.2, new_price: 0.9, change_pct: -0.25, source: 'https://example/pricing', checked_at: '2026-11-09' }], recent: [] });
assert.ok(book.includes('value="approve"'), 'Accept sends approve, the word AI takes');
assert.ok(book.includes('$1.20') && book.includes('$0.90') && book.includes('-25%'), 'old, new and the change');
assert.ok(pricebookSection({ pending: [], recent: [] }).includes('Nothing waiting'), 'an empty price book says so');

// Grouped: a card per provider, one row per model with its prices together, Accept per model, provider and all.
const many = pricebookSection({ pending: [
    { id: 'pc_a', provider_key: 'deepinfra', model_key: 'qwen3-14b', field: 'in_per_mtok', old_price: null, new_price: 0.06, source: 'https://deepinfra.com/pricing', checked_at: '2026-11-10' },
    { id: 'pc_b', provider_key: 'deepinfra', model_key: 'qwen3-14b', field: 'out_per_mtok', old_price: null, new_price: 0.24, source: 'https://deepinfra.com/pricing', checked_at: '2026-11-10' },
    { id: 'pc_c', provider_key: 'deepinfra', model_key: 'gpt-oss-120b', field: 'out_per_mtok', old_price: null, new_price: 0.17, checked_at: '2026-11-10' },
    { id: 'pc_d', provider_key: 'sambanova', model_key: 'gpt-oss-120b', field: 'in_per_mtok', old_price: 0.3, new_price: 0.22, change_pct: -0.2667, checked_at: '2026-11-10' },
], recent: [] });
assert.equal((many.match(/class="exc-pb-prov"/g) || []).length, 2, 'one card per provider');
assert.equal((many.match(/class="exc-pb-model"/g) || []).length, 3, 'one row per model');
assert.ok(many.includes('name="ids" value="pc_a,pc_b"'), 'a model row decides its prices together');
assert.ok(many.includes('Accept all 2</button>'), 'a provider with several models can be accepted at once');
assert.ok(many.includes('Accept all 4 prices') && many.includes('name="ids" value="pc_a,pc_b,pc_c,pc_d"'), 'everything waiting can be accepted at once');
assert.ok(many.includes('3 models from 2 providers: 2 new to OpenVibe'), 'the summary counts models and the new ones');
assert.ok(many.includes('<s>$0.30</s><b>$0.22</b><i>-27%</i>'), 'a changed price shows old, new and the change');
assert.ok(!/action="\/console\/pricebook\/changes\//.test(many), 'the waiting list decides through the grouped route');
const sync = syncSection({ sync_log: [{ provider_key: 'gemini', started_at: '2026-11-11', status: 'succeeded',
    added: 1, updated: 0, missing: 1, added_models: ['gemini-new'], missing_models: ['gemini-old'] }] });
assert.ok(sync.includes('New model') && sync.includes('gemini-new') && sync.includes('Retired model') && sync.includes('gemini-old'));
assert.ok(sync.includes('/models/gemini%2Fgemini-new'));
console.log('console-ai: providers, models, sync events and the price book passed');
