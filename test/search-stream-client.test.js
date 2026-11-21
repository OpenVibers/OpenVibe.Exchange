'use strict';
// public/js/search-stream.js (plan AD.34 item 4): a web search posts to /search/stream and puts each event's HTML in
// place as it arrives, even when the network splits an event across chunks; only new results get the entry class;
// pictures and Compare still post the whole page; a stream that cannot open falls back to the plain form post.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'search-stream.js'), 'utf8');

function harness({ fields, chunks, contentType = 'text/event-stream; charset=utf-8', ok = true, autorun = false, pinnedNote = null }) {
    const listeners = [];
    const writes = [];
    const hits = [];
    const live = {
        _html: '', classes: new Set(), attrs: new Set(),
        set innerHTML(v) { this._html = v; writes.push(v); hits.length = 0; for (const m of v.matchAll(/<li id="[^"]*" class="xs-hit"><a href="([^"]+)"/g)) hits.push(hitOf(m[1])); },
        get innerHTML() { return this._html; },
        classList: { add(c) { live.classes.add(c); } },
        toggleAttribute(n, on) { if (on) this.attrs.add(n); else this.attrs.delete(n); },
        querySelectorAll(sel) { return sel === '.xs-hit > a' ? hits.map((h) => h.a) : sel === '.xs-hit' ? hits.slice() : []; },
        querySelector(sel) { if (sel === '.xs-note.is-ok') return pinnedNote ? { outerHTML: pinnedNote } : null; return sel === '.xs-hit' ? hits[0] || null : null; },
    };
    function hitOf(href) {
        const li = { cls: new Set(), classList: { add(c) { li.cls.add(c); } }, a: { getAttribute: () => href }, querySelector: () => li.a };
        return li;
    }
    let submitted = 0;
    const form = { dataset: { stream: '/search/stream', ...(autorun ? { autorun: '1' } : {}) }, toggleAttribute() {}, requestSubmit() { submitted++; } };
    const urls = [];
    const history = { replaceState: (a, b, url) => urls.push(url) };
    const location = { pathname: '/search' };
    const code = { innerHTML: '' };
    // Elements the Stop row is made of: what they hold and what listens to them.
    const el = (tag) => {
        const n = { tag, children: [], listeners: {}, attrs: {}, className: '', textContent: '', disabled: false,
            append(...c) { n.children.push(...c); }, prepend(...c) { n.children.unshift(...c); },
            addEventListener(type, fn) { n.listeners[type] = fn; }, setAttribute(k, v) { n.attrs[k] = v; } };
        return n;
    };
    const working = { children: [], replaceChildren(...c) { this.children = c; }, querySelector(sel) { return sel === '.xs-stop-row' ? this.children.find((c) => c.className === 'xs-stop-row') || null : null; } };
    const document = {
        getElementById: (id) => ({ 'xs-form': form, 'xs-live': live, 'xs-code': code, 'xs-working': working }[id] || null),
        querySelector: () => null,
        createElement: el,
    };
    class FormDataStub {
        constructor() { this.map = new Map(Object.entries(fields)); }
        get(k) { return this.map.has(k) ? this.map.get(k) : null; }
        [Symbol.iterator]() { return this.map[Symbol.iterator](); }
    }
    const requests = [];
    const stops = [];
    const fetch = async (url, init) => {
        if (url === '/search/stop') { stops.push(JSON.parse(init.body)); return { ok: true, status: 200 }; }
        requests.push({ url, body: String(init.body), accept: init.headers.Accept });
        const enc = new TextEncoder();
        const body = new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); } });
        return { ok, headers: { get: () => contentType }, body };
    };
    const window = { addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }) };
    vm.runInNewContext(SRC, { window, document, fetch, FormData: FormDataStub, URLSearchParams, ReadableStream, TextDecoder, AbortController, setTimeout, console, history, location });
    const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
    const submit = async () => {
        let prevented = false;
        const handler = listeners.find((l) => l.type === 'submit');
        handler.fn({ target: form, submitter: null, preventDefault() { prevented = true; } });
        for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
        return prevented;
    };
    return { listeners, writes, live, code, requests, submit, hits, submitted: () => submitted, urls, settle, working, stops };
}

const hit = (n, url) => `<li id="xs-r${n}" class="xs-hit"><a href="${url}">t</a></li>`;
const ev = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

