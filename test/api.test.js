'use strict';
/**
 * The JSON API: a draft is created and is not public; publishing it needs the conformance tests; the public list
 * pages with an opaque cursor and filters; detail/passport/tests shapes; validation refusals; owner and staff
 * visibility; close and hide. There is no price in any shape.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const fixtures = require('./helpers/fixtures');

(async () => {
    const t = await boot();
    const alice = t.network.addUser('alice');
    const bob = t.network.addUser('bob');
    const mod = t.network.addUser('mod', { role: 'global_mod' });
    try {
        let draft = null;
        await check('POST /listings saves a draft with its passport and tests; it is not public yet', async () => {
            draft = await fixtures.create(t, alice);
            assert.match(draft.id, /^exl_[0-9A-HJKMNP-TV-Z]{26}$/);
            assert.strictEqual(draft.slug, 'starter-site-template');
            assert.strictEqual(draft.status, 'draft');
            assert.strictEqual(draft.mode, 'free');
            assert.deepStrictEqual(draft.passport.spends, []);
            assert.strictEqual(draft.tests.verified, true);
            assert.strictEqual(draft.tests.count, 4);
            assert.ok(!('price' in draft));
            const pub = await t.get('/api/v1/listings');
            assert.strictEqual(pub.json().count, 0);
            assert.strictEqual((await t.get(`/api/v1/listings/${draft.slug}`)).status, 404);
        });

        await check('the owner and staff see a draft; another person does not', async () => {
            const owner = await t.get(`/api/v1/listings/${draft.slug}`, { as: alice });
            assert.strictEqual(owner.status, 200);
            assert.strictEqual(owner.json().status, 'draft');
            assert.strictEqual(owner.json().owner, alice.subject);
            assert.strictEqual(owner.json().mine, true);
            assert.strictEqual((await t.get(`/api/v1/listings/${draft.slug}`, { as: bob })).status, 404);
            const staff = await t.get(`/api/v1/listings/${draft.slug}`, { as: mod });
            assert.strictEqual(staff.status, 200);
            assert.strictEqual(staff.json().staff, true);
        });

        await check('publishing makes it public with the passport, licence and versioned tests', async () => {
            const pub = await t.get(`/api/v1/listings/${draft.slug}/list`, { as: alice, method: 'POST' });
            assert.strictEqual(pub.status, 200, pub.text);
            assert.strictEqual(pub.json().status, 'listed');
            const list = await t.get('/api/v1/listings?mode=free&kind=template');
            assert.strictEqual(list.json().count, 1);
            assert.strictEqual(list.headers.get('cache-control'), 'public, max-age=60');
            const one = list.json().listings[0];
            assert.strictEqual(one.slug, draft.slug);
            assert.strictEqual(one.tests.verified, true);
            assert.deepStrictEqual(one.passport.reads, ['search.read']);
            const detail = await t.get(`/api/v1/listings/${draft.slug}`);
            assert.strictEqual(detail.status, 200);
            assert.strictEqual(detail.headers.get('cache-control'), 'public, max-age=60');
            assert.strictEqual(detail.json().license, 'CC0-1.0');
            assert.strictEqual(detail.json().manifest.entry, 'templates/starter/index.html');
            assert.strictEqual(detail.json().tests.rows.length, 4);
            const passport = await t.get(`/api/v1/listings/${draft.slug}/passport`);
            assert.strictEqual(passport.status, 200);
            assert.deepStrictEqual(passport.json().passport.writes, ['space.files.write']);
            assert.deepStrictEqual(passport.json().passport.spends, []);
            const tests = await t.get(`/api/v1/listings/${draft.slug}/tests`);
            assert.strictEqual(tests.json().verified, true);
            assert.deepStrictEqual(tests.json().tests.map((x) => x.name).sort(), ['licence', 'manifest', 'no_money', 'passport']);
        });

        await check('the list pages with an opaque cursor and filters, and refuses a garbage cursor', async () => {
            const two = await fixtures.listed(t, alice, { title: 'A calm theme kit', kind: 'theme', mode: 'swap', wants: 'A type kit' });
            const three = await fixtures.listed(t, alice, { title: 'A surf map', kind: 'game_asset' });
            const one = await t.get('/api/v1/listings?limit=2');
            assert.strictEqual(one.json().count, 2);
            assert.ok(one.json().next_cursor);
            const next = await t.get(`/api/v1/listings?limit=2&cursor=${encodeURIComponent(one.json().next_cursor)}`);
            assert.strictEqual(next.status, 200);
            assert.strictEqual(next.json().count, 1);
            assert.strictEqual(next.json().next_cursor, null);
            assert.strictEqual((await t.get('/api/v1/listings?cursor=garbage')).status, 400);
            assert.strictEqual((await t.get('/api/v1/listings?kind=nope')).status, 400);
            assert.strictEqual((await t.get('/api/v1/listings?mode=paid')).status, 400);
            const swaps = await t.get('/api/v1/listings?mode=swap');
            assert.strictEqual(swaps.json().count, 1);
            assert.strictEqual(swaps.json().listings[0].slug, two.slug);
            const q = await t.get('/api/v1/listings?q=surf');
            assert.strictEqual(q.json().count, 1);
            assert.strictEqual(q.json().listings[0].slug, three.slug);
        });

        await check('a bad listing is refused with a code, in the API and the form alike', async () => {
            const post = (body) => t.get('/api/v1/listings', { as: alice, json: body });
            const base = fixtures.body();
            assert.strictEqual((await post({ ...base, title: '' })).status, 400);
            assert.strictEqual((await post({ ...base, spends: [] })).status, 400);
            const money = await post({ ...base, summary: 'Yours for $20, cash only.' });
            assert.strictEqual(money.status, 400);
            assert.strictEqual(money.json().code, 'exchange.prohibited');
            const spend = await post({ ...base, passport: { ...base.passport, spends: ['billing.spend'] } });
            assert.strictEqual(spend.status, 400);
            assert.strictEqual(spend.json().code, 'exchange.no_money');
            const secret = await post({ ...base, manifest: { ...base.manifest, token: 'ghp_123' } });
            assert.strictEqual(secret.status, 400);
            const secretValue = await post({ ...base, manifest: { ...base.manifest, entry: 'api_key=sk-live-123' } });
            assert.strictEqual(secretValue.status, 400);
            assert.strictEqual(secretValue.json().code, 'exchange.manifest_secret');
            const freeWants = await post({ ...base, mode: 'free', wants: 'A type kit' });
            assert.strictEqual(freeWants.status, 400);
            const swapNoWants = await post({ ...base, mode: 'swap', wants: '' });
            assert.strictEqual(swapNoWants.status, 400);
            const badVersion = await post({ ...base, version: 'latest' });
            assert.strictEqual(badVersion.status, 400);
        });

        await check('a malformed body and an unknown API route are problem+json', async () => {
            const bad = await t.get('/api/v1/listings', { as: alice, body: '{', headers: { 'content-type': 'application/json' } });
            assert.strictEqual(bad.status, 400);
            assert.match(bad.headers.get('content-type'), /application\/problem\+json/);
            assert.strictEqual(bad.json().code, 'request.malformed_json');
            const nope = await t.get('/api/v1/nope');
            assert.strictEqual(nope.status, 404);
            assert.strictEqual(nope.json().code, 'route.not_found');
        });

        await check('/me/listings has every status of yours', async () => {
            const draft2 = await fixtures.create(t, alice, { title: 'A second draft' });
            const mine = await t.get('/api/v1/me/listings', { as: alice });
            assert.strictEqual(mine.status, 200);
            assert.ok(mine.json().listings.some((x) => x.slug === draft2.slug && x.status === 'draft'));
            assert.strictEqual((await t.get('/api/v1/me/listings')).status, 401);
        });

        await check('close is the owner\'s, removes it from the public list, and is idempotent', async () => {
            const close = await t.get(`/api/v1/listings/${draft.slug}/close`, { as: bob, method: 'POST' });
            assert.strictEqual(close.status, 404);
            const ok = await t.get(`/api/v1/listings/${draft.slug}/close`, { as: alice, method: 'POST', json: { reason: 'withdrawn' } });
            assert.strictEqual(ok.status, 200);
            assert.strictEqual(ok.json().status, 'closed');
            assert.strictEqual(ok.json().closed_reason, 'withdrawn');
            assert.strictEqual((await t.get(`/api/v1/listings/${draft.slug}`)).status, 404);
            const again = await t.get(`/api/v1/listings/${draft.slug}/close`, { as: alice, method: 'POST', json: {} });
            assert.strictEqual(again.status, 200);
            const pub = await t.get('/api/v1/listings?limit=50');
            assert.ok(!pub.json().listings.some((x) => x.slug === draft.slug));
        });

        await check('staff can hide a listing; the owner still sees it', async () => {
            const l = await fixtures.listed(t, alice, { title: 'A hideable template' });
            assert.strictEqual((await t.get(`/api/v1/listings/${l.slug}/hide`, { as: alice, method: 'POST' })).status, 403);
            const hide = await t.get(`/api/v1/listings/${l.slug}/hide`, { as: mod, method: 'POST' });
            assert.strictEqual(hide.status, 200);
            assert.strictEqual(hide.json().status, 'hidden');
            assert.strictEqual((await t.get(`/api/v1/listings/${l.slug}`)).status, 404);
            const owner = await t.get(`/api/v1/listings/${l.slug}`, { as: alice });
            assert.strictEqual(owner.status, 200);
            assert.strictEqual(owner.json().status, 'hidden');
        });
    } finally {
        await t.close();
    }
    done();
})();
