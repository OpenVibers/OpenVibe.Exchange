'use strict';
/**
 * ADR-033: Exchange's part of an account export (listings, installations, sandbox trials, offers) and of a deletion,
 * applied through /internal/events with a stand-in Network. A deletion anonymises and closes a public listing with
 * a Search tombstone, deletes a draft outright, and erases the person's installs, trials and offers; another
 * person's listing stays. A redelivery changes nothing; a bad signature and a proxied request are refused.
 */
const assert = require('assert');
const http = require('http');
const { ids } = require('openvibe-contracts');
const { boot, check, done } = require('./helpers/boot');
const fixtures = require('./helpers/fixtures');
const { createNetworkSender } = require('openvibe-sdk/account-data');
const { signDeliveryHeaders } = require('openvibe-sdk/events');

const A = ids.newId('user');
const B = ids.newId('user');
const EXP = `exp_${ids.ulid()}`;
const DEL = `del_${ids.ulid()}`;
const SECRET = `fixture_${'account'.repeat(6)}`;
const WRONG = `fixture_${'mismatch'.repeat(6)}`;

const exportEvent = { event_id: `evt_${ids.ulid()}`, event_type: 'network.account.export_requested', source: 'network', payload: { export_id: EXP, subject: A } };
const deleteEvent = { event_id: `evt_${ids.ulid()}`, event_type: 'network.account.deleted', source: 'network', payload: { deletion_id: DEL, subject: A, aliases: [] } };
const bodyOf = (ev) => JSON.stringify({ event: ev, seq: 1 });

async function startNetworkStub() {
    const calls = [];
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            const raw = Buffer.concat(chunks);
            const json = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
            if (req.url === '/oauth/token') return json(200, { access_token: 'tok_exchange', token_type: 'Bearer', expires_in: 300 });
            calls.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(raw.toString() || 'null') });
            return json(201, {});
        });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((r) => server.close(r)) };
}

