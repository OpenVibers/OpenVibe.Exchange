'use strict';
/**
 * Local screenshots of the Memory and Lorebook panels (stages 3 and 4), for Opus's design review.
 *
 * The images go to a temp folder, never into the repository and never to a server:
 *   node scripts/shoot-memory-lorebooks.js [outDir]
 *
 * For each page it checks the width (scrollWidth === viewport), the console, and the tap targets at 390 px.
 * The M2 store is a stand-in here: the shots are of the pages, not of OpenVibe.AI.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const { boot } = require('../test/helpers/boot');
const { createFakeAi } = require('../test/helpers/ai');
const { chromium } = require('/home/workstation/openvibe/work/OpenVibe.Games/node_modules/playwright');

const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'exchange-memory-shots'));
const CHROME = '/usr/bin/google-chrome';

/** A tiny M2 store: the items the memory panel reads and writes. */
function fakeMemory() {
    const items = new Map();
    const view = (it) => ({ id: it.id, scope: it.scope, kind: it.kind, text: it.text, source: it.source, sources: [it.source], source_ref: it.source_ref || null, status: 'active', confidence: 1, seen_at: it.updated_at, created_at: it.created_at, updated_at: it.updated_at, merged_into: null, conflict_with: null });
    let n = 0;
    const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), json: async () => body });
    return {
        items,
        async fetchImpl(url, options = {}) {
            const u = new URL(String(url));
            const method = String(options.method || 'GET').toUpperCase();
            const body = options.body ? JSON.parse(String(options.body)) : null;
            if (u.pathname === '/api/v1/memory/items' && method === 'GET') {
                const scope = u.searchParams.get('scope');
                const list = [...items.values()].filter((it) => !scope || it.scope === scope).map(view);
                return reply(200, { items: list, count: list.length });
            }
            if (u.pathname === '/api/v1/memory/items:batch' && method === 'POST') {
                const out = [];
                for (const raw of body.items || []) {
                    const at = new Date().toISOString();
                    const item = { id: `mem_${String(++n).padStart(4, '0')}`, scope: raw.scope, kind: raw.kind, text: raw.text, source: raw.source, source_ref: raw.source_ref || null, created_at: at, updated_at: at };
                    items.set(item.id, item); out.push(view(item));
                }
                return reply(200, { items: out, count: out.length, created: out.length, deduped: 0 });
            }
            const one = /^\/api\/v1\/memory\/items\/([^/]+)$/.exec(u.pathname);
            if (one && method === 'PATCH') { const it = items.get(decodeURIComponent(one[1])); if (it && body.text != null) it.text = body.text; return reply(200, { item: view(it) }); }
            if (one && method === 'DELETE') { items.delete(decodeURIComponent(one[1])); return reply(200, { deleted: 1 }); }
            return reply(404, { detail: 'not found' });
        },
    };
}

const FORM = {
    name: 'Ada Lovelace', description: 'The first programmer. Writes algorithms as if they were music.',
    personality: 'precise, curious, warm', scenario: 'her study in London, 1843',
    first_message: 'Good evening. I have been thinking about the engine all day. What shall we compute?',
    tags: 'analytical, history',
};

