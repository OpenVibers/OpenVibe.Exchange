'use strict';
/**
 * The owner's AI defaults page and its post: owner-only, CSRF-guarded, and the payload it sends AI carries the
 * signed-out and signed-in picks, the fallback order as it stands, the search order and the cost ceiling.
 */
const assert = require('assert');
const express = require('express');
const { createServer } = require('http');
const { createConsoleRoutes } = require('../server/http/console');

const task = { name: 'design.icon', kind: 'code', sentence: 'Draw an original SVG icon.', default: { model: 'openvibe/auto', source: 'openvibe' } };
const searchTask = { name: 'search.web', kind: 'search', sentence: 'Find sources on the web.', default: { model: 'search/wikipedia', source: 'openvibe' } };
const pick = { model: 'anthropic/claude-opus-5-5', source: 'openvibe' };
const defaults = { 'design.icon': { signed_out: pick, signed_in: pick, fallbacks: [pick], image_model: null, search_engines: [], max_cost_usd: 0.5 } };
const choicesFor = (name) => ({ options: { openvibe: [{ model: name === 'search.web' ? 'search/wikipedia' : 'anthropic/claude-opus-5-5', source: 'openvibe', name: 'Claude Opus 5.5', price_estimate_usd: 0.02, adult: false }], keys: [], machines: [] } });

const calls = [];
const app = express();
app.use((req, res, next) => {
    if (req.get('x-role')) req.viewer = { kind: 'user', subject: 'usr_01ARZ3NDEKTSV4RRFFQ69G5FAV', role: req.get('x-role'), token: 'test-session' };
    next();
});
app.use(createConsoleRoutes({
    config: { baseUrl: 'https://openvibe.exchange' },
    ai: {
        meRequest: async (token, path, options) => {
            calls.push({ token, path, options });
            if (path === '/api/v1/admin/task-defaults') return { tasks: [task, searchTask], defaults };
            if (path.startsWith('/api/v1/choices?task=')) return choicesFor(decodeURIComponent(path.split('=')[1]));
            return { defaults };
        },
    },
}));

(async () => {
    const server = createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = 'http://127.0.0.1:' + server.address().port;
    try {
        // Owner rank only: signed-in non-owners are forbidden; signed-out people see no route.
        for (const role of ['', 'user', 'admin']) {
            assert.strictEqual((await fetch(base + '/console/defaults', { headers: role ? { 'x-role': role } : {}, redirect: 'manual' })).status, role ? 403 : 303, `${role || 'signed out'} is not the owner`);
        }
        const page = await fetch(base + '/console/defaults', { headers: { 'x-role': 'owner' } });
        const html = await page.text();
        assert.strictEqual(page.status, 200);
        assert.ok(html.includes('<h1>AI defaults</h1>'), 'the page names itself');
        assert.ok(html.includes('data-fallback-list'), 'the fallback order is on the page');
        assert.ok(html.includes('data-task-default'), 'each task has its own form');
        assert.ok(html.includes('name="signed_out"') && html.includes('name="signed_in"'), 'both picks are on the page');
        assert.ok(html.includes('name="search_engines"'), 'the search task carries its engines');
        assert.ok(html.includes('data-models='), 'the list carries the models the page may offer');
        assert.ok(!html.includes('data-ai-choice'), 'an owner default never offers the person-facing chip (keys, machines)');
        assert.strictEqual(calls[0].token, 'test-session', 'the owner session reaches AI');

        const body = new URLSearchParams({ task: task.name, signed_out: JSON.stringify(pick), signed_in: JSON.stringify(pick), fallback: JSON.stringify(pick), max_cost_usd: '0.1' });
        // A cross-site post is refused even with the owner's session.
        assert.strictEqual((await fetch(base + '/console/defaults', { method: 'POST', headers: { 'x-role': 'owner', 'Content-Type': 'application/x-www-form-urlencoded' }, body })).status, 403);
        const saved = await fetch(base + '/console/defaults', { method: 'POST', redirect: 'manual', headers: { 'x-role': 'owner', Origin: 'https://openvibe.exchange', 'Content-Type': 'application/x-www-form-urlencoded' }, body });
        assert.strictEqual(saved.status, 303, 'a save redirects back to the page');
        const sent = calls.at(-1).options.body.defaults[0];
        assert.deepStrictEqual([sent.task, sent.value.signed_in.model, sent.value.fallbacks.length, sent.value.max_cost_usd], [task.name, pick.model, 1, 0.1]);

        // The search order is one engine a line, and a leading minus turns one off.
        const searchBody = new URLSearchParams({ task: searchTask.name, signed_out: JSON.stringify({ model: 'search/wikipedia', source: 'openvibe' }), signed_in: JSON.stringify({ model: 'search/wikipedia', source: 'openvibe' }), search_engines: 'wikipedia\n-commons\nopenverse', max_cost_usd: '' });
        const searchSaved = await fetch(base + '/console/defaults', { method: 'POST', redirect: 'manual', headers: { 'x-role': 'owner', Origin: 'https://openvibe.exchange', 'Content-Type': 'application/x-www-form-urlencoded' }, body: searchBody });
        assert.strictEqual(searchSaved.status, 303);
        const searchValue = calls.at(-1).options.body.defaults[0].value;
        assert.deepStrictEqual(searchValue.search_engines, [{ engine: 'wikipedia', enabled: true }, { engine: 'commons', enabled: false }, { engine: 'openverse', enabled: true }]);
        assert.strictEqual(searchValue.max_cost_usd, null, 'an empty ceiling is no ceiling');
        console.log('Defaults: owner-only page, CSRF protection, and the payload AI receives');
    } finally {
        await new Promise((r) => server.close(r));
    }
})().catch((e) => { console.error(e); process.exitCode = 1; });