(async () => {
    const stub = await startNetworkStub();
    const sender = createNetworkSender({ networkInternalUrl: stub.url, clientId: 'exchange', clientSecret: 'exchange-secret' });
    const t = await boot({ env: { EXCHANGE_EVENTS_SECRET: SECRET }, accountSend: sender });
    const alice = { id: 101, subject: A, username: 'alice', display_name: 'alice', role: 'user' };
    const bob = { id: 102, subject: B, username: 'bob', display_name: 'bob', role: 'user' };
    try {
        const aListed = await fixtures.listed(t, alice, { title: 'Alice\'s listed theme', kind: 'theme' });
        const aDraft = await fixtures.create(t, alice, { title: 'Alice\'s draft theme', kind: 'theme' });
        const bListed = await fixtures.listed(t, bob, { title: 'Bob\'s listed theme', kind: 'theme' });
        const sb = await fixtures.sandbox(t, alice, bListed.slug);
        const inst = await fixtures.install(t, alice, bListed.slug);
        const claim = await t.get(`/api/v1/listings/${bListed.slug}/offers`, { as: alice, json: { body: 'I would like Bob\'s theme.' } });
        assert.strictEqual(claim.status, 201);

        await check('an export carries Alice\'s listings, trial, install and offer, and not Bob\'s', async () => {
            const body = bodyOf(exportEvent);
            const res = await t.get('/internal/events', { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...signDeliveryHeaders(body, SECRET) } });
            assert.strictEqual(res.status, 200, res.text);
            assert.strictEqual(res.json().outcome, 'exported');
            const part = stub.calls.find((c) => c.url === `/internal/account-exports/${EXP}/parts`);
            assert.ok(part, 'the part was pushed to Network');
            assert.strictEqual(part.auth, 'Bearer tok_exchange');
            assert.strictEqual(part.body.subject, A);
            assert.deepStrictEqual(part.body.files.map((f) => f.name).sort(), ['installs.json', 'listings.json', 'offers.json', 'sandbox-trials.json']);
            const all = JSON.stringify(part.body);
            assert.ok(all.includes('Alice\'s listed theme'));
            assert.ok(all.includes('Alice\'s draft theme'));
            assert.ok(!all.includes('Bob\'s listed theme'), 'nobody else\'s listing');
            assert.strictEqual(part.body.files.find((f) => f.name === 'installs.json').content[0].id, inst.id);
            assert.strictEqual(part.body.files.find((f) => f.name === 'sandbox-trials.json').content[0].id, sb.trial.id);
            assert.match(all, /I would like Bob/);
        });

        await check('a deletion closes the listed listing with a tombstone, deletes the draft and Alice\'s rows; Bob stays', async () => {
            const body = bodyOf(deleteEvent);
            const res = await t.get('/internal/events', { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...signDeliveryHeaders(body, SECRET) } });
            assert.strictEqual(res.status, 200, res.text);
            assert.strictEqual(res.json().outcome, 'erased');
            const db = t.ctx.s.db;
            const listed = await db.maybe('SELECT owner, status, closed_reason, title, summary, creator FROM exchange_listings WHERE id = $1', [aListed.id]);
            assert.strictEqual(listed.owner, null);
            assert.strictEqual(listed.status, 'closed');
            assert.strictEqual(listed.closed_reason, 'withdrawn');
            assert.strictEqual(listed.title, 'A deleted listing');
            assert.strictEqual(listed.summary, "Removed with its maker's account.");
            assert.strictEqual(listed.creator, 'a deleted maker');
            assert.strictEqual(Number(await db.value('SELECT COUNT(*)::int AS n FROM exchange_listings WHERE id = $1', [aDraft.id])), 0);
            const bobRow = await db.maybe('SELECT owner, status FROM exchange_listings WHERE id = $1', [bListed.id]);
            assert.strictEqual(bobRow.owner, B);
            assert.strictEqual(bobRow.status, 'listed');
            assert.strictEqual(Number(await db.value('SELECT COUNT(*)::int AS n FROM exchange_installs WHERE id = $1', [inst.id])), 0);
            assert.strictEqual(Number(await db.value('SELECT COUNT(*)::int AS n FROM exchange_sandbox_trials WHERE id = $1', [sb.trial.id])), 0);
            assert.strictEqual(Number(await db.value('SELECT COUNT(*)::int AS n FROM exchange_offers WHERE id = $1', [claim.json().id])), 0);
            const tomb = await db.maybe("SELECT payload FROM exchange_outbox WHERE topic = 'exchange.index_document.deleted' AND payload->>'id' = $1", [aListed.id]);
            assert.ok(tomb, 'a tombstone was queued');
            assert.strictEqual(tomb.payload.deleted, true);
            const confirmation = stub.calls.find((c) => c.url === `/internal/account-deletions/${DEL}/confirmations`);
            assert.ok(confirmation, 'the confirmation was sent');
            assert.ok(confirmation.body.erased.exchange_listings_drafts >= 1);
            assert.ok(confirmation.body.retained.exchange_listings_closed >= 1);
            assert.ok(!Number.isNaN(Date.parse(confirmation.body.completed_at)));
        });

        await check('a redelivery changes nothing', async () => {
            const body = bodyOf(deleteEvent);
            const res = await t.get('/internal/events', { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...signDeliveryHeaders(body, SECRET) } });
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.json().outcome, 'unchanged');
            assert.strictEqual(Number(await t.ctx.s.db.value("SELECT COUNT(*)::int AS n FROM exchange_outbox WHERE topic = 'exchange.index_document.deleted' AND payload->>'id' = $1", [aListed.id])), 1, 'no second tombstone');
        });

        await check('the internal route refuses a bad signature (401) and a forwarded request (403)', async () => {
            const body = bodyOf(exportEvent);
            const bad = await t.get('/internal/events', { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...signDeliveryHeaders(body, WRONG) } });
            assert.strictEqual(bad.status, 401);
            const forwarded = await t.get('/internal/events', { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.9', ...signDeliveryHeaders(body, SECRET) } });
            assert.strictEqual(forwarded.status, 403);
        });
    } finally {
        await t.close();
        await stub.close();
    }
    done();
})();
