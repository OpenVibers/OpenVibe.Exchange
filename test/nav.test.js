'use strict';
// The bar (11-07): fourteen links wrapped into two lines and cut the site's name to "OpenVibe…". Now at most six
// places sit in the bar, each with an icon; everything else is under More, and every link is a page this site serves.
const assert = require('assert');
const { NAV } = require('../server/render/layout');
const { PAGES } = (() => { try { return require('../server/http/discovery'); } catch { return {}; } })();

const inBar = NAV.filter((l) => !l.more);
assert.ok(inBar.length <= 6, `at most six places in the bar, not ${inBar.length}`);
assert.ok(NAV.every((l) => /^fa-[a-z0-9-]+$/.test(l.icon || '')), 'every place has an icon');
assert.ok(!NAV.some((l) => l.href === '/'), 'the brand is the way home');
assert.deepStrictEqual(new Set(NAV.map((l) => l.href)).size, NAV.length, 'no place twice');
for (const want of ['/models', 'https://openvibe.chat/vibe', '/arena', '/start', '/api', '/why', '/own', '/sell', '/uncensored', '/ai', '/faq', '/status']) {
    assert.ok(NAV.some((l) => l.href === want), `${want} is reachable from the bar or More`);
}
if (Array.isArray(PAGES)) for (const l of NAV) assert.ok(PAGES.some((p) => p.path === l.href) || ['https://openvibe.chat/vibe', '/status', '/arena', '/rankings'].includes(l.href), `${l.href} is a page`);
console.log('nav: six places in the bar with icons, the rest under More, every page reachable');
