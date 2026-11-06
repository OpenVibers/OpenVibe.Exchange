'use strict';
/**
 * The first proof: a licensed template listed, tried in the sandbox, installed with its passport's grants and
 * revoked cleanly; a second run changes nothing. The seed uses the same store functions as the API and pages.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { runSeed, SLUG, LICENSE } = require('../scripts/seed-proof');

(async () => {
    const t = await boot();
    try {
        let out = null;
        await check('the seed lists a CC0 template, tries it, installs and revokes it', async () => {
            out = await runSeed({ config: t.config, s: t.ctx.s, log: { log() {} } });
            assert.strictEqual(out.created, true);
            assert.strictEqual(out.listing.slug, SLUG);
            assert.strictEqual(out.listing.status, 'listed');
            assert.strictEqual(out.listing.mode, 'free');
            assert.strictEqual(out.listing.license, LICENSE);
            assert.strictEqual(out.listing.tests.verified, true);
            assert.strictEqual(out.trial.status, 'passed');
            assert.deepStrictEqual(out.install.passport.reads, ['search.read']);
            assert.strictEqual(out.revoked.status, 'revoked');
            assert.strictEqual(Number(await t.ctx.s.db.value('SELECT COUNT(*)::int AS n FROM exchange_listing_tests WHERE listing_id = $1 AND status = \'passed\'', [out.listing.id])), 4);
            assert.strictEqual(Number(await t.ctx.s.db.value("SELECT COUNT(*)::int AS n FROM exchange_outbox WHERE topic = 'exchange.index_document.upserted'")), 1);
            assert.strictEqual(Number(await t.ctx.s.db.value('SELECT COUNT(*)::int AS n FROM exchange_listings')), 1);
        });

        await check('the public page and API show it; a second run adds nothing', async () => {
            assert.strictEqual((await t.get(`/listings/${SLUG}`)).status, 200);
            const api = await t.get(`/api/v1/listings/${SLUG}`);
            assert.strictEqual(api.status, 200);
            assert.strictEqual(api.json().license, LICENSE);
            const again = await runSeed({ config: t.config, s: t.ctx.s, log: { log() {} } });
            assert.strictEqual(again.created, false);
            assert.strictEqual(Number(await t.ctx.s.db.value('SELECT COUNT(*)::int AS n FROM exchange_listings')), 1);
            assert.strictEqual(Number(await t.ctx.s.db.value('SELECT COUNT(*)::int AS n FROM exchange_installs')), 1);
        });
    } finally {
        await t.close();
    }
    done();
})();
