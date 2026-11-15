'use strict';
// The browser check of 11-15: (1) Exchange's pages scrolled 8 px sideways at 1280 px, because the sticky head's bleed
// is sized with 100vw, which counts the scrollbar; (2) the small tags on /compute (best, promo, plain) were under
// 4.5:1 in the light theme. Real Chrome with real scrollbars, the real exchange.css, platform.css and Shared's kit.css.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const h = require('openvibe-shared/browser-harness');
if (process.env.OV_SKIP_BROWSER === '1' || !h.findChrome()) { console.log('head-overflow-tags-chrome: skipped (no Chrome)'); process.exit(0); }

const css = {
    '/kit.css': fs.readFileSync(path.join(path.dirname(require.resolve('openvibe-shared/browser-harness')), 'kit.css'), 'utf8'),
    '/exchange.css': fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'exchange.css'), 'utf8'),
    '/platform.css': fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'platform.css'), 'utf8'),
};
const LIGHT = '--bg-primary:#ffffff;--bg-secondary:#f4f6fa;--text-primary:#0f172a;--text-secondary:#475569;--text-muted:#64748b;--accent:#2563eb';
const page = (theme) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title>
<link rel="stylesheet" href="/kit.css"><link rel="stylesheet" href="/exchange.css"><link rel="stylesheet" href="/platform.css">
<style>:root{${theme === 'light' ? LIGHT : ''}}body{background:var(--ovk-bg);color:var(--ovk-text)}</style></head>
<body class="ovk"><main class="ex-wrap"><div class="ex-page"><header class="ovk-head"><h1>API</h1></header>
<div class="xc-t"><span class="xc-tags"><span class="xc-tag">8 GB</span><span class="xc-tag is-best">Best price</span><span class="xc-tag is-promo">Promo</span></span></div>
<div style="height:3000px"></div></div></main></body></html>`;
const server = http.createServer((req, res) => {
    if (css[req.url]) { res.writeHead(200, { 'content-type': 'text/css' }); return res.end(css[req.url]); }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(page(req.url === '/light' ? 'light' : 'dark'));
});

// In the page: each tag's text against its own background laid over the page's, as rendered.
const measure = `(() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
  const rgba = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (top, under) => [0, 1, 2].map((i) => top[i] * top[3] + under[i] * (1 - top[3]));
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const page = rgba(getComputedStyle(document.body).backgroundColor);
  const x0 = window.scrollX; window.scrollTo(100000, window.scrollY); const scrollX = window.scrollX; window.scrollTo(x0, window.scrollY);
  const tags = [...document.querySelectorAll('.xc-tag')].map((t) => { const cs = getComputedStyle(t); const bg = over(rgba(cs.backgroundColor), page); return { tag: t.textContent, ratio: Math.round(ratio(over(rgba(cs.color), bg), bg) * 100) / 100 }; });
  return { scrollX, clientWidth: document.documentElement.clientWidth, tags, sticky: getComputedStyle(document.querySelector('.ovk-head')).position };
})()`;

(async () => {
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    const base = `http://127.0.0.1:${server.address().port}`;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exchange-head-'));
    const browser = await h.launch({ tmpDir });
    try {
        for (const theme of ['dark', 'light']) {
            const p = await h.openPage(browser, await browser.newContext(), { width: 1280, height: 800 });
            await p.goto(`${base}/${theme}`, { maxMs: 8000 });
            const r = await p.evaluate(measure);
            assert.strictEqual(r.scrollX, 0, `${theme}: the page does not scroll sideways (client width ${r.clientWidth})`);
            assert.strictEqual(r.sticky, 'sticky', 'the head is still sticky');
            for (const t of r.tags) assert.ok(t.ratio >= 4.5, `${theme}: the "${t.tag}" tag reads at ${t.ratio}:1, under 4.5:1`);
            console.log(`head-overflow-tags-chrome: ${theme}: no sideways scroll; tags ${r.tags.map((t) => `${t.tag} ${t.ratio}:1`).join(', ')}`);
        }
    } finally { await browser.close(); server.close(); fs.rmSync(tmpDir, { recursive: true, force: true }); }
})().catch((e) => { console.error(e); process.exit(1); });
