'use strict';
const assert = require('node:assert/strict');
const { createAi } = require('../server/ai');
const views = require('../server/views/exchange');

const response = (status, value) => new Response(JSON.stringify(value), {
    status, headers: { 'Content-Type': 'application/json' },
});
const config = {
    networkInternalUrl: 'http://network.test',
    oauth: { clientId: 'exchange', clientSecret: 'test-client-secret', consoleScope: 'ai.usage.read' },
    ai: { url: 'http://ai.test', audience: 'openvibe.ai', scope: 'ai.run.create', waitMs: 5000, timeoutMs: 10000 },
};

async function one(receiptStatus) {
    const calls = [];
    const ai = createAi({ config, fetchImpl: async (url, opts = {}) => {
        const address = String(url);
        calls.push({ address, method: opts.method || 'GET' });
        if (address.endsWith('/oauth/token')) return response(200, { access_token: 'test-token', token_type: 'Bearer', expires_in: 300 });
        if (address.includes('/api/v1/runs?wait=')) return response(200, { run: {
            id: 'run_TEST', status: 'succeeded', output: { model: 'small', choices: [{ message: { content: 'Hello' } }] },
            provenance: { provider: 'local' }, usage: { tokens_in: 100, tokens_out: 20, cost_usd: 0.01 },
        } });
        if (address.endsWith('/api/v1/receipts/rcpt_TEST')) return response(receiptStatus, receiptStatus === 200
            ? { receipt: { run_id: 'run_TEST', usage: { tokens_in: 100, tokens_cached: 30 } } }
            : { code: 'ai.receipt_not_found' });
        throw new Error('unexpected request');
    }, log: { warn() {} } });
    const result = await ai.chat({ model: 'small', messages: [{ role: 'user', content: 'Hi' }], subject: 'usr_TEST' });
    return { result, calls };
}

(async () => {
    const { result, calls } = await one(200);
    assert.equal(result.content, 'Hello');
    assert.equal(result.tokens_cached, 30);
    assert.equal(result.cached_input_percent, 30);
    assert.ok(calls.some((c) => c.address.endsWith('/api/v1/receipts/rcpt_TEST')));
    assert.match(views.whyPage({ result, catalog: { models: [] } }), /Cached input<\/dt><dd>30%/);

    const missing = await one(404);
    assert.equal(missing.result.content, 'Hello', 'a missing receipt must not lose the answer');
    assert.equal(missing.result.cached_input_percent, null);
    console.log('AI receipt: cached input share is shown; a missing receipt leaves the answer usable');
})().catch((error) => { console.error(error); process.exitCode = 1; });
