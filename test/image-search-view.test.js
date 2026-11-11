'use strict';
const assert = require('node:assert/strict');
const { searchPage } = require('../server/views/search');

const html = searchPage({ query: { kind: 'images', color: 'blue', size: 'large' }, found: [{ engine: 'openverse', receipt: { cost_usd: 0, time_ms: 12 }, results: [{
    title: 'Blue mountain', url: 'https://example.org/image.jpg', thumbnail: 'https://example.org/thumb.jpg', source_page: 'https://example.org/page',
    license: 'cc-by', license_url: 'https://example.org/license', author: 'Alice', width: 2400, height: 1600, published: '2026-10-01',
}] }] });
assert.ok(html.includes('Source and usage'));
assert.ok(html.includes('Reuse rights unknown') === false);
assert.ok(html.includes('2400 × 1600 px'));
assert.ok(html.includes('name="color"') && html.includes('name="after"'));
// The default engines follow the kind: Web picks the first two working web engines even when picture engines come first.
const E = (id, kinds, available = true) => ({ id, kinds, available, price_per_1000: 0 });
const web = searchPage({ engines: [E('searxng', ['web'], false), E('openverse', ['images']), E('commons', ['images']), E('openvibe', ['web']), E('deepseek', ['web'])] });
assert.match(web, /name="first">[\s\S]*?value="openvibe" selected/);
assert.match(web, /name="second">[\s\S]*?value="deepseek" selected/);
process.stdout.write('image search view passed\n');
