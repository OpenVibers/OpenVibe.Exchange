'use strict';
/**
 * Design-review screenshots for the Arena, the rankings and the status changelog: 390 and 1280, dark and light.
 *
 *   node scripts/shoot-arena.js [outDir]
 *
 * The shots go outside the repository (a temporary folder by default): pictures of the site, never committed.
 * It boots the real app on a temp database with a mock Network, a stand-in AI and a stand-in Bench, seeds a
 * blind round, a board and two days of catalogue snapshots, and drives headless Chrome.
 */
const path = require('path');
const os = require('os');
const { boot } = require('../test/helpers/boot');
const { createFakeAi } = require('../test/helpers/ai');
const { createFakeBench } = require('../test/helpers/bench');
const { chromium } = require('/home/workstation/openvibe/work/OpenVibe.Games/node_modules/playwright');

const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'exchange-arena-shots'));
const CHROME = '/usr/bin/google-chrome';

const BOARD = {
    unavailable: false, kind_id: 'chat.arena', category: 'all',
    rows: [
        { subject: 'deepseek/deepseek-chat', elo: 1128, games: 42, wins: 27, losses: 13, ties: 2, win_rate: 0.6667, provisional: false },
        { subject: 'qwen/qwen3-32b', elo: 1044, games: 31, wins: 17, losses: 13, ties: 1, win_rate: 0.5645, provisional: false },
        { subject: 'meta-llama/llama-3-8b-abliterated', elo: 962, games: 12, wins: 4, losses: 8, ties: 0, win_rate: 0.3333, provisional: false },
    ],
};

(async () => {
    const bench = createFakeBench({ board: async (args) => ({ ...BOARD, category: args.category }) });
    const t = await boot({
        ai: createFakeAi({
            chat: (args) => ({
                content: args.model.startsWith('deepseek')
                    ? 'Use csv.DictReader, skip blank rows, and keep the sum in a Decimal so a float never rounds a currency column. Raise a clear error when the column is missing or holds a value that is not a number.'
                    : 'Read the file with open(..., newline=""), parse each row, check that the column exists, and add only values that parse as float. Report the line number of the first bad value instead of failing silently.',
                model: args.model, provider: 'deepseek', run_id: 'run_shot', cost_usd: 0.0002,
                usage: { tokens_in: 12, tokens_out: 30 }, tokens_in: 90, tokens_out: 240, latency_ms: 640,
                why: ['the cheapest healthy offer inside the free ceiling'],
            }),
        }),
        bench,
    });
    const alice = t.network.addUser('alice');

    const asked = await t.get('/arena/ask', {
        as: alice,
        form: { prompt: 'Write a Python function that reads a CSV and sums a numeric column. Explain the edge cases.' },
    });
    if (asked.status !== 303) throw new Error('the round was not made: ' + asked.status + ' ' + asked.text.slice(0, 300));
    const roundUrl = asked.headers.get('location');

    const db = t.ctx.s.db;
    for (const [slug, name, family, priceIn, priceOut] of [
        ['deepseek/deepseek-chat', 'DeepSeek Chat', 'DeepSeek', 0.10, 0.20],
        ['qwen/qwen3-32b', 'Qwen3 32B', 'Qwen', 0.40, 0.90],
        ['old/model', 'Old Model', 'Other', 1, 2],
    ]) {
        await db.prepare(`INSERT INTO exchange_model_snapshots (day, slug, name, family, price_in, price_out, provider)
            VALUES ('2026-11-05', ?, ?, ?, ?, ?, 'deepseek')`).run(slug, name, family, priceIn, priceOut);
    }

    const cookie = t.signIn(alice);
    const base = t.base;
    const shots = [
        { name: 'arena-home', path: '/arena' },
        { name: 'arena-blind', path: roundUrl },
    ];

    const browser = await chromium.launch({ executablePath: CHROME });
    const problems = [];
    async function shoot(shot, w, scheme) {
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

    for (const shot of shots) for (const [w, scheme] of [[390, 'dark'], [390, 'light'], [1280, 'dark'], [1280, 'light']]) await shoot(shot, w, scheme);

    // The vote, then the reveal, then the board and the changelog.
    await t.get(roundUrl + '/vote', { as: alice, form: { outcome: 'left' } });
    for (const shot of [
        { name: 'arena-revealed', path: roundUrl },
        { name: 'rankings', path: '/rankings?category=code' },
        { name: 'status', path: '/status' },
    ]) for (const [w, scheme] of [[390, 'dark'], [390, 'light'], [1280, 'dark'], [1280, 'light']]) await shoot(shot, w, scheme);

    await browser.close();
    await t.close();
    process.stdout.write((problems.length ? 'PROBLEMS:\n' + problems.join('\n') : `clean: ${OUT}`) + '\n');
    process.exit(problems.length ? 1 : 0);
})();
