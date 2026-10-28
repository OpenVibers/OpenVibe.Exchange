'use strict';
/**
 * Free and swap: a free listing takes a claim, a swap listing takes an offer with what is given in return; only the
 * owner accepts or declines, only the sender withdraws; accepting closes the listing as given or swapped. No money
 * in an offer, and a prohibited item is refused.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const fixtures = require('./helpers/fixtures');

(async () => {
    const t = await boot();
    const alice = t.network.addUser('alice');
    const bob = t.network.addUser('bob');
    const carol = t.network.addUser('carol');
    try {
        const free = await fixtures.listed(t, alice, { title: 'A free starter theme', kind: 'theme' });
        const swap = await fixtures.listed(t, alice, { title: 'A surf map to swap', kind: 'game_asset', mode: 'swap', wants: 'A type kit' });
        let claim = null;

        await check('a free listing takes a claim; the owner can read it and a duplicate is refused', async () => {
            const r = await t.get(`/api/v1/listings/${free.slug}/offers`, { as: bob, json: { body: 'I would use this for my first site.' } });
            assert.strictEqual(r.status, 201, r.text);
            claim = r.json();
            assert.match(claim.id, /^exo_[0-9A-HJKMNP-TV-Z]{26}$/);
            assert.strictEqual(claim.kind, 'claim');
            assert.strictEqual(claim.status, 'open');
            const dup = await t.get(`/api/v1/listings/${free.slug}/offers`, { as: bob, json: { body: 'Again' } });
            assert.strictEqual(dup.status, 409);
            assert.strictEqual(dup.json().code, 'exchange.offer_exists');
            const own = await t.get(`/api/v1/listings/${free.slug}/offers`, { as: alice, json: { body: 'Mine' } });
            assert.strictEqual(own.status, 400);
            assert.strictEqual(own.json().code, 'exchange.own_listing');
            const ownerRead = await t.get(`/api/v1/listings/${free.slug}/offers`, { as: alice });
            assert.strictEqual(ownerRead.status, 200);
            assert.strictEqual(ownerRead.json().count, 1);
            assert.strictEqual((await t.get(`/api/v1/listings/${free.slug}/offers`, { as: carol })).status, 403);
            const mine = await t.get('/api/v1/offers', { as: bob });
            assert.strictEqual(mine.json().sent.length, 1);
            const owner = await t.get('/api/v1/offers', { as: alice });
            assert.strictEqual(owner.json().received.length, 1);
        });

        await check('only the owner accepts; accepting closes the free listing as given and tombstones it', async () => {
            const notOwner = await t.get(`/api/v1/offers/${claim.id}/accept`, { as: bob, method: 'POST' });
            assert.strictEqual(notOwner.status, 403);
            const accepted = await t.get(`/api/v1/offers/${claim.id}/accept`, { as: alice, method: 'POST' });
            assert.strictEqual(accepted.status, 200, accepted.text);
            assert.strictEqual(accepted.json().offer.status, 'accepted');
            assert.strictEqual(accepted.json().listing.status, 'closed');
            assert.strictEqual(accepted.json().listing.closed_reason, 'given');
            assert.strictEqual((await t.get(`/api/v1/listings/${free.slug}`)).status, 404);
            const topics = (await t.ctx.s.db.many('SELECT topic FROM exchange_outbox ORDER BY created_at')).map((x) => x.topic);
            assert.ok(topics.includes('exchange.index_document.deleted'));
        });

        await check('a swap offer must say what is given; accepting closes it as swapped', async () => {
            const noGive = await t.get(`/api/v1/listings/${swap.slug}/offers`, { as: carol, json: { body: 'I want this' } });
            assert.strictEqual(noGive.status, 400);
            const r = await t.get(`/api/v1/listings/${swap.slug}/offers`, { as: carol, json: { body: 'I have just the kit', give: 'A 12-column grid kit and an icon set' } });
            assert.strictEqual(r.status, 201, r.text);
            const offer = r.json();
            assert.strictEqual(offer.kind, 'swap');
            const accepted = await t.get(`/api/v1/offers/${offer.id}/accept`, { as: alice, method: 'POST' });
            assert.strictEqual(accepted.status, 200);
            assert.strictEqual(accepted.json().listing.closed_reason, 'swapped');
        });

        await check('withdraw and decline work for the right person; a decided offer is unchanged', async () => {
            const l = await fixtures.listed(t, alice, { title: 'A withdrawable theme' });
            const r = await t.get(`/api/v1/listings/${l.slug}/offers`, { as: bob, json: { body: 'I would like it' } });
            const offer = r.json();
            assert.strictEqual((await t.get(`/api/v1/offers/${offer.id}/withdraw`, { as: carol, method: 'POST' })).status, 403);
            const w = await t.get(`/api/v1/offers/${offer.id}/withdraw`, { as: bob, method: 'POST' });
            assert.strictEqual(w.status, 200);
            assert.strictEqual(w.json().offer.status, 'withdrawn');
            const again = await t.get(`/api/v1/offers/${offer.id}/withdraw`, { as: bob, method: 'POST' });
            assert.strictEqual(again.status, 200);
            assert.strictEqual(again.json().offer.status, 'withdrawn');

            const r2 = await t.get(`/api/v1/listings/${l.slug}/offers`, { as: carol, json: { body: 'Me instead' } });
            const o2 = r2.json();
            assert.strictEqual((await t.get(`/api/v1/offers/${o2.id}/decline`, { as: bob, method: 'POST' })).status, 403);
            const d = await t.get(`/api/v1/offers/${o2.id}/decline`, { as: alice, method: 'POST' });
            assert.strictEqual(d.status, 200);
            assert.strictEqual(d.json().offer.status, 'declined');
        });

        await check('an offer carrying money or a prohibited item is refused', async () => {
            const l = await fixtures.listed(t, alice, { title: 'A refusal theme' });
            const money = await t.get(`/api/v1/listings/${l.slug}/offers`, { as: bob, json: { body: 'I will pay you $30 by paypal.' } });
            assert.strictEqual(money.status, 400);
            assert.strictEqual(money.json().code, 'exchange.prohibited');
            const weapon = await t.get(`/api/v1/listings/${l.slug}/offers`, { as: carol, json: { body: 'I can swap a firearm.' } });
            assert.strictEqual(weapon.status, 400);
            assert.strictEqual(weapon.json().code, 'exchange.prohibited');
            const shortGive = await t.get(`/api/v1/listings/${l.slug}/offers`, { as: carol, json: { body: 'A claim with a tiny note', give: 'ok' } });
            assert.strictEqual(shortGive.status, 400);
            assert.strictEqual(shortGive.json().code, 'exchange.invalid');
        });

        await check('the offers page is server-rendered and lists both directions', async () => {
            const page = await t.get('/offers', { as: alice });
            assert.strictEqual(page.status, 200);
            assert.ok(page.text.includes('id="ex-offers"'));
            assert.ok(page.text.includes('id="ex-offers-received"'));
            assert.ok(page.text.includes('id="ex-offers-sent"'));
            assert.strictEqual((await t.get('/offers')).status, 401);
        });
    } finally {
        await t.close();
    }
    done();
})();
