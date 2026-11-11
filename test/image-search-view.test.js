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
process.stdout.write('image search view passed\n');
