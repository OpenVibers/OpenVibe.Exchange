'use strict';
/**
 * Exchange v1 is retired (design 2026-11-06): every v1 page answers 410 with a pointer, its API answers 410
 * problem+json, and its tables stay exactly as they were — readable, never written by the site. What v1 held
 * moved: agents and MCP tools to Codes and Connect, templates to Space and Report, themes to Design.
 */
const assert = require('assert');
const { ids } = require('openvibe-contracts');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');

const V1_PAGES = ['/listings', '/listings/a-template', '/submit', '/sandbox/tr_x', '/installs', '/offers', '/safety', '/developers'];

(async () => {
    const t = await boot({ ai: createFakeAi() });
    try {
        await check('every v1 page is 410 and names where the thing lives now', async () => {
            for (const p of V1_PAGES) {
                const r = await t.get(p);
                assert.strictEqual(r.status, 410, p);
                assert.match(r.headers.get('cache-control'), /max-age=86400/);
                assert.ok(r.text.includes('retired'), `${p} says retired`);
                assert.ok(r.text.includes('openvibe.design') || r.text.includes('openvibe.codes') || r.text.includes('/'), `${p} points somewhere`);
                assert.ok(!r.text.includes('id="ex-listings"'), `${p} is not the old page`);
            }
        });

        await check('v1’s API is 410 problem+json with a pointer', async () => {
            for (const p of ['/api/v1/ping', '/api/v1/listings', '/api/v1/listings/a-template']) {
                const r = await t.get(p);
                assert.strictEqual(r.status, 410, p);
                assert.match(r.headers.get('content-type'), /application\/problem\+json/);
                assert.strictEqual(r.json().code, 'exchange.retired');
                assert.match(r.json().detail, /api\.openvibe\.exchange/);
            }
        });

        await check('the v1 tables are still there, and a row written before the retirement still reads', async () => {
            const db = t.ctx.s.db;
            const lid = `exl_${ids.ulid()}`;
            const slug = `kept-${ids.ulid().slice(-8).toLowerCase()}`;
            await db.exec(`INSERT INTO exchange_listings (id, slug, title, mode, summary, license, version, creator, kind, status, listed_at, manifest, passport)
                VALUES ($1, $2, 'A kept listing', 'free', 'Still readable.', 'CC0-1.0', '1.0.0', 'A maker', 'template', 'listed', now(), '{"name":"x","entry":"y"}'::jsonb, '{"reads":[],"writes":[],"spends":[],"contacts":[]}'::jsonb)`, [lid, slug]);
            const row = await db.maybe('SELECT title, status FROM exchange_listings WHERE id = $1', [lid]);
            assert.deepStrictEqual({ title: row.title, status: row.status }, { title: 'A kept listing', status: 'listed' });
        });

        await check('the site writes nothing to a v1 table', async () => {
            const db = t.ctx.s.db;
            const count = async (table) => Number(await db.value(`SELECT COUNT(*)::int AS n FROM ${table}`));
            const before = { listings: await count('exchange_listings'), events: await count('exchange_listing_events'), offers: await count('exchange_offers'), installs: await count('exchange_installs') };
            const alice = t.network.addUser('alice');
            for (const p of ['/', '/models', '/api', '/sell', '/uncensored', '/ai']) await t.get(p, { as: alice });
            for (const p of ['/chat/send']) await t.get(p, { as: alice, form: { text: 'hello' } });
            assert.deepStrictEqual({ listings: await count('exchange_listings'), events: await count('exchange_listing_events'), offers: await count('exchange_offers'), installs: await count('exchange_installs') }, before);
        });
    } finally { await t.close(); }
    done();
})();
