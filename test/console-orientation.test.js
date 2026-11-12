'use strict';
/**
 * The picture-orientation console: owner only, the detector's setting in plain kit markup, the save that reaches
 * AI's `pics.orientation` task defaults, and the "try a picture" check that is one real run with its receipt.
 */
const assert = require('assert');
const express = require('express');
const { createServer } = require('http');
const { createConsoleRoutes } = require('../server/http/console');

const calls = [];
const setting = { method: 'off', confidence: 0.8, daily_cap: 50, budget_usd_per_day: 0.25, model: { model: 'openvibe/auto', source: 'openvibe' }, max_cost_usd: 0.05 };
const app = express();
app.use((req, res, next) => {
    if (req.get('x-role')) req.viewer = { kind: 'user', subject: 'usr_01ARZ3NDEKTSV4RRFFQ69G5FAV', role: req.get('x-role'), token: 'test-session' };
    next();
});
app.use(createConsoleRoutes({
    config: { baseUrl: 'https://openvibe.exchange' },
    ai: {
        adminRequest: async (path, options) => {
            calls.push({ kind: 'admin', path, options });
            if (path === '/api/v1/admin/orientation') {
                return { setting, today: { runs: 3, cost_usd: 0.0123 }, recent: [{ run_id: 'run_1', status: 'succeeded', created_at: '2026-11-11T20:00:00.000Z', rotation: 90, confidence: 0.93, provider: 'seam', model: 'see', cost_usd: 0.0014, receipt_id: 'rcpt_1' }] };
            }
            return {};
        },
        meRequest: async (token, path, options) => {
            calls.push({ kind: 'me', token, path, options });
            if (path === '/api/v1/admin/task-defaults') return { defaults: { 'pics.orientation': setting } };
            if (path.startsWith('/api/v1/choices?task=')) return { options: { openvibe: [{ model: 'openvibe/auto', source: 'openvibe', name: 'Let OpenVibe choose', price_estimate_usd: null }, { model: 'openai/gpt-5-nano', source: 'openvibe', name: 'GPT-5 nano', price_estimate_usd: 0.0002, adult: false }] } };
            if (path === '/api/v1/vision/orientation') return { method: 'vision', answered: true, rotation: 90, confidence: 0.93, model: 'gpt-5-nano', cost_usd: 0.0002, receipt_id: 'rcpt_test' };
            return {};
        },
    },
}));

(async () => {
    const server = createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + server.address().port;
    const owner = { 'x-role': 'owner' };
    try {
        for (const role of ['', 'user', 'admin']) {
            assert.strictEqual((await fetch(base + '/console/orientation', { headers: role ? { 'x-role': role } : {} })).status, role ? 403 : 404, `${role || 'signed out'} is not the owner`);
        }
        const page = await fetch(base + '/console/orientation', { headers: owner });
        const html = await page.text();
        assert.strictEqual(page.status, 200);
        assert.ok(html.includes('<h2>Picture orientation</h2>'), 'the section names itself');
        assert.ok(html.includes('name="method"') && html.includes('value="vision"'), 'the method is a plain radio choice');
        assert.ok(html.includes('name="model"') && html.includes('GPT-5 nano'), 'the model choice is listed');
        assert.ok(html.includes('name="confidence"') && html.includes('name="daily_cap"') && html.includes('name="budget_usd_per_day"'), 'confidence and both daily bounds are set here');
        assert.ok(html.includes('3 pictures looked at') && html.includes('$0.0123'), "today's count and spend are shown");
        assert.ok(html.includes('rcpt_1') && html.includes('turn 90° clockwise'), 'the last tries show the answer and receipt');
        assert.ok(html.includes('data-orientation-file') && html.includes('Try a picture'), 'the check is here');
        assert.ok(html.includes('action="/console/orientation"') && html.includes('class="ovk-btn ovk-btn--primary"'), 'plain kit markup');

        const body = new URLSearchParams({ method: 'vision', model: JSON.stringify({ model: 'openai/gpt-5-nano', source: 'openvibe' }), confidence: '0.9', daily_cap: '100', budget_usd_per_day: '0.5' });
        assert.strictEqual((await fetch(base + '/console/orientation', { method: 'POST', headers: { ...owner, 'Content-Type': 'application/x-www-form-urlencoded' }, body })).status, 403, 'cross-site is refused');
        const saved = await fetch(base + '/console/orientation', { method: 'POST', redirect: 'manual', headers: { ...owner, Origin: 'https://openvibe.exchange', 'Content-Type': 'application/x-www-form-urlencoded' }, body });
        assert.strictEqual(saved.status, 303);
        const value = calls.at(-1).options.body.defaults[0].value;
        assert.deepStrictEqual([value.method, value.signed_in.model, value.confidence, value.daily_cap, value.budget_usd_per_day], ['vision', 'openai/gpt-5-nano', 0.9, 100, 0.5]);
        assert.strictEqual(value.signed_out.model, 'openai/gpt-5-nano', 'the model choice is the signed-out and signed-in default');

        const tried = await fetch(base + '/console/orientation/try', { method: 'POST', headers: { ...owner, Origin: 'https://openvibe.exchange', 'Content-Type': 'application/json' }, body: JSON.stringify({ image: { data_url: 'data:image/jpeg;base64,aGk=' } }) });
        assert.strictEqual(tried.status, 200);
        const answer = await tried.json();
        assert.deepStrictEqual([answer.rotation, answer.receipt_id], [90, 'rcpt_test']);
        assert.ok(calls.some((c) => c.kind === 'me' && c.path === '/api/v1/vision/orientation' && c.options.body.image.data_url.startsWith('data:image/jpeg')), 'the picture reaches AI as a data URL');
        console.log('Orientation console: owner-only, setting saved into AI defaults, try is a real run');
    } finally {
        await new Promise((r) => server.close(r));
    }
})().catch((e) => { console.error(e); process.exitCode = 1; });
