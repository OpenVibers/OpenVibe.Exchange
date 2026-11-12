'use strict';
// Every page of openvibe.exchange gives the shared navbar the site's own page list (the owner, 2026-11-12): Rankings
// was the one row pointing at another site (Report); Exchange has had its own /rankings page all along.
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');
const { NAV } = require('../server/render/layout');

function initLinks(html) {
    const at = html.indexOf('OpenVibeNavbar.init');
    if (at < 0) return null;
    const start = html.indexOf('links', at);
    const open = html.indexOf('[', start);
    let depth = 0, q = null, esc = false;
    for (let i = open; i < html.length; i += 1) {
        const c = html[i];
        if (q) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === q) q = null; continue; }
        if (c === '"' || c === "'") { q = c; continue; }
        if (c === '[') depth += 1; else if (c === ']') { depth -= 1; if (!depth) return JSON.parse(html.slice(open, i + 1)); }
    }
    return null;
}

(async () => {
    const t = await boot({ ai: createFakeAi() });
    try {
        const own = NAV.map(({ label, href }) => ({ label, href }));
        await check('every page sends Exchange\'s own list, and every row is on this host', async () => {
            for (const path of ['/', '/terms', '/privacy', '/dmca', ...NAV.map((l) => l.href)]) {
                const r = await t.get(path);
                assert.ok([200, 301, 302].includes(r.status), `${path} answered ${r.status}`);
                if (r.status !== 200) continue;
                const links = (initLinks(r.text) || []).map(({ label, href }) => ({ label, href }));
                assert.deepStrictEqual(links, own, `${path} sends Exchange's list`);
            }
        });
        await check('every row is a route of this server', async () => {
            for (const { href } of NAV) {
                const r = await t.get(href);
                assert.notStrictEqual(r.status, 404, `${href} is a route`);
                assert.ok(r.status < 500, `${href} does not fail (${r.status})`);
            }
        });
        await check('Rankings is this site\'s page, not a link to another site', async () => {
            const rankings = NAV.find((l) => l.label === 'Rankings');
            assert.strictEqual(rankings.href, '/rankings');
        });
    } finally { await t.close(); }
    done();
})().catch((e) => { console.error(e); process.exit(1); });
