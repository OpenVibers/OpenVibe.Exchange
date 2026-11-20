'use strict';
// Exchange's streamed search call to AI (server/ai.js meStream, plan AD.34 item 4): the person's session goes with it;
// each Server-Sent Event reaches the listener whole, however the network splits it; an AI that does not stream yet
// answers the whole search, which is the stream's end; a refusal before the stream opens is thrown like meRequest's.
const assert = require('assert');
const { createAi } = require('../server/ai');

(async () => {
    const config = { ai: { url: 'http://ai.test', timeoutMs: 30_000, waitMs: 1000, audience: 'ai', scope: '' }, oauth: { clientId: 'exchange', clientSecret: 's' }, networkInternalUrl: 'http://network.test', baseUrl: 'https://openvibe.exchange' };
    const sse = 'event: results\ndata: {"stage":"merged","results":[{"url":"https://a.example/"}]}\n\nevent: answer\ndata: {"answer":{"text":"Yes [1]."}}\n\nevent: done\ndata: {"results":[],"receipt":{"cost_usd":0.001}}\n\n';
    let seen = null;
    const reply = { kind: 'sse' };
    const fetchImpl = async (url, init = {}) => {
        seen = { url: String(url), headers: init.headers, body: JSON.parse(init.body) };
        if (reply.kind === 'sse') {
            const enc = new TextEncoder();
            const parts = [sse.slice(0, 30), sse.slice(30, 77), sse.slice(77)];
            return new Response(new ReadableStream({ start(c) { parts.forEach((p) => c.enqueue(enc.encode(p))); c.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
        }
        if (reply.kind === 'json') return new Response(JSON.stringify({ results: [{ url: 'https://a.example/' }], receipt: { engine: 'multi' } }), { status: 200, headers: { 'content-type': 'application/json' } });
        return new Response(JSON.stringify({ code: 'ai.invalid', detail: 'depth must be one of instant, fast, standard, deep' }), { status: 422, headers: { 'content-type': 'application/json' } });
    };
    const ai = createAi({ config, fetchImpl, log: { warn() {} } });
    const events = [];
    await ai.meStream('person-session', '/v1/search', { body: { q: 'x', stream: true }, onEvent: (e, d) => events.push([e, d]) });
    assert.strictEqual(seen.url, 'http://ai.test/v1/search');
    assert.strictEqual(seen.headers.Authorization, 'Bearer person-session', "the person's own session, never the service token");
    assert.strictEqual(seen.headers.Accept, 'text/event-stream');
    assert.strictEqual(seen.body.stream, true);
    assert.deepStrictEqual(events.map(([e]) => e), ['results', 'answer', 'done']);
    assert.strictEqual(events[1][1].answer.text, 'Yes [1].');

    reply.kind = 'json';
    const whole = [];
    await ai.meStream('person-session', '/v1/search', { body: { q: 'x', stream: true }, onEvent: (e, d) => whole.push([e, d]) });
    assert.deepStrictEqual(whole.map(([e]) => e), ['done'], 'a whole answer is the end of the stream');

    reply.kind = 'refuse';
    await assert.rejects(ai.meStream('person-session', '/v1/search', { body: { q: 'x', stream: true }, onEvent() {} }), (err) => err.status === 422 && /depth must be one of/.test(err.message));
    await assert.rejects(ai.meStream('', '/v1/search', { body: {}, onEvent() {} }), (err) => err.status === 401);
    console.log('ai-search-stream: 4 checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
