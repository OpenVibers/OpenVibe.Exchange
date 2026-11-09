'use strict';
// The owner console's designed AI sections (views/console-ai.js): providers, models and the price book.
const assert = require('assert');
const { providersSection, modelsSection, pricebookSection } = require('../server/views/console-ai');

const secret = 'sk-live-never-on-a-page';
const providers = [
    { key: 'openai', display_name: 'OpenAI', base_url: 'https://api.openai.com/v1', status: 'active', key_present: true, preference_order: 10, markup_percent: 0, provider_access: 'AUTHORIZED_WHOLESALE', health: { state: 'up' }, api_key: secret },
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

const book = pricebookSection({ pending: [{ id: 'pc_1', provider_key: 'deepseek', model_key: 'v4-flash', field: 'out_per_mtok', old_price: 1.2, new_price: 0.9, change_pct: -0.25, source: 'https://example/pricing', checked_at: '2026-11-09' }], recent: [] });
assert.ok(book.includes('value="approve"'), 'Accept sends approve, the word AI takes');
assert.ok(book.includes('$1.20') && book.includes('$0.90') && book.includes('-25%'), 'old, new and the change');
assert.ok(pricebookSection({ pending: [], recent: [] }).includes('Nothing waiting'), 'an empty price book says so');
console.log('console-ai: providers, models and the price book passed');
