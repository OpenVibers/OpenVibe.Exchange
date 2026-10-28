'use strict';
/**
 * The Search Fabric document: owner exchange, type listing, id exl_…, canonical /listings/<slug>, title/summary,
 * facets kind/mode/licence/creator and the passport permissions, authorship human, the listing's revision. A draft
 * writes nothing; publishing upserts; closing or hiding writes a valid tombstone.
 */
const assert = require('assert');
const contracts = require('openvibe-contracts');
const { boot, check, done } = require('./helpers/boot');
const fixtures = require('./helpers/fixtures');

(async () => {
    const t = await boot();
    const alice = t.network.addUser('alice');
    const mod = t.network.addUser('mod', { role: 'global_mod' });
    try {
        const l = await fixtures.listed(t, alice, { title: 'A searchable template' });

        await check('publishing writes a valid search.index-document@1', async () => {
            const row = await t.ctx.s.db.maybe("SELECT topic, payload FROM exchange_outbox WHERE topic = 'exchange.index_document.upserted' ORDER BY created_at DESC LIMIT 1");
            assert.ok(row, 'an upsert row exists');
            const doc = row.payload;
            const v = contracts.validate('search.index-document@1', doc);
            assert.strictEqual(v.valid, true, JSON.stringify(v.errors));
            assert.strictEqual(doc.owner, 'exchange');
            assert.strictEqual(doc.type, 'listing');
            assert.strictEqual(doc.id, l.id);
            assert.strictEqual(doc.revision, l.revision);
            assert.strictEqual(doc.deleted, false);
            assert.strictEqual(doc.visibility, 'public');
            assert.strictEqual(doc.publication_state, 'published');
            assert.strictEqual(doc.canonical_url, `https://openvibe.exchange/listings/${l.slug}`);
            assert.strictEqual(doc.title, 'A searchable template');
            assert.strictEqual(doc.facets.kind, 'template');
            assert.strictEqual(doc.facets.mode, 'free');
            assert.strictEqual(doc.facets.license, 'CC0-1.0');
            assert.deepStrictEqual(doc.facets.can_read, ['search.read']);
            assert.strictEqual(doc.authorship, 'human');
            assert.ok(doc.body.includes('search.read'));
            assert.ok(doc.body.includes('Licence: CC0-1.0'));
        });

        await check('a draft writes no document; closing sends a valid tombstone with the next revision', async () => {
            const draft = await fixtures.create(t, alice, { title: 'A never-listed theme' });
            assert.strictEqual((await t.ctx.s.db.value('SELECT COUNT(*)::int AS n FROM exchange_outbox WHERE payload->>\'id\' = $1', [draft.id])), 0);
            const r = await t.get(`/api/v1/listings/${l.slug}/close`, { as: alice, method: 'POST', json: { reason: 'withdrawn' } });
            assert.strictEqual(r.status, 200);
            const tomb = await t.ctx.s.db.maybe("SELECT payload FROM exchange_outbox WHERE topic = 'exchange.index_document.deleted' ORDER BY created_at DESC LIMIT 1");
            assert.strictEqual(contracts.validate('search.index-document@1', tomb.payload).valid, true, JSON.stringify(contracts.validate('search.index-document@1', tomb.payload).errors));
            assert.strictEqual(tomb.payload.deleted, true);
            assert.strictEqual(tomb.payload.id, l.id);
            assert.strictEqual(tomb.payload.revision, r.json().revision);
        });

        await check('a staff hide also writes a tombstone and the public list stays empty', async () => {
            const l2 = await fixtures.listed(t, alice, { title: 'A hideable search theme' });
            const r = await t.get(`/api/v1/listings/${l2.slug}/hide`, { as: mod, method: 'POST' });
            assert.strictEqual(r.status, 200);
            const row = await t.ctx.s.db.maybe("SELECT payload FROM exchange_outbox WHERE topic = 'exchange.index_document.deleted' AND payload->>'id' = $1", [l2.id]);
            assert.ok(row);
            assert.strictEqual(row.payload.revision, r.json().revision);
            const pub = await t.get('/api/v1/listings?limit=50');
            assert.strictEqual(pub.json().count, 0);
        });
    } finally {
        await t.close();
    }
    done();
})();
