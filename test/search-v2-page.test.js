'use strict';
// Exchange's search page on search v2 (AI #669; the owner, 11-20: compete with Linkup: depth you can set, several
// searches at once, deduplicated, sourced answers; powerful and still minimal). A web search is one v2 call carrying the
// page's choices; the merged list says which engines found each result, the answer links its numbered sources, and the
// code card is the same search in three lines.
const assert = require('assert');
const { runSearch, v2Body } = require('../server/http/search');
const views = require('../server/views/search');

(async () => {
    let pass = 0;
    const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };

    const b = v2Body({ q: 'lantern makers', depth: 'standard', answer: 'true', more: 'azulejo Porto\n\nLisbon tiles\n', include: 'https://www.Example.com/x, bad site, docs.example.org', exclude: 'pinterest.com', from: '2026-01-01', engine: 'brave' }, { safe_search: 'strict' });
    assert.deepStrictEqual(b, { q: 'lantern makers', depth: 'standard', limit: 10, output: 'answer', queries: ['azulejo Porto', 'Lisbon tiles'], include_domains: ['example.com', 'docs.example.org'], exclude_domains: ['pinterest.com'], from: '2026-01-01', engines: ['brave'], safe_search: 'strict' });
    assert.deepStrictEqual(v2Body({ q: 'x', depth: 'bottomless' }, {}), { q: 'x', depth: 'fast', limit: 10 }, 'fast by default, nothing else unless chosen');
    ok('the form becomes one v2 request: depth, the answer, more searches, sites in and out, a date, a named engine');

    const calls = [];
    const v2 = { results: [{ title: 'Lantern makers in Lisbon', url: 'https://example.org/lisbon', snippet: 's', engines: ['brave', 'serper'], engine: 'brave', excerpt: 'Five lantern makers open their workshops' }], answer: { text: 'Five makers open this winter [1].', citations: [{ n: 1, title: 'Lantern makers in Lisbon', url: 'https://example.org/lisbon' }] }, queries: { asked: ['lantern makers'], variants: ['Lisbon lantern workshops'], follow_ups: [] }, receipt: { engine: 'multi', depth: 'standard', cost_usd: 0.012, time_ms: 4200, engines: ['brave', 'serper'], duplicates_removed: 3, calls: [{ engine: 'brave', query: 'lantern makers', status: 'ok', results: 3, cost_usd: 0.005, time_ms: 600 }], steps: [{ step: 'answer', status: 'ok', model: 'deepseek/deepseek-chat', cost_usd: 0.002 }] } };
    const ai = { meRequest: async (token, path, opts) => { calls.push({ path, body: opts.body, timeoutMs: opts.timeoutMs }); return v2; } };
    const out = await runSearch({ ai, token: 't', body: { q: 'lantern makers', depth: 'deep', answer: 'true', max_cost_usd: '0.05' }, kind: 'web', engines: [], timeoutMs: 15000 });
    assert.strictEqual(calls.length, 1, 'one call, not one per engine');
    assert.strictEqual(calls[0].path, '/v1/search');
    assert.strictEqual(calls[0].body.depth, 'deep');
    assert.strictEqual(calls[0].body.max_cost_usd, 0.05, 'the cap goes with it');
    assert.ok(calls[0].timeoutMs >= 55000, 'a deep search is waited for');
    assert.strictEqual(out.multi, v2);
    assert.strictEqual(out.spent, 0.012);
    const compare = await runSearch({ ai: { meRequest: async (t, p, o) => { calls.push({ path: p, body: o.body }); return { results: [], receipt: { engine: o.body.engine, cost_usd: 0 } }; } }, token: 't', body: { q: 'x', mode: 'compare', first: 'brave', second: 'serper' }, kind: 'web', engines: [{ id: 'brave', kinds: ['web'] }, { id: 'serper', kinds: ['web'] }] });
    assert.strictEqual(compare.multi, undefined, 'Compare stays engine by engine');
    assert.deepStrictEqual(calls.slice(-2).map((c) => c.body.engine), ['brave', 'serper']);
    const failing = await runSearch({ ai: { meRequest: async () => { throw Object.assign(new Error('x'), { status: 429 }); } }, token: 't', body: { q: 'x' }, kind: 'web', engines: [] });
    assert.match(failing.note, /Too many searches/, 'a refusal is said in words');
    ok('a web search is one v2 call with the cap and a wait long enough for its depth; Compare is unchanged; a refusal is words');

    const html = views.multiResults(v2, [{ id: 'brave' }, { id: 'serper' }]);
    assert.match(html, /<a class="xs-cite" href="#xs-r1">\[1\]<\/a>/, 'the answer links its sources');
    assert.match(html, /id="xs-r1"/);
    assert.match(html, /<blockquote class="xs-excerpt">Five lantern makers open their workshops<\/blockquote>/, 'the passage read from the page');
    assert.match(html, /<em>agree<\/em>/, 'two engines found it');
    assert.match(html, /3 duplicates folded/);
    assert.match(html, /Also searched<\/span><em>Lisbon lantern workshops<\/em>/);
    assert.match(html, /Every call, read and step/);
    assert.ok(!/<script/i.test(views.multiResults({ ...v2, results: [{ ...v2.results[0], title: '<script>alert(1)</script>' }] }, [])), 'titles are text');
    ok('the merged list: the answer with linked sources, the passage, which engines agree, what was folded, every call');

    const page = views.searchPage({ engines: [{ id: 'brave', kinds: ['web'] }], query: { q: 'lanterns', kind: 'web', depth: 'standard', answer: true }, multi: v2, apiBase: 'https://api.openvibe.exchange' });
    assert.match(page, /name="depth" value="standard" checked/);
    assert.match(page, /name="answer" value="true" role="switch" checked/);
    assert.match(page, /name="more"/);
    assert.match(page, /name="include"/);
    assert.match(page, /Use it in code/);
    assert.match(page, /curl https:\/\/api\.openvibe\.exchange\/v1\/search/);
    assert.match(page, /&quot;depth&quot;:&quot;standard&quot;,&quot;output&quot;:&quot;answer&quot;/, 'the code is the search on the page');
    const pictures = views.searchPage({ engines: [], query: { kind: 'images' } });
    assert.ok(!/name="depth"/.test(pictures) && !/Use it in code/.test(pictures), 'pictures keep their own controls');
    ok('the page: how deep and the answer switch in view, more searches and sites in the fold, the same search as code');

    // Streamed (plan AD.34 item 4): the page fills in as the search goes, each step HTML from the same views.
    const { streamSearch } = require('../server/http/search');
    const sent = [];
    let asked = null;
    const streamingAi = { meStream: async (token, path, opts) => {
        asked = { token, path, body: opts.body, timeoutMs: opts.timeoutMs };
        const r1 = { ...v2.results[0], excerpt: undefined };
        opts.onEvent('results', { stage: 'first', results: [r1], queries: { asked: ['lantern makers'] } });
        opts.onEvent('results', { stage: 'merged', results: [r1, { title: 'Second', url: 'https://second.example/x', snippet: 's2', engines: ['brave'], engine: 'brave' }], queries: { asked: ['lantern makers'], variants: ['Lisbon lantern workshops'] } });
        opts.onEvent('results', { stage: 'read', results: v2.results });
        opts.onEvent('answer', { answer: v2.answer });
        opts.onEvent('done', v2);
    } };
    await streamSearch({ ai: streamingAi, token: 'person-token', body: { q: 'lantern makers', depth: 'standard', answer: 'true', max_cost_usd: '0.05' }, engines: [{ id: 'brave' }], apiBase: 'https://api.openvibe.exchange', dive: null, write: (event, data) => sent.push([event, data]) });
    assert.deepStrictEqual(asked && [asked.token, asked.path, asked.body.stream, asked.body.depth, asked.body.output, asked.body.max_cost_usd], ['person-token', '/v1/search', true, 'standard', 'answer', 0.05]);
    assert.ok(asked.timeoutMs >= 45000, 'a standard search is waited for');
    assert.deepStrictEqual(sent.map(([e]) => e), ['html', 'html', 'html', 'html', 'html', 'done']);
    assert.match(sent[0][1].live, /searching several engines at once/, 'something is on the page before any engine answers');
    assert.match(sent[0][1].live, /xs-answer is-pending/, "the answer's place is kept");
    assert.match(sent[0][1].code, /curl https:\/\/api\.openvibe\.exchange\/v1\/search/, 'the code card follows the new question');
    assert.match(sent[1][1].live, /1 results so far · searching the question from other angles/);
    assert.match(sent[2][1].live, /2 results so far · reading the top pages/);
    assert.match(sent[3][1].live, /writing the answer/);
    assert.match(sent[3][1].live, /<blockquote class="xs-excerpt">/, 'the passages arrive before the answer');
    assert.match(sent[4][1].live, /<a class="xs-cite" href="#xs-r1">\[1\]<\/a>/);
    assert.ok(!/is-pending/.test(sent[4][1].live), 'the answer replaced its place');
    assert.match(sent[5][1].live, /3 duplicates folded/, 'the end has the whole receipt');
    assert.strictEqual(sent[5][1].spent, 0.012);
    const failed = [];
    await streamSearch({ ai: { meStream: async (t, p, o) => { o.onEvent('results', { stage: 'merged', results: v2.results }); o.onEvent('error', { status: 503, detail: 'No engine answered this search' }); } }, token: 't', body: { q: 'x' }, engines: [], apiBase: null, dive: null, write: (event, data) => failed.push([event, data]) });
    assert.strictEqual(failed[failed.length - 1][0], 'failed');
    assert.match(failed[failed.length - 1][1].live, /No engine answered this search/);
    assert.match(failed[failed.length - 1][1].live, /Lantern makers in Lisbon/, 'what was found is kept');
    const refused = [];
    await streamSearch({ ai: { meStream: async () => { throw Object.assign(new Error('x'), { status: 429 }); } }, token: 't', body: { q: 'x' }, engines: [], apiBase: null, dive: null, write: (event, data) => refused.push([event, data]) });
    assert.match(refused[refused.length - 1][1].live, /Too many searches/);
    const streamedPage = views.searchPage({ engines: [], query: { q: 'lanterns', kind: 'web' } });
    assert.match(streamedPage, /<div id="xs-live">/);
    assert.match(streamedPage, /<div id="xs-code">/);
    assert.match(streamedPage, /data-stream="\/search\/stream"/);
    assert.match(streamedPage, /search-stream[^"]*\.js/);
    ok('streamed: something at once, results as the engines answer, the passages, the answer in its kept place, the receipt; failures in words');

    console.log(`search-v2-page: ${pass} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
