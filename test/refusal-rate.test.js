'use strict';
/**
 * The measured refusal rate on an offer, and the day it was measured.
 *
 * The rate is measured by OpenVibe.AI on a published probe set and travels on the catalog's offer. The page
 * shows it with the day it was measured: a share without its date would look current when it may be weeks
 * old. An offer nobody measured shows no rate at all.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');

const offer = {
    provider: 'shared', provider_name: 'Shared provider', model: 'deepseek-chat', id: 'deepseek/deepseek-chat@v1',
    trust: 'first-party', free: false, price: { in: 0.2, out: 0.3 }, speed: { p50_ms: 400, p95_ms: 800 },
    uptime: 0.99, requests_7d: 5, data_policy: { trains: false, retention_days: 0 },
};
const model = {
    slug: 'deepseek/deepseek-chat', canonical: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', family: 'DeepSeek',
    kind: 'chat', capabilities: {}, requests_7d: 5, offers: [offer],
};
const catalogWith = (o) => async () => ({ generated_at: '', models: [{ ...model, offers: [o] }], families: [], count: 1 });

(async () => {
    const c = await boot({ ai: { ...createFakeAi(), catalog: catalogWith({ ...offer, refusal_rate: 0.25, refusal_measured_on: '2026-11-07' }) } });
    try {
        await check('an offer shows its refusal rate with the day it was measured', async () => {
            const r = await c.get('/m/deepseek/deepseek-chat');
            assert.strictEqual(r.status, 200, r.text);
            assert.ok(r.text.includes('refuses 25.0%'), 'the rate is shown as a percentage');
            assert.ok(r.text.includes('measured 2026-11-07'), 'and with the day it was measured');
        });
    } finally { await c.close(); }

    const u = await boot({ ai: { ...createFakeAi(), catalog: catalogWith({ ...offer, refusal_rate: null, refusal_measured_on: null }) } });
    try {
        await check('an offer nobody measured shows no rate at all', async () => {
            const r = await u.get('/m/deepseek/deepseek-chat');
            assert.strictEqual(r.status, 200, r.text);
            assert.ok(!/refuses \d/.test(r.text), 'no rate is shown for an offer nobody measured');
        });
    } finally { await u.close(); }

    done();
})();
