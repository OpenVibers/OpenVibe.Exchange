'use strict';
/**
 * The queued Search documents reach OpenVibe.Search (server/app.js, openvibe-publishing/search-relay): with
 * EXCHANGE_SEARCH_URL set, publishing a listing PUTs its document to Search's owner API with a service token for
 * openvibe.search, and closing it DELETEs it at the listing's new revision; a delivered row leaves the queue. Without
 * the URL the relay is off and the rows wait.
 */
const assert = require('assert');
const http = require('http');
const { boot, check, done } = require('./helpers/boot');
const fixtures = require('./helpers/fixtures');

function fakeSearch() {
    const calls = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
            calls.push({ method: req.method, url: req.url, auth: req.headers.authorization || '', body: body ? JSON.parse(body) : null });
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ outcome: 'applied' }));
        });
    });
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((r) => server.close(r)) })));
}

(async () => {
    const search = await fakeSearch();
    const t = await boot({ env: { EXCHANGE_SEARCH_URL: search.url } });
    try {
        const alice = t.network.addUser('alice');
        const l = await fixtures.listed(t, alice, { title: 'A relayed template' });

        await check('a listed listing is PUT to Search with a service token, and the row leaves the queue', async () => {
            assert.strictEqual(t.ctx.searchRelay.enabled, true);
            const out = await t.ctx.searchRelay.drain();
            assert.ok(out.sent >= 1, JSON.stringify(out));
            const put = search.calls.find((c) => c.method === 'PUT' && c.url === `/api/v1/documents/exchange/listing/${l.id}`);
            assert.ok(put, `a PUT for ${l.id}: ${JSON.stringify(search.calls.map((c) => `${c.method} ${c.url}`))}`);
            assert.match(put.auth, /^Bearer \S+/);
            assert.strictEqual(put.body.canonical_url, `https://openvibe.exchange/listings/${l.slug}`);
            assert.strictEqual(put.body.title, 'A relayed template');
            assert.strictEqual((await t.ctx.searchRelay.status()).pending, 0);
        });

        await check('closing it DELETEs the document at the listing\'s new revision', async () => {
            const before = search.calls.length;
            const r = await t.get(`/api/v1/listings/${l.slug}/close`, { as: alice, method: 'POST', json: { reason: 'withdrawn' } });
            assert.strictEqual(r.status, 200);
            await t.ctx.searchRelay.drain();
            const del = search.calls.slice(before).find((c) => c.method === 'DELETE');
            assert.ok(del, 'a DELETE');
            assert.strictEqual(del.url, `/api/v1/documents/exchange/listing/${l.id}?revision=${r.json().revision}`);
        });
    } finally {
        await t.close();
        await search.close();
    }

    const off = await boot();
    try {
        await check('without EXCHANGE_SEARCH_URL the relay is off', async () => {
            assert.strictEqual(off.ctx.searchRelay.enabled, false);
            assert.strictEqual(await off.ctx.searchRelay.drain(), null);
        });
    } finally {
        await off.close();
    }
    done();
})();
