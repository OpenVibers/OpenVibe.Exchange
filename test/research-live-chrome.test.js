'use strict';
// A running general deep dive's page follows the run in place (11-15; views/research.js runPage and
// public/js/research-run.js): every step has its own name; the time ticks; the plan's questions appear in the
// Planning fold; the pages chosen arrive under Choosing; each page under Reading says it is being read, then how many
// words (or why it could not be); under Taking notes, each page's summary and what kind of source it is land as they
// come; the numbers count (questions, sources, pages read); the running step is the open fold; nothing sticks out at
// 390 px; the end brings the server's page. Real Chrome against the real view and script, with a state endpoint the
// test controls. Skipped without Chrome.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const h = require('openvibe-shared/browser-harness');
const views = require('../server/views/research');
if (process.env.OV_SKIP_BROWSER === '1' || !h.findChrome()) { console.log('research-live-chrome: skipped (no Chrome; set CHROME_BIN)'); process.exit(0); }

const ID = 'run_01TESTRESEARCH0000000000000';
const row = {
    id: ID, kind: 'research', question: 'Are heat pumps worth it in a cold climate?', depth: 'quick', status: 'running', step: 'plan', progress: 0.05, price_usd: 0.1, site_limit: 8,
    created_at: new Date(Date.now() - 20000).toISOString(), steps: [{ key: 'plan', status: 'running', detail: 'writing the questions an expert would ask', started_at: new Date(Date.now() - 3000).toISOString() }],
    plan: null, candidates: [], reads: [], gaps: [], error: null,
};
const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === `/deep-dive/${ID}/state`) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ deep_dive: { id: ID, kind: 'research', status: row.status, step: row.step, progress: row.progress, steps: row.steps, plan: row.plan, candidates: row.candidates, reads: row.reads, gaps: row.gaps, error: row.error } }));
    }
    if (u.pathname.startsWith('/js/research-run')) {
        res.writeHead(200, { 'content-type': 'text/javascript' });
        return res.end(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'research-run.js')));
    }
    if (u.pathname === `/deep-dive/${ID}`) {
        res.writeHead(200, { 'content-type': 'text/html' });
        const body = row.status === 'succeeded' ? '<p id="the-answer">The answer page</p>' : views.runPage({ row, id: ID });
        return res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Deep dive</title><link rel="icon" href="data:,"><style>body{margin:0;font:16px/1.4 sans-serif}.ex-wrap{padding:0 16px}</style></head><body>${body}</body></html>`);
    }
    res.writeHead(404); res.end();
});

(async () => {
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    const base = `http://127.0.0.1:${server.address().port}`;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exchange-rslive-'));
    const browser = await h.launch({ tmpDir });
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const text = (sel) => `(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`;
    const now = () => new Date().toISOString();
    try {
        const p = await h.openPage(browser, await browser.newContext(), { width: 390, height: 844 });
        await p.goto(`${base}/deep-dive/${ID}`, { maxMs: 6000 });
        await wait(300);
        assert.deepStrictEqual(await p.evaluate("[...document.querySelectorAll('.ddl-name')].map((x) => x.textContent)"), ['Planning', 'Searching', 'Choosing pages', 'Reading', 'Taking notes', 'Writing the answer'], 'every step has its own name');
        assert.match(await p.evaluate(text('.ddl-time')), /^0:[1-5]\d so far$/, 'the time running');

        // The plan's questions arrive in its fold; the search's counts in the tiles.
        row.plan = { questions: [{ key: 'cold', question: 'How efficient are they in the cold?' }, { key: 'cost', question: 'What do they cost to run?' }], searches: [{ q: 'heat pump COP -20 C', kind: 'web' }] };
        row.steps = [{ key: 'plan', status: 'done', detail: '2 questions, 1 searches', started_at: now(), finished_at: now() }, { key: 'search', status: 'done', detail: '24 sources from 3 engines', started_at: now(), finished_at: now() }, { key: 'choose', status: 'running', detail: 'picking the pages worth reading', started_at: now() }];
        row.step = 'choose'; row.progress = 0.22;
        await wait(2600);
        assert.deepStrictEqual(await p.evaluate("[...document.querySelectorAll('.rs-live-qs li')].map((x) => x.textContent)"), ['How efficient are they in the cold?', 'What do they cost to run?'], 'the questions are in the plan\'s fold');
        assert.strictEqual(await p.evaluate("[...document.querySelectorAll('.ddl-v')].map((x) => x.textContent).slice(0, 2).join(',')"), '2,24', 'questions and sources counted');
        assert.strictEqual(await p.evaluate("document.querySelector('.ddl-step[data-key=\"choose\"] details').open"), true, 'the running step is the open fold');

        // Pages chosen, then read one by one (one cannot be).
        row.candidates = [
            { url: 'https://example.org/heat-pumps', title: 'Heat pumps explained', reason: 'the basics', source_id: 'src_1', chosen: true },
            { url: 'https://blocked.example/page', title: 'Blocked page', reason: 'a view on costs', source_id: 'src_2', chosen: true },
        ];
        row.steps = [...row.steps.slice(0, 2), { key: 'choose', status: 'done', detail: '2 pages', started_at: now(), finished_at: now() }, { key: 'read', status: 'running', detail: '1/2 pages', started_at: now() }];
        row.step = 'read'; row.progress = 0.4;
        row.reads = [{ id: 'read_1', source_id: 'src_1', url: 'https://example.org/heat-pumps', title: 'Heat pumps explained', status: 'read', words: 1840, findings: 0 }];
        await wait(2600);
        const readRows = await p.evaluate("[...document.querySelectorAll('.ddl-step[data-key=\"read\"] .ddl-site')].map((li) => [li.querySelector('.ddl-site-name').textContent, li.querySelector('.ddl-site-state').textContent])");
        assert.deepStrictEqual(readRows, [['Heat pumps explained', '1840 words'], ['Blocked page', 'Reading…']], 'each page as it is read');
        row.reads.push({ id: 'read_2', source_id: 'src_2', url: 'https://blocked.example/page', title: 'Blocked page', status: 'skipped', reason: 'robots.txt disallows this page', words: 0, findings: 0 });
        await wait(2400);
        assert.deepStrictEqual(await p.evaluate("(() => { const li = document.querySelectorAll('.ddl-step[data-key=\"read\"] .ddl-site')[1]; return [li.querySelector('.ddl-site-state').textContent, li.querySelector('.ddl-site-why').textContent, li.classList.contains('is-skip')]; })()"), ['Not read', 'robots.txt disallows this page', true], 'a page that cannot be read says why');

        // Notes land page by page.
        row.steps = [...row.steps.slice(0, 3), { key: 'read', status: 'done', detail: '1 pages read, 1 could not be', started_at: now(), finished_at: now() }, { key: 'analyse', status: 'running', detail: '1/1 pages', started_at: now() }];
        row.step = 'analyse'; row.progress = 0.7;
        row.reads[0] = { ...row.reads[0], summary: 'How a heat pump moves heat, and how well it does in the cold.', kind: 'reference', findings: 3 };
        await wait(2600);
        const notes = await p.evaluate("(() => { const li = document.querySelector('.ddl-step[data-key=\"analyse\"] .ddl-site'); return [li.querySelector('.ddl-site-why').textContent, li.querySelector('.ddl-cap').textContent, li.querySelector('.ddl-site-state').textContent, document.querySelectorAll('.ddl-step[data-key=\"analyse\"] .ddl-site').length]; })()");
        assert.deepStrictEqual(notes, ['How a heat pump moves heat, and how well it does in the cold.', 'Reference', '3 notes', 1], 'a page\'s notes and its kind; a page not read is not listed');
        assert.strictEqual(await p.evaluate(text('.ddl-tile:nth-child(3) .ddl-v')), '1', 'pages read counted');
        assert.strictEqual(await p.evaluate('document.documentElement.scrollWidth - innerWidth'), 0, 'nothing sticks out at 390 px');

        // The end brings the answer.
        row.status = 'succeeded';
        await wait(2600);
        assert.strictEqual(await p.evaluate("!!document.getElementById('the-answer')"), true, 'the end brings the server\'s page');
    } finally {
        await browser.close();
        server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    console.log('research-live-chrome: step names, the time, the questions, pages chosen and read (and why not), notes as they land, the counts, the open fold, 390 px, the end');
})().catch((err) => { console.error(err); process.exit(1); });
