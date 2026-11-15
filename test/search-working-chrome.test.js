'use strict';
// A search or a deep dive says it is working the moment it is sent (11-15, the owner: "It's specifically the search and
// deep dive which lags / freezes"): public/js/exchange.js puts a line under the form, marks it busy, keeps a second
// press from sending it again, and after six seconds says why it is still going. Real Chrome at 390 px against a
// search that answers in 7.5 s; the page notes what it shows while it waits (the browser is busy with the post, so the
// test reads the notes once the answer is in). Skipped without Chrome.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const h = require('openvibe-shared/browser-harness');
if (process.env.OV_SKIP_BROWSER === '1' || !h.findChrome()) { console.log('search-working-chrome: skipped (no Chrome; set CHROME_BIN)'); process.exit(0); }

let posts = 0;
const page = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Search</title><link rel="icon" href="data:,"></head><body>${body}<script src="/js/exchange.js"></script></body></html>`;
// What the page shows while the search is out: at 0.1 s (and a second press then), and at 6.5 s.
const notes = `<script>document.addEventListener('submit', () => {
  const f = document.querySelector('.xs-form');
  setTimeout(() => { sessionStorage.setItem('at100', JSON.stringify({ busy: f.getAttribute('aria-busy'), line: (f.querySelector('.ex-working') || {}).textContent || null, role: f.querySelector('.ex-working') ? f.querySelector('.ex-working').getAttribute('role') : null })); f.querySelector('button').click(); }, 100);
  setTimeout(() => { sessionStorage.setItem('at6500', (f.querySelector('.ex-working') || {}).textContent || ''); }, 6500);
}, { once: true });</script>`;
const form = '<form method="post" action="/search" class="xs-form"><input name="q" value="synths"><button type="submit">Search</button></form>' + notes;
const server = http.createServer((req, res) => {
    if (req.url === '/js/exchange.js') { res.writeHead(200, { 'content-type': 'application/javascript' }); return res.end(fs.readFileSync(path.join(__dirname, '..', 'public/js/exchange.js'))); }
    if (req.method === 'POST' && req.url === '/search') { posts++; setTimeout(() => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page('<p id="done">results</p>')); }, 7500); return; }
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(page(form)); }
    res.writeHead(404); res.end();
});
(async () => {
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    const base = `http://127.0.0.1:${server.address().port}`;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exchange-working-'));
    const browser = await h.launch({ tmpDir });
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
        const p = await h.openPage(browser, await browser.newContext(), { width: 390, height: 844 });
        await p.goto(`${base}/`, { maxMs: 6000 });
        await p.evaluate("document.querySelector('.xs-form button').click(), true").catch(() => null);
        for (let i = 0; i < 150 && !(await p.evaluate("!!document.getElementById('done')").catch(() => false)); i++) await wait(100);
        const seen = await p.evaluate("({ at100: JSON.parse(sessionStorage.getItem('at100') || 'null'), at6500: sessionStorage.getItem('at6500') })");
        assert.deepStrictEqual(seen.at100, { busy: 'true', line: 'Searching…', role: 'status' }, 'working, at once');
        assert.match(String(seen.at6500), /^Still searching/, 'after six seconds, why it is still going');
        assert.strictEqual(posts, 1, 'a second press does not send it again');
        console.log('search-working-chrome: a search says it is working at once, is sent once, and says why it is still going');
    } finally {
        await browser.close();
        server.close();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
})().catch((e) => { console.error(e); process.exit(1); });
