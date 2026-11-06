'use strict';
/**
 * The design-review screenshots for private AI (Opus, 2026-11-06): a chat with a private answer and its receipt,
 * the API page's strict-privacy switch, and a sealed chat's shell, at 390 and 1280, in dark and light.
 *
 *   node scripts/shoot-private.js [outDir]
 *
 * The shots go to a folder outside the repository (a temporary one by default): they are pictures of the site, not
 * code, and they are never committed.
 *
 * It boots the real app on a temp database with a mock Network and a stand-in AI, and drives headless Chrome (the
 * ov-phone-shots recipe). It checks the width (scrollWidth === viewport), the console, and the tap targets at
 * 390 px, and says what it found. The sealed chat is shown locked: the Locker's key directory is Network's, and
 * this page's own script has nothing to unlock without a real person. What is reviewed here is the shell.
 */
const path = require('path');
const os = require('os');
const { boot } = require('../test/helpers/boot');
const { createFakeAi } = require('../test/helpers/ai');
const { chromium } = require('/home/workstation/openvibe/work/OpenVibe.Games/node_modules/playwright');

const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'exchange-private-shots'));
const CHROME = '/usr/bin/google-chrome';

function privateAi() {
    const base = createFakeAi();
    return {
        ...base,
        presets: [],
        async presetsFor() { return this.presets; },
        async setKeyPrivacy(subject, on) { this.presets = on ? [{ name: 'default', scope: 'owner', policy: { data_policy: 'private' } }] : []; return { on }; },
        async chat(args) {
            const out = await base.chat(args);
            return {
                ...out,
                privacy: args.preset === 'private' ? 'private' : 'anonymized',
                privacy_detail: { label: args.preset === 'private' ? 'private' : 'anonymized', retention: args.preset === 'private' ? 'none' : 'standard', training: args.preset === 'private' ? false : null, region: null, trust: 'first-party', known: true },
                preset: args.preset || null,
            };
        },
    };
}

(async () => {
    const ai = privateAi();
    const t = await boot({ ai });
    const alice = t.network.addUser('alice');

    // A chat with a strict answer, so the receipt has its privacy row.
    const sent = await t.get('/chat/send', {
        as: alice,
        form: { text: 'Which offers keep nothing? I would like a straight answer about data retention.', strict_privacy: '1', 'models_deepseek/deepseek-chat': '1' },
    });
    if (sent.status !== 303) throw new Error('the chat was not made: ' + sent.status + ' ' + sent.text.slice(0, 300));
    const chatUrl = sent.headers.get('location');
    await t.get(chatUrl + '/send', { as: alice, form: { text: 'And in one sentence?', strict_privacy: '1', 'models_deepseek/deepseek-chat': '1' } });

    // The key switch on, so the API page shows it on.
    await t.get('/privacy/keys', { as: alice, form: { strict: '1' } });

    // A sealed chat's shell (locked: no Locker in a headless browser without a person).
    const sealed = await t.get('/chat/sealed/new', { as: alice, json: { envelope: Buffer.alloc(96, 7).toString('base64') } });
    const sealedUrl = sealed.json().url;

    const cookie = t.signIn(alice);
    const base = t.base;
    const shots = [
        { name: 'chat-private', path: chatUrl },
        { name: 'api-strict', path: '/api' },
        { name: 'sealed-chat', path: sealedUrl },
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
            const errs = [];
            const ours = (text) => !/openvibe\.network|CORS|Failed to load resource|net::ERR/.test(String(text));
            pg.on('pageerror', (e) => { if (ours(e.message)) errs.push(e.message); });
            pg.on('console', (m) => { if (m.type() === 'error' && ours(m.text())) errs.push(m.text()); });
            await pg.goto(base + shot.path, { waitUntil: 'load' });
            await pg.waitForTimeout(900);
            const docW = await pg.evaluate(() => document.documentElement.scrollWidth);
            if (docW !== w) problems.push(shot.name + ' ' + w + ' ' + scheme + ': scrollWidth ' + docW + ' > ' + w);
            if (errs.length) problems.push(shot.name + ' ' + w + ' ' + scheme + ': console: ' + errs.join(' | '));
            if (w === 390) {
                const small = await pg.evaluate(() => {
                    const out = [];
                    for (const el of document.querySelectorAll('a, button, input, select, textarea')) {
                        if (el.closest('nav, .ovnav, .openvibe-navbar, .skip, .ovf-legal-inline, .ovf-col--brand, [data-network-navbar]')) continue;
                        const r = el.getBoundingClientRect();
                        if (!r.width || !r.height) continue;
                        const st = getComputedStyle(el);
                        if (st.opacity === '0' || st.visibility === 'hidden' || el.closest('.ovk-sr, .sr-only, .visually-hidden')) continue;
                        if (r.height < 44) out.push(el.tagName + '.' + (el.className || '') + ' [' + String(el.textContent || '').trim().slice(0, 20) + '] h=' + Math.round(r.height));
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
    process.stdout.write((problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'clean: no overflow, no console errors, tap targets ok') + '\n');
    process.stdout.write('shots: ' + OUT + '\n');
    await t.close();
    process.exit(problems.length ? 1 : 0);
})();
