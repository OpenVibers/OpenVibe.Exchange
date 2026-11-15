'use strict';
// A running deep dive's page follows the run (11-15, the owner: "It's specifically the search and deep dive which
// lags / freezes"): the time it has been running ticks every second, a new step redraws the page with that step's
// list and note, and a slow state read never stacks requests (one at a time, each given up after 8 s). Real Chrome at
// 390 px against the real runPage view and a state endpoint the test controls. Skipped without Chrome.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const h = require('openvibe-shared/browser-harness');
const views = require('../server/views/deep-dive');
if (process.env.OV_SKIP_BROWSER === '1' || !h.findChrome()) { console.log('deep-dive-live-chrome: skipped (no Chrome; set CHROME_BIN)'); process.exit(0); }

const ID = 'run_01TESTDEEPDIVE000000000000';
const row = { id: ID, question: 'a pricing page', depth: 'quick', status: 'running', step: 'plan', progress: 0.05, price_usd: 0.2, created_at: new Date(Date.now() - 75000).toISOString(), steps: [{ key: 'plan', status: 'running', detail: 'Writing the questions' }] };
let stateReads = 0, inFlight = 0, maxInFlight = 0, slow = false;
const server = http.createServer((req, res) => {
    if (req.url === `/deep-dive/${ID}/state`) {
        // In flight until the browser has the answer or has given up on it (an aborted read closes its connection).
        stateReads++; inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        let open = true;
        res.on('close', () => { if (open) { open = false; inFlight--; } });
        const answer = () => { if (!open) return; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ deep_dive: { id: ID, status: row.status, step: row.step, progress: row.progress } })); };
        return slow ? setTimeout(answer, 12000) : answer();
    }
    if (req.url === `/deep-dive/${ID}`) {
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
    try {
        const p = await h.openPage(browser, await browser.newContext(), { width: 390, height: 844 });
        await p.goto(`${base}/deep-dive/${ID}`, { maxMs: 6000 });
        const first = await p.evaluate("document.querySelector('[data-dd-elapsed]').textContent");
        assert.match(first, /^[12]:[0-5]\d so far$/, `the time running, at once (${first})`);   // 75 s ago, plus however long the page took
        await wait(1300);
        assert.notStrictEqual(await p.evaluate("document.querySelector('[data-dd-elapsed]').textContent"), first, 'and it ticks');

        // The progress moves without a reload; a new step redraws the page with that step.
        await p.evaluate('window.__same = 1');
        row.progress = 0.12;
        await wait(3000);
        assert.strictEqual(await p.evaluate('window.__same'), 1, 'progress alone does not reload');
        assert.strictEqual(await p.evaluate("document.querySelector('[data-progress-text]').textContent"), '12%');
        row.step = 'search'; row.progress = 0.2; row.steps = [{ key: 'plan', status: 'done' }, { key: 'search', status: 'running', detail: '4 searches out' }];
        for (let i = 0; i < 60 && (await p.evaluate('window.__same').catch(() => 1)) === 1; i++) await wait(100);
        await wait(400);
        assert.strictEqual(await p.evaluate('window.__same'), undefined, 'a new step redraws the page');
        assert.match(await p.evaluate('document.body.textContent'), /4 searches out/, 'with the step\'s own note');

        // A slow state read: one at a time, given up after 8 s.
        slow = true; const before = stateReads; maxInFlight = inFlight;
        await wait(10500);
        assert.ok(maxInFlight <= 1, `one read at a time (${maxInFlight})`);
        assert.ok(stateReads - before <= 2, `no reads stacked behind a slow one (${stateReads - before})`);
        console.log('deep-dive-live-chrome: the time ticks, progress moves in place, a new step redraws, and a slow read never stacks');
    } finally {
        await browser.close();
        server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
})().catch((e) => { console.error(e); process.exit(1); });
