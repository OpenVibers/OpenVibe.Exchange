'use strict';
/**
 * The design-review screenshots for the API platform (Opus, 2026-11-09): home, the Dashboard's tabs and Search, at 390
 * and 1280, dark and light. It boots the real app on a temp database with a mock Network and a stand-in AI holding two
 * keys and a week of usage, and drives headless Chrome. It checks the width (scrollWidth === viewport) and tap
 * targets at 390, and says what it found. The shots go outside the repository (never committed).
 *
 *   node scripts/shoot-platform.js [outDir] [paths, comma separated]
 */
const path = require('path');
const os = require('os');
const { boot } = require('../test/helpers/boot');
const { createFakeAi } = require('../test/helpers/ai');
const { chromium } = require('/home/workstation/openvibe/work/OpenVibe.Games/node_modules/playwright');

const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'exchange-platform-shots'));
const PATHS = (process.argv[3] || '/,/dashboard/keys,/dashboard/usage,/dashboard/credits,/dashboard/deployments,/dashboard/settings,/search').split(',');

const KEYS = [
    { id: 'xkey_1', name: 'My application', prefix: 'ovx_demo12', monthly_cap_usd: 10, allowed_models: [], created_at: '2026-11-08T10:00:00Z', revoked_at: null },
    { id: 'xkey_2', name: 'Night batch jobs', prefix: 'ovx_n8Kq3z', monthly_cap_usd: 25, allowed_models: ['deepseek/deepseek-chat', 'qwen/qwen3-32b'], created_at: '2026-11-01T10:00:00Z', revoked_at: null },
];
const USAGE = [];
for (let d = 1; d <= 7; d++) {
    USAGE.push({ day: `2026-11-0${d}`, key_id: 'xkey_1', model: 'deepseek/deepseek-chat', status: 'settled', requests: 40 * d, tokens_in: 9000 * d, tokens_out: 4000 * d, cost_usd: 0.004 * d });
    if (d % 2) USAGE.push({ day: `2026-11-0${d}`, key_id: 'xkey_2', model: 'qwen/qwen3-32b', status: 'settled', requests: 12 * d, tokens_in: 3000 * d, tokens_out: 1500 * d, cost_usd: 0.002 * d });
}

(async () => {
    const ai = { ...createFakeAi(), meRequest: async (_token, p) => (p.endsWith('key-usage') ? { rows: USAGE } : { keys: KEYS }) };
    const t = await boot({ ai });
    const alice = t.network.addUser('alice');
    const cookie = t.signIn(alice);
    const url = new URL(t.base);
    const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });
    require('fs').mkdirSync(OUT, { recursive: true });
    try {
        for (const [width, scheme] of [[390, 'dark'], [390, 'light'], [1280, 'dark']]) {
            const ctx = await b.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, isMobile: width < 700, hasTouch: width < 700 });
            await ctx.addCookies([
                { name: 'exchange_at', value: cookie.split('=')[1], domain: url.hostname, path: '/' },
                { name: 'ov_token', value: cookie.split('=')[1], domain: url.hostname, path: '/' },
            ]);
            const pg = await ctx.newPage();
            const errors = []; pg.on('pageerror', (e) => errors.push(e.message));
            for (const p of PATHS) {
                const r = await pg.goto(t.base + p, { waitUntil: 'load' }).catch(() => null);
                await pg.waitForTimeout(400);
                const info = await pg.evaluate(() => {
                    const small = [...document.querySelectorAll('main a, main button, main input, main select, main summary')]
                        .filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.height < 44 && getComputedStyle(el).display !== 'inline'; })
                        .map((el) => `${el.tagName.toLowerCase()}:${(el.textContent || el.name || '').trim().slice(0, 18)}:${Math.round(el.getBoundingClientRect().height)}`);
                    return { over: document.documentElement.scrollWidth > innerWidth, small: small.slice(0, 6) };
                });
                const name = `${p === '/' ? 'home' : p.replace(/^\//, '').replace(/\//g, '-')}-${width}-${scheme}`;
                // The app's boot helper captures console output: the findings go to a file beside the shots.
                require('fs').appendFileSync(path.join(OUT, 'results.txt'), `${[name, r && r.status(), info.over ? 'OVERFLOW' : 'fits', width < 700 && info.small.length ? `small: ${info.small.join(' ')}` : ''].join(' ')}\n`);
                await pg.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
            }
            if (errors.length) require('fs').appendFileSync(path.join(OUT, 'results.txt'), `errors ${errors.slice(0, 3).join(' | ')}\n`);
            await ctx.close();
        }
    } finally {
        await b.close();
        await t.close();
    }
    console.log('shots in', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
