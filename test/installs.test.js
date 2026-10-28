'use strict';
/**
 * Sandbox, install and revoke: a public listing can be tried, a passed trial is required for the install, the
 * install keeps the passport snapshot, a revoke is one tap and idempotent, and installing again needs a fresh
 * trial. A draft cannot be tried; another person cannot read or revoke your install.
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
        const draft = await fixtures.create(t, alice);
        const listing = await fixtures.listed(t, alice, { title: 'A sandboxable template' });
        let trial = null;
        let installed = null;

        await check('a draft cannot be tried; a listed one gets a passed manifest dry run', async () => {
            assert.strictEqual((await t.get(`/api/v1/listings/${draft.slug}/sandbox`, { as: bob, method: 'POST' })).status, 404);
            const out = await fixtures.sandbox(t, bob, listing.slug);
            trial = out.trial;
            assert.match(trial.id, /^exs_[0-9A-HJKMNP-TV-Z]{26}$/);
            assert.strictEqual(trial.status, 'passed');
            assert.strictEqual(trial.checks.length, 4);
            assert.ok(trial.checks.some((c) => c.name === 'execution' && /dry run/i.test(c.detail)));
            assert.strictEqual(trial.passport.spends.length, 0);
            const page = await t.get(`/sandbox/${trial.id}`, { as: bob });
            assert.strictEqual(page.status, 200);
            assert.ok(page.text.includes('id="ex-sandbox-trial"'));
            assert.ok(page.text.includes('id="ex-passport"'));
            assert.strictEqual((await t.get(`/sandbox/${trial.id}`, { as: carol })).status, 404);
        });

        await check('an install is refused until a trial passed, then keeps the passport snapshot', async () => {
            const noTrial = await fixtures.listed(t, alice, { title: 'A no-trial template' });
            const r = await t.get(`/api/v1/listings/${noTrial.slug}/install`, { as: carol, method: 'POST' });
            assert.strictEqual(r.status, 409);
            assert.strictEqual(r.json().code, 'exchange.sandbox_required');
            const out = await fixtures.install(t, bob, listing.slug);
            installed = out;
            assert.match(installed.id, /^exi_[0-9A-HJKMNP-TV-Z]{26}$/);
            assert.strictEqual(installed.status, 'active');
            assert.deepStrictEqual(installed.passport.reads, ['search.read']);
            assert.strictEqual(installed.listing.slug, listing.slug);
            const list = await t.get('/api/v1/installs', { as: bob });
            assert.strictEqual(list.json().count, 1);
            assert.strictEqual(list.json().installs[0].id, installed.id);
            const again = await t.get(`/api/v1/listings/${listing.slug}/install`, { as: bob, method: 'POST' });
            assert.strictEqual(again.status, 200);
            assert.strictEqual(again.json().id, installed.id);
            assert.strictEqual(Number(await t.ctx.s.db.value('SELECT COUNT(*)::int AS n FROM exchange_installs')), 1);
        });

        await check('another person cannot revoke your install; a revoke is one tap and idempotent', async () => {
            assert.strictEqual((await t.get(`/api/v1/installs/${installed.id}/revoke`, { as: carol, method: 'POST' })).status, 404);
            const r = await t.get(`/api/v1/installs/${installed.id}/revoke`, { as: bob, method: 'POST' });
            assert.strictEqual(r.status, 200);
            assert.strictEqual(r.json().status, 'revoked');
            assert.ok(r.json().revoked_at);
            const again = await t.get(`/api/v1/installs/${installed.id}/revoke`, { as: bob, method: 'POST' });
            assert.strictEqual(again.status, 200);
            assert.strictEqual(again.json().status, 'revoked');
            const list = await t.get('/api/v1/installs', { as: bob });
            assert.strictEqual(list.json().installs[0].status, 'revoked');
            assert.strictEqual((await t.get('/api/v1/installs')).status, 401);
        });

        await check('installing again needs a fresh trial; the first one was consumed', async () => {
            const r = await t.get(`/api/v1/listings/${listing.slug}/install`, { as: bob, method: 'POST' });
            assert.strictEqual(r.status, 409);
            assert.strictEqual(r.json().code, 'exchange.sandbox_required');
            const fresh = await fixtures.sandbox(t, bob, listing.slug);
            assert.notStrictEqual(fresh.trial.id, trial.id);
            const reinstalled = await fixtures.install(t, bob, listing.slug);
            assert.strictEqual(reinstalled.status, 'active');
            assert.notStrictEqual(reinstalled.id, installed.id);
            const consumed = await t.ctx.s.db.value('SELECT COUNT(*)::int AS n FROM exchange_sandbox_trials WHERE consumed_at IS NOT NULL');
            assert.strictEqual(Number(consumed), 2);
        });

        await check('an expired trial cannot install', async () => {
            const l = await fixtures.listed(t, alice, { title: 'An expiring template' });
            const out = await fixtures.sandbox(t, carol, l.slug);
            await t.ctx.s.db.exec("UPDATE exchange_sandbox_trials SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' WHERE id = $1", [out.trial.id]);
            const r = await t.get(`/api/v1/listings/${l.slug}/install`, { as: carol, method: 'POST' });
            assert.strictEqual(r.status, 409);
        });

        await check('a session write from another site is refused', async () => {
            const l = await fixtures.listed(t, alice, { title: 'A cross-site template' });
            const r = await t.get(`/api/v1/listings/${l.slug}/sandbox`, { as: bob, method: 'POST', origin: 'https://evil.example' });
            assert.strictEqual(r.status, 403);
            assert.strictEqual(r.json().code, 'exchange.cross_site');
        });

        await check('the installs page is complete without JavaScript and lists active and revoked', async () => {
            const page = await t.get('/installs', { as: bob });
            assert.strictEqual(page.status, 200);
            assert.ok(page.text.includes('id="ex-installs"'));
            assert.ok(page.text.includes('id="ex-installs-active"'));
            assert.ok(page.text.includes('id="ex-installs-revoked"'));
            assert.ok(page.text.includes('ex-passport'));
            assert.ok(page.text.includes('action="/installs/'));
            assert.strictEqual(page.headers.get('cache-control'), 'private, no-store');
            assert.strictEqual((await t.get('/installs')).status, 401);
        });
    } finally {
        await t.close();
    }
    done();
})();
