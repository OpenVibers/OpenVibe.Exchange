'use strict';
/**
 * The expand migration applies in one pass and creates exactly the tables the plan names, plus the SDK's account
 * receipts and telemetry. The listing constraints are real: no money, a passport with an empty spend, a
 * free/swap-only mode, and one active install / one open offer per person and listing.
 */
const assert = require('assert');
const { ids } = require('openvibe-contracts');
const { boot, check, done } = require('./helpers/boot');

(async () => {
    const t = await boot();
    try {
        await check('0001_initial.sql applies and creates the Exchange tables', async () => {
            const names = (await t.ctx.s.db.many("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name")).map((r) => r.name);
            for (const table of ['exchange_listings', 'exchange_listing_tests', 'exchange_listing_events', 'exchange_sandbox_trials', 'exchange_installs', 'exchange_offers', 'exchange_outbox', 'account_data_events', 'telemetry_samples']) {
                assert.ok(names.includes(table), `missing ${table}`);
            }
        });

        await check('there is no money column on a listing', async () => {
            const cols = (await t.ctx.s.db.many("SELECT column_name FROM information_schema.columns WHERE table_name = 'exchange_listings'")).map((r) => r.column_name);
            for (const forbidden of ['price', 'price_vibes', 'currency', 'billing_intent_id', 'amount']) assert.ok(!cols.includes(forbidden), forbidden);
            assert.ok(cols.includes('passport'));
            assert.ok(cols.includes('manifest'));
        });

        await check('a listing refuses an unknown kind and a spend in its passport', async () => {
            const db = t.ctx.s.db;
            const insert = (slug, kind, passport) => db.exec(
                `INSERT INTO exchange_listings (id, slug, title, mode, summary, license, version, creator, kind, manifest, passport)
                 VALUES ($1, $2, 'A listing', 'free', 'A summary', 'CC0-1.0', '1.0.0', 'A maker', $3, '{"name":"x","entry":"y"}'::jsonb, $4::jsonb)`,
                [`exl_${ids.ulid()}`, slug, kind, JSON.stringify(passport)],
            );
            await assert.rejects(insert('bad-kind', 'notakind', { reads: [], writes: [], spends: [], contacts: [] }), /exchange_listings_kind/);
            await assert.rejects(insert('bad-spend', 'template', { reads: [], writes: [], spends: ['billing.spend'], contacts: [] }), /exchange_listings_passport/);
            await insert('bad-mode', 'template', { reads: [], writes: [], spends: [], contacts: [] });
            await assert.rejects(db.exec("UPDATE exchange_listings SET mode = 'paid' WHERE slug = 'bad-mode'"), /exchange_listings_mode/);
            await insert('bad-wants', 'template', { reads: [], writes: [], spends: [], contacts: [] });
            await assert.rejects(db.exec("UPDATE exchange_listings SET wants = 'money' WHERE slug = 'bad-wants'"), /exchange_listings_wants/);
        });

        await check('the one-active-install and one-open-offer indexes are real', async () => {
            const db = t.ctx.s.db;
            const subject = ids.newId('user');
            const at = new Date().toISOString();
            const lid = `exl_${ids.ulid()}`;
            await db.exec(`INSERT INTO exchange_listings (id, slug, title, mode, summary, license, version, creator, kind, status, listed_at, manifest, passport)
                VALUES ($1, 'installable', 'Installable', 'free', 'A summary', 'CC0-1.0', '1.0.0', 'A maker', 'template', 'listed', $2, '{"name":"x","entry":"y"}'::jsonb, '{"reads":[],"writes":[],"spends":[],"contacts":[]}'::jsonb)`, [lid, at]);
            const iid = () => `exi_${ids.ulid()}`;
            await db.exec(`INSERT INTO exchange_installs (id, listing_id, subject, version, passport) VALUES ($1, $2, $3, '1.0.0', '{"reads":[],"writes":[],"spends":[],"contacts":[]}'::jsonb)`, [iid(), lid, subject]);
            await assert.rejects(db.exec(`INSERT INTO exchange_installs (id, listing_id, subject, version, passport) VALUES ($1, $2, $3, '1.0.0', '{"reads":[],"writes":[],"spends":[],"contacts":[]}'::jsonb)`, [iid(), lid, subject]), /duplicate key|unique/i);
            const oid = () => `exo_${ids.ulid()}`;
            const offer = (id) => db.exec(`INSERT INTO exchange_offers (id, listing_id, from_subject, from_name, kind, body) VALUES ($1, $2, $3, 'A person', 'claim', 'I would like this')`, [id, lid, subject]);
            await offer(oid());
            await assert.rejects(offer(oid()), /duplicate key|unique/i);
        });

        await check('the conformance test rows are one per version and name', async () => {
            const db = t.ctx.s.db;
            const lid = await db.value("SELECT id FROM exchange_listings WHERE slug = 'installable'");
            await db.exec("INSERT INTO exchange_listing_tests (listing_id, version, name, status) VALUES ($1, '1.0.0', 'manifest', 'passed')", [lid]);
            await assert.rejects(db.exec("INSERT INTO exchange_listing_tests (listing_id, version, name, status) VALUES ($1, '1.0.0', 'manifest', 'failed')", [lid]), /duplicate key|unique/i);
        });
    } finally {
        await t.close();
    }
    done();
})();
