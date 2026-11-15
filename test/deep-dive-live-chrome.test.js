'use strict';
// A running deep dive's page follows the run, in place (11-15, the owner: "It's specifically the search and deep dive
// which lags / freezes"; then "Broken and doesn't show enough info/metrics and breakdown drop-down … more animations
// and effects that make it feel alive"): the time ticks every second; the bar, the step list, each step's detail and
// the numbers move without a reload (the capture count used to stay at 0/6 until the next step); the running step is
// the open fold, with the sites chosen and each site's screenshots as they land; every step has its own name (the last
// two were both "Writing it up"); a slow state read never stacks (one at a time, each given up after 8 s); the end
// brings the server's page. Real Chrome at 390 px against the real runPage view and public/js/deep-dive.js, with a state
// endpoint the test controls. Skipped without Chrome.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const h = require('openvibe-shared/browser-harness');
const views = require('../server/views/deep-dive');
if (process.env.OV_SKIP_BROWSER === '1' || !h.findChrome()) { console.log('deep-dive-live-chrome: skipped (no Chrome; set CHROME_BIN)'); process.exit(0); }

const ID = 'run_01TESTDEEPDIVE000000000000';
const row = { id: ID, question: 'a pricing page', depth: 'quick', status: 'running', step: 'plan', progress: 0.05, price_usd: 0.2, site_limit: 2, created_at: new Date(Date.now() - 75000).toISOString(), steps: [{ key: 'plan', status: 'running', detail: 'Writing the questions', started_at: new Date(Date.now() - 70000).toISOString() }], candidates: [], captures: [] };
let stateReads = 0, inFlight = 0, maxInFlight = 0, slow = false;
const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === `/deep-dive/${ID}/state`) {
        // In flight until the browser has the answer or has given up on it (an aborted read closes its connection).
        stateReads++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        let open = true;
        res.on('close', () => { if (open) { open = false; inFlight--; } });
        const answer = () => { if (!open) return; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ deep_dive: { id: ID, status: row.status, step: row.step, progress: row.progress, steps: row.steps, candidates: row.candidates, captures: row.captures, gaps: [] } })); };
        return slow ? setTimeout(answer, 12000) : answer();
    }
    if (u.pathname.startsWith('/js/deep-dive')) {
        res.writeHead(200, { 'content-type': 'text/javascript' });
        return res.end(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'deep-dive.js')));
    }
    if (u.pathname === `/deep-dive/${ID}`) {
        res.writeHead(200, { 'content-type': 'text/html' });
        return res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Deep dive</title><link rel="icon" href="data:,"></head><body>${views.runPage({ viewer: null, row, id: ID })}</body></html>`);
    }
    res.writeHead(404); res.end();
});
(async () => {
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    const base = `http://127.0.0.1:${server.address().port}`;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exchange-ddlive-'));
    const browser = await h.launch({ tmpDir });
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const text = (sel) => `(document.querySelector(${JSON.stringify(sel)}) || {}).textContent || ''`;
    try {
        const p = await h.openPage(browser, await browser.newContext(), { width: 390, height: 844 });
        await p.goto(`${base}/deep-dive/${ID}`, { maxMs: 6000 });
        await wait(300);
        const first = await p.evaluate(text('.ddl-time'));
        assert.match(first, /^[12]:[0-5]\d so far$/, `the time running, at once (${first})`);   // 75 s ago, plus however long the page took
        await wait(1300);
        assert.notStrictEqual(await p.evaluate(text('.ddl-time')), first, 'and it ticks');
        const names = await p.evaluate("[...document.querySelectorAll('.ddl-name')].map((x) => x.textContent)");
        assert.deepStrictEqual(names, ['Planning', 'Searching', 'Choosing sites', 'Capturing', 'Analysing', 'Writing it up', 'The report'], 'every step has its own name');

        // Everything moves in place: the bar, the step, its detail, the numbers, the chosen sites, each site's shots.
        await p.evaluate('window.__same = 1');
        row.step = 'search'; row.progress = 0.2;
        row.steps = [{ key: 'plan', status: 'done', detail: '8 questions, 5 searches' }, { key: 'search', status: 'running', detail: '4 searches out' }];
        await wait(2600);
        assert.strictEqual(await p.evaluate('window.__same'), 1, 'a new step does not reload');
        assert.strictEqual(await p.evaluate(text('.ddl-pct')), '20%');
        assert.match(await p.evaluate(text('.ddl-now')), /Searching · 4 searches out/);
        assert.deepStrictEqual(await p.evaluate("[...document.querySelectorAll('.ddl-step details[open]')].map((d) => d.parentElement.dataset.key)"), ['search'], 'the running step is the open fold');
        row.step = 'capture'; row.progress = 0.5;
        row.steps = [{ key: 'plan', status: 'done' }, { key: 'search', status: 'done', detail: '37 sources from 6 engines' }, { key: 'choose', status: 'done', detail: '2 sites' }, { key: 'capture', status: 'running', detail: '1/2 sites' }];
        row.candidates = [{ url: 'https://linear.app', title: 'Linear', reason: 'Calm and dense', source_id: 's1', chosen: true }, { url: 'https://stripe.com', title: 'Stripe', reason: 'Clear tiers', source_id: 's2', chosen: true }];
        row.captures = [{ id: 'cap_1', source_id: 's1', url: 'https://linear.app', viewport: 390, theme: 'light' }, { id: 'cap_2', source_id: 's1', url: 'https://linear.app', viewport: 1280, theme: 'light' }];
        await wait(2600);
        const s = await p.evaluate(`({ same: window.__same, det: ${text('[data-key="capture"] .ddl-det')}, tiles: [...document.querySelectorAll('.ddl-v')].map((x) => x.textContent),
            shots: document.querySelectorAll('[data-key="capture"] .ddl-cap').length, now: ${text('.ddl-site.is-now .ddl-site-name')}, why: ${text('[data-key="choose"] .ddl-site-why')} })`);
        assert.deepStrictEqual([s.same, s.det, s.shots, s.now, s.why], [1, '1/2 sites', 2, 'Stripe', 'Calm and dense'], `the capture count moves and the sites show (${JSON.stringify(s)})`);
        assert.deepStrictEqual(s.tiles.slice(0, 3), ['37', '2', '2'], 'sources, sites and screenshots counted');
        assert.strictEqual(await p.evaluate('document.documentElement.scrollWidth - innerWidth'), 0, 'nothing sticks out at 390');

        // A slow state read: one at a time, given up after 8 s.
        slow = true; const before = stateReads; maxInFlight = inFlight;
        await wait(10500);
        assert.ok(maxInFlight <= 1, `one read at a time (${maxInFlight})`);
        assert.ok(stateReads - before <= 2, `no reads stacked behind a slow one (${stateReads - before})`);

        // The end brings the server's page.
        slow = false; row.status = 'failed'; row.error = { code: 'x', detail: 'it stopped' };
        // (a slow read may still be out for up to 8 s; the next one sees the end)
        for (let i = 0; i < 140 && (await p.evaluate('window.__same').catch(() => 1)) === 1; i++) await wait(100);
        assert.strictEqual(await p.evaluate('window.__same').catch(() => undefined), undefined, 'the end reloads the page');
        console.log('deep-dive-live-chrome: the time ticks; the bar, steps, details, numbers, sites and shots move in place; one read at a time; the end reloads');
    } finally {
        await browser.close();
        server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
})().catch((e) => { console.error(e); process.exit(1); });