(async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const memory = fakeMemory();
    const ai = createFakeAi({
        chat(args) {
            if (args.model === 'openvibe/economy') return { content: '[{"kind":"fact","text":"The person is called Ada and likes clocks."}]', model: 'openvibe/economy', cost_usd: 0.000001, tokens_in: 40, tokens_out: 18, latency_ms: 12 };
            return { content: 'The engine will sing, and we shall listen to it together.', model: args.model, provider: 'deepseek', run_id: 'run_SHOT', cost_usd: 0.00012, tokens_in: 10, tokens_out: 20, latency_ms: 420, why: ['cheapest healthy offer within your ceiling'] };
        },
    });
    const t = await boot({ ai, aiFetchImpl: memory.fetchImpl, env: { EXCHANGE_COMPANIONS_NOTES_EVERY_TURNS: '2' } });
    const alice = t.network.addUser('alice');
    const card = await t.ctx.characters.create({ owner: alice.subject, handle: 'alice', ...FORM });
    await t.ctx.notes.add(alice.subject, card.id, { kind: 'fact', text: 'The person keeps a notebook of clock designs.', pinned: true }, alice.subject);
    await t.ctx.notes.add(alice.subject, card.id, { kind: 'preference', text: 'Prefers short answers, and a question at the end.', pinned: false }, alice.subject);
    await t.ctx.notes.add(alice.subject, card.id, { kind: 'event', text: 'They met in her London study and talked about the analytical engine for an hour.', pinned: false }, alice.subject);

    const book = await t.ctx.lorebooks.create(alice.subject, { name: 'The clock world', scope: 'person' });
    await t.ctx.lorebooks.addEntry(alice.subject, book.id, { name: 'The engine', keys: 'engine, machine', content: 'The analytical engine computes numbers with punched cards. It has never been built.', priority: 8 });
    await t.ctx.lorebooks.addEntry(alice.subject, book.id, { name: 'The study', keys: 'study, London', content: 'Her study is warm, full of paper, and the window looks onto the street.', priority: 4 });
    await t.ctx.lorebooks.addEntry(alice.subject, book.id, { name: 'The rule of the house', content: 'Music is allowed at any hour.', constant: true, priority: 2 });

    const talk = await t.get('/c/alice/ada-lovelace/talk', { as: alice, method: 'POST' });
    const chatUrl = talk.headers.get('location');
    await t.get(chatUrl + '/send', { as: alice, method: 'POST', form: { text: 'Tell me about the engine in your study.' } });
    await t.get(chatUrl + '/send', { as: alice, method: 'POST', form: { text: 'Do you remember what I like?' } });

    const cookie = t.signIn(alice);
    const browser = await chromium.launch({ executablePath: CHROME });
    const problems = [];

    async function capture(shots) {
        for (const shot of shots) {
            for (const [w, scheme] of [[390, 'dark'], [390, 'light'], [1280, 'dark'], [1280, 'light']]) {
                const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme, deviceScaleFactor: 2, isMobile: w < 700, hasTouch: w < 700 });
                const url = new URL(t.base);
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
                await pg.goto(t.base + shot.path, { waitUntil: 'load' });
                await pg.waitForTimeout(500);
                if (shot.openPanel) {
                    await pg.evaluate(() => { const b = document.querySelector('[data-ovt-panel-open]'); if (b) b.click(); });
                    await pg.waitForTimeout(300);
                }
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
                            // A checkbox or a file picker is tapped through its label, which is the finger-sized target.
                            if (el.matches('input[type=checkbox], input[type=file], input[type=hidden]')) continue;
                            if (r.height < 44) out.push(el.tagName + ' [' + String(el.textContent || '').trim().slice(0, 18) + '] h=' + Math.round(r.height));
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
    }

    // The plain pages first: the notes as text, the lorebook with its entries, the saw panel.
    await capture([
        { name: 'memory', path: '/c/alice/ada-lovelace/memory' },
        { name: 'lorebook', path: '/c/alice/ada-lovelace/lorebook?chat=' + chatUrl.split('/').pop() },
        { name: 'chat-saw', path: chatUrl, openPanel: true },
    ]);

    // With the Locker on, the same pages carry the envelopes, and the chat asks for the unlock.
    await t.network.giveLocker(alice);
    const locked = await t.get('/c/alice/ada-lovelace/lock', { as: alice, method: 'POST', form: { on: '1' } });
    if (locked.status !== 200) throw new Error('the Locker did not turn on: ' + locked.status);
    await capture([
        { name: 'chat-locked', path: chatUrl },
        { name: 'memory-locked', path: '/c/alice/ada-lovelace/memory' },
    ]);
    await browser.close();
    await t.close();
    process.stdout.write('shots in ' + OUT + String.fromCharCode(10));
    process.stdout.write((problems.length ? 'PROBLEMS:' + String.fromCharCode(10) + problems.join(String.fromCharCode(10)) : 'clean: no overflow, no console errors, tap targets ok') + String.fromCharCode(10));
    process.exit(problems.length ? 1 : 0);
})().catch(async (err) => { process.stdout.write('FAILED: ' + (err.stack || err) + String.fromCharCode(10)); process.exit(1); });
