'use strict';
/**
 * The 11-12 design pass and fixes (the owner, phone screenshots of openvibe.exchange: search "broken", the compute list
 * a raw table off the screen, the home's reasons "bad layout … add icons … improve", the deep dive's boxes unstyled, a
 * broken icon in the menu).
 *   node test/exchange-polish-1112.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const glyphs = require('openvibe-shared/glyphs');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// The service token asks only for what Network grants Exchange (ai.run.read made Network refuse the whole token).
const config = require('../server/config').load({});
assert.strictEqual(config.ai.scope, 'ai.run.create');

// Every menu icon is a glyph that exists (fa-binoculars drew nothing for Deep dive).
const { NAV } = require('../server/render/layout');
for (const item of NAV) if (item.icon) assert.ok(glyphs.fromFa(item.icon), `${item.label}: ${item.icon} has a glyph`);
// Plain elements get the themed base.
const layout = read('server/render/layout.js');
assert.ok(/class="ex ov-room ov-base /.test(layout) && /kit-layout\.css/.test(layout), 'main carries .ov-base and its stylesheet');

// Search says why an engine did not answer.
const search = read('server/http/search.js');
assert.ok(!/This engine is unavailable or does not support this search kind/.test(search), 'no catch-all message');
assert.ok(/status === 401 \|\| status === 403/.test(search) && /status === 429/.test(search), 'a reason by status');

// /compute: cards by kind, cheapest first and marked, the provider's page linked, no table; the JSON stays.
const platform = require('../server/views/platform');
const { prices, checked_at } = require('../server/compute-prices');
const html = platform.computePage({ prices, checked_at, now: Date.parse(checked_at) + 86400000 });
assert.ok(!/<table/.test(html), 'no table');
assert.match(html, /checked yesterday/);
const gpu = html.slice(html.indexOf('id="gpu"'), html.indexOf('id="cpu"'));
const hourly = [...gpu.matchAll(/\$([0-9.]+)<small>\/hour/g)].map((m) => Number(m[1]));
assert.deepStrictEqual(hourly, [...hourly].sort((a, b) => a - b), 'cheapest first');
assert.ok(gpu.indexOf('is-best') > 0 && gpu.indexOf('is-best') < gpu.indexOf('xc-row', gpu.indexOf('xc-row') + 1), 'the first is marked Cheapest');
assert.match(gpu, /Preemptible/, 'the cheapest RTX 4090 says it is preemptible, in the provider\'s word');
assert.match(html, /openvibe\.compare\/compute/, 'linked to OpenVibe.Compare');
assert.match(html, /\/api\/compute\/prices/, 'the same list as JSON');
assert.match(read('server/app.js'), /app\.get\('\/api\/compute\/prices'/);
const stale = platform.computePage({ prices, checked_at, now: Date.parse('2027-01-01') });
assert.match(stale, /past their review date/, 'old prices say so');

// The home: three reason cards with marks and links, pricing lines with marks, questions as an accordion.
const home = read('server/views/platform.js');
assert.ok(/class="xp-features"/.test(home) && /xp-feature-ic/.test(home) && /class="xp-faq"/.test(home) && /xpr-ic/.test(home));

// The deep dive's note sits under its button.
assert.match(read('server/views/deep-dive.js'), /<p class="dd-go-note">/);
assert.match(read('public/css/exchange.css'), /label\.dd-depth input \{ appearance: none;/, 'the dot is drawn');
console.log('exchange-polish-1112: scope, menu glyphs, the base, search reasons, /compute cards, the home, the deep dive');
