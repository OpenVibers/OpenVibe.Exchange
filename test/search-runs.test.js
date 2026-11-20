'use strict';
const assert = require('node:assert/strict');
const { runSearch, selectedEngines } = require('../server/http/search');

const card = (id, kinds = ['web'], extra = {}) => ({ id, kinds, available: true, price_per_1000: 0, byok: false, ...extra });
const engines = [card('openvibe'), card('deepseek'), card('brave'), card('openverse', ['images'])];

(async () => {
    const calls = [];
    const ai = {
        async meRequest(_token, path, { body, timeoutMs }) {
            calls.push({ path, body, timeoutMs });
            const engine = body.engine === 'auto' ? 'openvibe' : body.engine;
            return { results: [], receipt: { engine, cost_usd: body.engine === 'brave' ? 0.002 : 0.003, time_ms: 1 } };
        },
    };

    // A web search is one search v2 call (AI #669, 11-20): fast by default (two engines of different kinds side by
    // side, merged by AI), never two calls paid twice from here.
    let out = await runSearch({ ai, token: 't', body: { q: 'x' }, kind: 'web', engines });
    assert.equal(out.mode, 'single');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/v1/search');
    assert.equal(calls[0].body.depth, 'fast');
    assert.equal(calls[0].body.engines, undefined, 'auto: AI chooses the engines');
    assert.equal(out.spent, 0.003);
    assert.equal(calls[0].timeoutMs, 20000, 'no limit given: the depth\'s own wait');
    // 11-15: the route's search limit reaches the call, never shorter than the depth needs.
    calls.length = 0;
    await runSearch({ ai, token: 't', body: { q: 'x', depth: 'instant' }, kind: 'web', engines, timeoutMs: 30000 });
    assert.equal(calls[0].timeoutMs, 30000);
    // A call that timed out says so in plain words.
    const slow = { async meRequest() { throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); } };
    const timedOut = await runSearch({ ai: slow, token: 't', body: { q: 'x' }, kind: 'web', engines, timeoutMs: 15000 });
    assert.match(timedOut.note, /took too long/);

    // An explicit engine is still one call, to that engine.
    calls.length = 0;
    out = await runSearch({ ai, token: 't', body: { q: 'x', first: 'deepseek' }, kind: 'web', engines });
    assert.deepEqual(calls.map((c) => c.body.engines), [['deepseek']]);

    // Compare is explicit, sequential, and every call gets what is left of ONE combined cap.
    calls.length = 0;
    out = await runSearch({
        ai, token: 't', kind: 'web', engines,
        body: { q: 'x', mode: 'compare', first: 'openvibe', second: 'deepseek', third: 'brave', max_cost_usd: '0.01' },
    });
    assert.equal(out.mode, 'compare');
    assert.deepEqual(calls.map((c) => c.body.engine), ['openvibe', 'deepseek', 'brave']);
    assert.deepEqual(calls.map((c) => c.body.max_cost_usd), [0.01, 0.007, 0.004]);
    assert.ok(out.spent <= 0.01 + 1e-9);

    // A duplicate choice never runs the same engine twice; fewer than two means a note, not a paid call.
    calls.length = 0;
    out = await runSearch({ ai, token: 't', kind: 'web', engines, body: { q: 'x', mode: 'compare', first: 'openvibe', second: 'openvibe' } });
    assert.equal(out.results.length, 0);
    assert.match(out.note, /two or three/);
    assert.equal(calls.length, 0);

    // Four picks are capped at three.
    calls.length = 0;
    out = await runSearch({ ai, token: 't', kind: 'web', engines, body: { q: 'x', mode: 'compare', first: 'openvibe', second: 'deepseek', third: 'brave', fourth: 'openverse' } });
    assert.equal(calls.length, 3);

    // Image filters are passed through, and strict safe search is a filter rather than a label.
    calls.length = 0;
    await runSearch({ ai, token: 't', kind: 'images', engines, body: { q: 'x', first: 'openverse', license: 'cc0', commercial: 'true', safe_search: 'strict', size: 'large' } });
    assert.equal(calls[0].path, '/v1/search/images');
    assert.equal(calls[0].body.license, 'cc0');
    assert.equal(calls[0].body.commercial, true);
    assert.equal(calls[0].body.safe_search, 'strict');
    assert.equal(calls[0].body.size, 'large');

    // A filter the chosen engine cannot honour is shown to the person, not turned into an empty result.
    const refuses = { async meRequest() { throw Object.assign(new Error('openverse cannot honour color; choose an engine that supports it'), { status: 422 }); } };
    out = await runSearch({ ai: refuses, token: 't', kind: 'images', engines, body: { q: 'x', first: 'openverse', color: 'blue' } });
    assert.match(out.results[0].error, /cannot honour color/);

    // The view and the handler agree on the default.
    assert.deepEqual(selectedEngines({}, engines, 'web'), { mode: 'single', engines: ['auto'] });
    console.log('search runs: one engine by default, explicit compare and one combined cap passed');
})().catch(e => { console.error(e); process.exitCode = 1; });
