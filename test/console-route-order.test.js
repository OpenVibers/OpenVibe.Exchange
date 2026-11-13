'use strict';
/**
 * The owner's console is reached (2026-11-13): it was mounted after the pages, whose Not found answered every path
 * first, so /console/providers (where the admin guide sends the owner) said "Nothing lives at". Only /console reaches
 * the console's router (its owner check is for every request it sees), so the pages still answer everyone else, and
 * the pages' own Not found carries its link as a link, not as escaped markup.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');

(async () => {
    const t = await boot({ ai: createFakeAi() });
    try {
        await check('/console is the console\'s, not the pages\' Not found', async () => {
            const r = await t.get('/console/providers');
            assert.strictEqual(r.status, 404, 'signed out: the console\'s own 404');
            assert.ok(!r.text.includes('Nothing lives at'), 'not the pages\' Not found');
        });
        await check('the pages answer everyone else as before', async () => {
            assert.strictEqual((await t.get('/')).status, 200);
            assert.strictEqual((await t.get('/models')).status, 200);
        });
        await check('the pages\' Not found has a real link', async () => {
            const r = await t.get('/no-such-page');
            assert.strictEqual(r.status, 404);
            assert.ok(r.text.includes('Nothing lives at /no-such-page.'), 'says where');
            assert.ok(!r.text.includes('&lt;a href'), 'no escaped markup');
            assert.ok(/<a[^>]+href="\/"[^>]*>[\s\S]*?Every model/.test(r.text), 'a link to every model');
        });
    } finally { await done(t); }
})().catch((e) => { console.error(e); process.exit(1); });
