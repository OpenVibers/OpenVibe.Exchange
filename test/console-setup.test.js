'use strict';
/**
 * The console's Setup section (plan §AD.9, "one API, two doors"): AI's setup state, the one Network's /admin/ai/setup
 * reads, drawn as every job with what it runs on, its state, this month's spend and its cap, and the pictures each
 * person may make a day. A cap and the pictures a day are saved through the same API; cross-site posts are refused.
 */
const assert = require('assert');
const express = require('express');
const { createServer } = require('http');
const { createConsoleRoutes } = require('../server/http/console');
const { setupSection } = require('../server/views/console-ai');

const state = {
    summary: { ready: 1, total: 2 },
    free: { pictures_per_day: 24, pictures_set: true, pictures_default: 24 },
    steps: [
        { id: 'chat', name: 'Chat and writing', what: 'Turns text into an answer.', ready: true, state: 'ready', current: { provider: 'shared', model: 'gpt-5-nano' },
            recommended: { provider: 'shared', model: 'gpt-5-nano', label: 'GPT-5 nano' }, month_usd: 3.2, estimated_month_usd: 9.1, cap_usd: 40 },
        { id: 'image', name: 'Pictures', ready: false, state: 'not_set', current: { provider: null, model: null }, recommended: { provider: 'fal', model: 'flux', label: 'FLUX' }, month_usd: 0, estimated_month_usd: 0, cap_usd: null },
    ],
};

// The section itself.
const html = setupSection(state);
assert.match(html, /1 of 2 jobs are ready/);
assert.match(html, /href="https:\/\/openvibe\.network\/admin\/ai\/setup"/, 'keys and providers: linked to Network\'s setup');
assert.match(html, /<b>Chat and writing<\/b>/);
assert.match(html, /<td>GPT-5 nano<\/td>/, 'what the job runs on, by name');
assert.match(html, /Ready<\/span>/);
assert.match(html, /Needs a key<\/span>/, 'a job without a key says so in words');
assert.match(html, /action="\/console\/setup\/caps\/chat"[^>]*>.*name="cap_usd"[^>]*value="40"/s);
assert.match(html, /name="cap_usd"[^>]*value="" placeholder="No cap"/, 'no cap shows as empty');
assert.match(html, /action="\/console\/setup\/free\/pictures"/);
assert.match(html, /id="free-pictures" name="per_day" type="number" min="0" max="1000" step="1" value="24"/);
assert.ok(!/undefined/.test(html), 'nothing undefined on the page');
assert.match(setupSection({ steps: [], summary: {} }), /did not list its jobs/);

// The routes.
const calls = [];
const app = express();
app.use((req, res, next) => {
    if (req.get('x-role')) req.viewer = { kind: 'user', subject: 'usr_01ARZ3NDEKTSV4RRFFQ69G5FAV', role: req.get('x-role'), token: 'test-session' };
    next();
});
app.use(createConsoleRoutes({
    config: { baseUrl: 'https://openvibe.exchange' },
    ai: { adminRequest: async (path, options) => { calls.push({ path, options }); return path === '/api/v1/setup' ? state : { ok: true }; }, meRequest: async () => ({}) },
}));
const server = createServer(app);
(async () => {
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    const owner = { 'x-role': 'owner' };
    const form = { ...owner, Origin: 'https://openvibe.exchange', 'Content-Type': 'application/x-www-form-urlencoded' };
    try {
        const page = await fetch(base + '/console/setup', { headers: owner });
        assert.strictEqual(page.status, 200);
        const text = await page.text();
        assert.match(text, /class="ex-console-tab is-active" href="\/console\/setup">Setup</, 'a tab of its own');
        assert.match(text, /1 of 2 jobs are ready/);
        assert.ok(calls.some((c) => c.path === '/api/v1/setup'), 'read from AI\'s setup API');

        assert.strictEqual((await fetch(base + '/console/setup/caps/chat', { method: 'POST', headers: { ...owner, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'cap_usd=10' })).status, 403, 'cross-site is refused');
        let r = await fetch(base + '/console/setup/caps/chat', { method: 'POST', redirect: 'manual', headers: form, body: 'cap_usd=25' });
        assert.strictEqual(r.status, 303);
        assert.deepStrictEqual(calls.at(-1), { path: '/api/v1/setup/caps/chat', options: { method: 'PUT', body: { cap_usd: 25 } } });
        r = await fetch(base + '/console/setup/caps/image', { method: 'POST', redirect: 'manual', headers: form, body: 'cap_usd=' });
        assert.deepStrictEqual(calls.at(-1).options.body, { cap_usd: null }, 'empty is no cap');
        r = await fetch(base + '/console/setup/caps/chat', { method: 'POST', headers: form, body: 'cap_usd=-3' });
        assert.strictEqual(r.status, 422, 'a negative cap is refused');

        r = await fetch(base + '/console/setup/free/pictures', { method: 'POST', redirect: 'manual', headers: form, body: 'per_day=6' });
        assert.strictEqual(r.status, 303);
        assert.deepStrictEqual(calls.at(-1), { path: '/api/v1/setup/free/pictures', options: { method: 'PUT', body: { per_day: 6 } } });
        r = await fetch(base + '/console/setup/free/pictures', { method: 'POST', headers: form, body: 'per_day=2.5' });
        assert.strictEqual(r.status, 422, 'a whole number');
        assert.strictEqual((await fetch(base + '/console/setup', { headers: { 'x-role': 'user' } })).status, 403, 'the owner\'s only');
        console.log('console-setup: every job with its model, state, spend and cap; caps and pictures a day saved through AI\'s setup API');
    } finally { server.close(); }
})().catch((e) => { server.close(); console.error(e); process.exit(1); });
