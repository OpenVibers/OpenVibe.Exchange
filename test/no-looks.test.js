'use strict';
/**
 * No looks in public AI text: a summary that names looks is replaced by the listing's title; an ordinary summary
 * survives. Exchange v1 has no AI-written listing copy — this is the helper used the day a generated summary or
 * sandbox line arrives, shared with Live, Community, MediaHub and Meme.
 */
const assert = require('assert');
const { cleanSummary, hasLooks } = require('../server/text/no-looks');
const { boot, check, done } = require('./helpers/boot');

(async () => {
    await check('a summary that names looks becomes the title', async () => {
        assert.strictEqual(cleanSummary('Starter site template', 'A shirtless man in a kitchen laughs.'), 'Starter site template');
        assert.strictEqual(cleanSummary('Starter site template', 'A pretty girl shows the theme.'), 'Starter site template');
        assert.ok(hasLooks('A shirtless man in a kitchen laughs.'));
    });

    await check('an ordinary summary survives', async () => {
        const s = cleanSummary('Starter site template', 'A static starter site with one page and no tracking.');
        assert.strictEqual(s, 'A static starter site with one page and no tracking.');
    });

    const t = await boot();
    try {
        await check('a creator\'s own listing words are not rewritten by noLooks', async () => {
            const user = t.network.addUser('maker');
            const r = await t.get('/api/v1/listings', {
                as: user,
                json: {
                    title: 'A portrait lighting theme', kind: 'theme', mode: 'free',
                    summary: 'A warm portrait theme; the maker describes the lighting, not a person.',
                    license: 'MIT', version: '1.0.0',
                    manifest: { name: 'Portrait lighting', entry: 'theme.json', runtime: 'css' },
                    passport: { reads: [], writes: [], spends: [], contacts: [] },
                },
            });
            assert.strictEqual(r.status, 201, r.text);
            assert.strictEqual(r.json().summary, 'A warm portrait theme; the maker describes the lighting, not a person.');
        });
    } finally {
        await t.close();
    }
    done();
})();
