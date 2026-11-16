'use strict';
/**
 * The owner opens the console with the token Network really signs (the owner, 11-16: "it shows this even though I am a
 * owner"): Network keeps the owner's role (admin) and adds `is_owner: true` (Network auth/staff-claims.js); it never
 * signs role "owner". The test mock signed role "owner", so every console test passed while the owner was turned away.
 * An admin who is not the owner, and a user, still are.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');

(async () => {
    const t = await boot({ ai: createFakeAi() });
    try {
        await check('the owner (admin + is_owner) opens the console; an admin and a user do not', async () => {
            const boss = t.network.addUser('boss', { role: 'owner' });
            const claims = JSON.parse(Buffer.from(t.network.userToken(boss).split('.')[1], 'base64url').toString('utf8'));
            assert.deepStrictEqual([claims.role, claims.is_owner], ['admin', true], 'the mock signs the owner as Network does');
            const page = await t.get('/console', { as: boss });
            assert.ok(!page.text.includes("The console is the owner's"), `the owner is let in (status ${page.status})`);
            assert.ok(/AI console/.test(page.text), 'the menu names the console for the owner');
            const admin = await t.get('/console', { as: t.network.addUser('helper', { role: 'admin' }) });
            assert.ok(admin.text.includes("The console is the owner's"), 'an admin who is not the owner is not');
            const user = await t.get('/console', { as: t.network.addUser('someone') });
            assert.ok(user.text.includes("The console is the owner's"), 'a user is not');
        });
    } finally {
        await t.close();
    }
    done();
})().catch((e) => { console.error(e); process.exit(1); });