(async () => {
    let pass = 0;
    const ok = (m) => { pass++; console.log(`  ✓ ${m}`); };

    const first = `<section class="xs-out"><ol class="xs-hits">${hit(1, 'https://a.example/')}</ol></section>`;
    const second = `<section class="xs-out"><ol class="xs-hits">${hit(1, 'https://a.example/')}${hit(2, 'https://b.example/')}</ol></section>`;
    const stream = ev('html', { live: '<p>searching</p>', code: '<pre>curl</pre>' }) + ev('html', { live: first }) + ev('done', { live: second, spent: 0.001 });
    // Split in awkward places: inside a line, between the two newlines of a boundary.
    const chunks = [stream.slice(0, 17), stream.slice(17, stream.indexOf('\n\n') + 1), stream.slice(stream.indexOf('\n\n') + 1, 140), stream.slice(140)];
    const h = harness({ fields: { q: 'lanterns', kind: 'web', mode: 'single', depth: 'fast' }, chunks });
    assert.strictEqual(h.listeners[0].capture, true, 'on window, capturing: before the page-wide "Searching…" handler');
    assert.strictEqual(await h.submit(), true, 'the plain post is held back');
    assert.strictEqual(h.requests[0].url, '/search/stream');
    assert.strictEqual(h.requests[0].accept, 'text/event-stream');
    assert.match(h.requests[0].body, /q=lanterns/);
    assert.deepStrictEqual(h.writes, ['<p>searching</p>', first, second], 'every event put in place, in order');
    assert.strictEqual(h.code.innerHTML, '<pre>curl</pre>');
    assert.ok(h.live.classes.has('is-streamed'));
    assert.deepStrictEqual(h.hits.map((x) => x.cls.has('is-new')), [false, true], 'only the result that was not there before enters');
    assert.ok(!h.live.attrs.has('aria-busy'), 'not busy once done');
    ok('a web search streams: each event in place across split chunks, new results marked, the code card updated');

    const pics = harness({ fields: { q: 'blue', kind: 'images' }, chunks: [] });
    assert.strictEqual(await pics.submit(), false, 'pictures post the whole page');
    const compare = harness({ fields: { q: 'x', kind: 'web', mode: 'compare' }, chunks: [] });
    assert.strictEqual(await compare.submit(), false, 'Compare posts the whole page');
    ok('pictures and Compare are left to the plain form post');

    const html = harness({ fields: { q: 'x', kind: 'web', mode: 'single' }, chunks: ['<html>'], contentType: 'text/html' });
    await html.submit();
    assert.strictEqual(html.submitted(), 1, 'no stream: the form is posted the plain way');
    ok('a stream that cannot open falls back to the plain form post');

    // Linkable: a search goes into the address; a linked one (data-autorun, set for a signed-in person) runs itself;
    // a success line the page came back with stays above the results of that run.
    assert.deepStrictEqual(h.urls, ['/search?q=lanterns&run=1'], 'the search is in the address, ready to link or refresh');
    const linked = harness({ fields: { q: 'lanterns', kind: 'web', mode: 'single', depth: 'standard', answer: 'true' }, chunks: [stream], autorun: true, pinnedNote: '<p class="xs-note is-ok">Watching</p>' });
    await linked.settle();
    assert.strictEqual(linked.requests.length, 1, 'a linked search runs once, by itself');
    assert.deepStrictEqual(linked.urls, ['/search?q=lanterns&depth=standard&answer=1&run=1']);
    assert.ok(linked.writes.every((w) => w.startsWith('<p class="xs-note is-ok">Watching</p>')), 'the success line stays above every step');
    const quiet = harness({ fields: { q: 'lanterns', kind: 'web' }, chunks: [] });
    await quiet.settle();
    assert.strictEqual(quiet.requests.length, 0, 'without data-autorun nothing runs by itself');
    ok('a search is linkable: in the address, rerun when linked, a success line kept above it');

    // Stop (the owner, 11-21: "searches can be cancelled or stopped to save on cost"): the search's id shows a Stop
    // that asks the server to end it; the row goes once the search is done.
    const shown = [];
    const stopStream = ev('started', { id: 'srch_abcdefgh123' }) + ev('html', { live: first }) + ev('done', { live: second, spent: 0.0004 });
    const st = harness({ fields: { q: 'lanterns', kind: 'web', mode: 'single', free_only: 'true', time_limit: '15' }, chunks: [stopStream] });
    const replace = st.working.replaceChildren.bind(st.working);
    st.working.replaceChildren = (...c) => { if (c.length) shown.push(c[0]); replace(...c); };
    await st.submit();
    const row = shown.find((c) => c.className === 'xs-stop-row');
    assert.ok(row, 'a Stop row showed while the search ran');
    const button = row.children.find((c) => c.className === 'xs-stop');
    assert.strictEqual(button.textContent, 'Stop');
    assert.match(row.children[0].textContent, /pay only for what ran/);
    assert.strictEqual(st.working.children.length, 0, 'gone once the search is done');
    await button.listeners.click();
    assert.deepStrictEqual(st.stops, [{ id: 'srch_abcdefgh123' }], 'Stop asks the server to end that search');
    assert.deepStrictEqual(st.urls, ['/search?q=lanterns&free=1&time=15&run=1'], 'the free-only switch and the time limit are in the address');
    ok('Stop: shown while a search runs, it ends that search; the saving settings are linkable');

    console.log(`search-stream-client: ${pass} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
