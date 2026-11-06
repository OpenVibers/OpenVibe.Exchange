'use strict';
/**
 * The design-review screenshots for the companions (Opus, 2026-11-06): the gallery, a character and a chat, at
 * 390 and 1280, in dark and light.
 *
 *   node scripts/shoot-companions.js [outDir]
 *
 * It boots the real app on a temp database with a mock Network and a stand-in AI, seeds a few characters, and
 * drives headless Chrome (the ov-phone-shots recipe). It checks the width (scrollWidth === viewport), the
 * console, and the tap targets at 390 px, and says what it found.
 */
const path = require('path');
const { boot } = require('../test/helpers/boot');
const { createFakeAi } = require('../test/helpers/ai');
const { chromium } = require('/home/workstation/openvibe/work/OpenVibe.Games/node_modules/playwright');

const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'screenshots'));
const CHROME = '/usr/bin/google-chrome';

const FORM = {
    name: 'Ada Lovelace',
    description: 'The first programmer. Writes algorithms as if they were music.',
    personality: 'precise, curious, warm',
    scenario: 'her study in London, 1843',
    first_message: 'Good evening. I have been thinking about the engine all day. What shall we compute?',
    example_dialogue: '<START>',
    tags: 'analytical, history, helpful',
    rating: 'everyone',
};

(async () => {
    const ai = createFakeAi();
    const t = await boot({ ai });
    const alice = t.network.addUser('alice');

    // A few characters, so the gallery has a grid and the fold has something to count.
    const people = [
        { ...FORM, name: 'Ada Lovelace' },
        { ...FORM, name: 'Alan Turing', description: 'A colleague in the history of computing.', tags: 'analytical, history' },
        { ...FORM, name: 'Grace Hopper', description: 'A colleague in the history of computing.', tags: 'helpful, history' },
        { ...FORM, name: 'Katherine Johnson', description: 'A colleague in the history of computing.', tags: 'analytical, helpful' },
        { ...FORM, name: 'Radia Perlman', description: 'A colleague in the history of computing.', tags: 'analytical' },
        { ...FORM, name: 'Margaret Hamilton', description: 'A colleague in the history of computing.', tags: 'helpful' },
        { ...FORM, name: 'Barbara Liskov', description: 'A colleague in the history of computing.', tags: 'analytical, helpful' },
        { ...FORM, name: 'Annie Easley', description: 'A colleague in the history of computing.', tags: 'history' },
        { ...FORM, name: 'Adele Goldberg', description: 'A colleague in the history of computing.', tags: 'analytical' },
        { ...FORM, name: 'Karen Sparck Jones', description: 'A colleague in the history of computing.', tags: 'helpful' },
        { ...FORM, name: 'Frances Allen', description: 'A colleague in the history of computing.', tags: 'history' },
        { ...FORM, name: 'Sophie Wilson', description: 'A colleague in the history of computing.', tags: 'analytical' },
        { ...FORM, name: 'Evelyn Boyd Granville', description: 'A colleague in the history of computing.', tags: 'helpful' },
        { ...FORM, name: 'Mary Jackson', description: 'A colleague in the history of computing.', tags: 'analytical' },
        { ...FORM, name: 'Lynn Conway', description: 'A colleague in the history of computing.', tags: 'history' },
    ];
    const made = [];
    for (const form of people) {
        const r = await t.get('/companions/new', { as: alice, form });
        if (r.status !== 303) throw new Error('the card was not made: ' + r.status + ' ' + r.text.slice(0, 300));
        made.push(r.headers.get('location'));
    }
    // The first card is public, so the gallery has one.
    const cards = await t.ctx.characters.listByOwner(alice.subject);
    for (const c of cards) {
        await t.get('/companions/' + c.id + '/share', { as: alice, form: { audience: 'public', allow_remix: '1' } });
    }

    // A chat, with a turn and an answer, so the receipt and the panel have something in them.
    const talk = await t.get(made[0] + '/talk', { as: alice, method: 'POST' });
    const chatUrl = talk.headers.get('location');
    await t.get(chatUrl + '/send', {
        as: alice,
        method: 'POST',
        form: { text: 'Good evening! Teach me about the notes.' },
    });
    await t.get(chatUrl + '/send', {
        as: alice,
        method: 'POST',
        form: { text: 'What is the first algorithm?' },
    });

    const cookie = t.signIn(alice);
    const base = t.base;
    const shots = [
        { name: 'gallery', path: '/companions' },
        { name: 'character', path: made[0] },
        { name: 'chat', path: chatUrl },
    ];

    const browser = await chromium.launch({ executablePath: CHROME });
    const problems = [];
    for (const shot of shots) {
        for (const [w, scheme] of [[390, 'dark'], [390, 'light'], [1280, 'dark'], [1280, 'light']]) {
            const ctx = await browser.newContext({
                viewport: { width: w, height: 900 }, colorScheme: scheme, deviceScaleFactor: 2,
                isMobile: w < 700, hasTouch: w < 700,
            });
            const url = new URL(base);
            await ctx.addCookies([
                { name: 'exchange_at', value: cookie.split('=')[1], domain: url.hostname, path: '/' },
                { name: 'ov_token', value: cookie.split('=')[1], domain: url.hostname, path: '/' },
                { name: 'ov_theme_id', value: scheme === 'light' ? 'daylight' : 'vibe', domain: url.hostname, path: '/' },
            ]);
            const pg = await ctx.newPage();
            // Only this site's own errors count. The Network navbar (openvibe.network) is loaded from another
            // origin on purpose; its CORS refusals and its 401 on the themes call are not ours.
            const errs = [];
            const ours = (text) => !/openvibe\.network|CORS|Failed to load resource/.test(String(text));
            pg.on('pageerror', (e) => { if (ours(e.message)) errs.push(e.message); });
            pg.on('console', (m) => { if (m.type() === 'error' && ours(m.text())) errs.push(m.text()); });
            await pg.goto(base + shot.path, { waitUntil: 'load' });
            await pg.waitForTimeout(600);
            const docW = await pg.evaluate(() => document.documentElement.scrollWidth);
            if (docW !== w) problems.push(shot.name + ' ' + w + ' ' + scheme + ': scrollWidth ' + docW + ' > ' + w);
            if (errs.length) problems.push(shot.name + ' ' + w + ' ' + scheme + ': console: ' + errs.join(' | '));
            if (w === 390) {
                const small = await pg.evaluate(() => {
                    const out = [];
                    for (const el of document.querySelectorAll('a, button, input, select, textarea')) {
                        // The Network navbar is another site's chrome; only this page's own targets count.
                        // The Network navbar and the shared footer are another site's chrome (openvibe-shared);
                        // only this page's own targets count.
                        if (el.closest('nav, .ovnav, .openvibe-navbar, .skip, .ovf-legal-inline, .ovf-col--brand, [data-network-navbar]')) continue;
                        const r = el.getBoundingClientRect();
                        if (!r.width || !r.height) continue;
                        // A visually hidden control (the styled select's native proxy, a screen-reader only
                        // input) is not a finger target: the visible control next to it is.
                        const st = getComputedStyle(el);
                        if (st.opacity === '0' || st.visibility === 'hidden' || el.closest('.ovk-sr, .sr-only, .visually-hidden')) continue;
                        if (r.height < 44) out.push(el.tagName + '.' + (el.className || '') + ' [' + String(el.textContent || '').trim().slice(0, 20) + '] parent=' + (el.parentElement ? el.parentElement.tagName + '.' + (el.parentElement.className || '') : '') + ' h=' + Math.round(r.height));
                    }
                    return out.slice(0, 8);
                });
                if (small.length) problems.push(shot.name + ' 390 ' + scheme + ': small tap targets: ' + small.join(', '));
            }
            await pg.screenshot({ path: path.join(OUT, shot.name + '-' + w + '-' + scheme + '.png'), fullPage: true });
            await pg.close();
            await ctx.close();
        }
    }
    await browser.close();
    process.stdout.write((problems.length ? 'PROBLEMS:' + String.fromCharCode(10) + problems.join(String.fromCharCode(10)) : 'clean: no overflow, no console errors, tap targets ok') + String.fromCharCode(10));
    process.exit(problems.length ? 1 : 0);
})();
