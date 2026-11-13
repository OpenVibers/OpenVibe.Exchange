'use strict';
const assert = require('node:assert/strict');
const { searchPage } = require('../server/views/search');

const E = (id, kinds, extra = {}) => ({
    id, kinds, available: true, price_per_1000: 0, byok: false, healthy: true,
    filters: { license: 'local', color: 'unsupported' }, upstreams: [], ...extra,
});
const engines = [
    E('openverse', ['images'], { filters: { license: 'native', color: 'unsupported' } }),
    E('unsplash', ['images'], { byok: true, filters: { license: 'local', color: 'native', safe_search: 'native' } }),
    E('pexels', ['images'], { byok: true, onboarding: 'paused', available: false }),
    E('serpapi-images', ['images'], { byok: true, price_per_1000: 25, included_allowance: '250 searches a month', upstreams: ['google'], filters: { license: 'unsupported', color: 'unsupported' } }),
    E('tineye', ['reverse_image'], { byok: true, price_per_1000: 40, filters: {} }),
    E('searxng', ['web'], { available: true }),
    E('openvibe', ['web']),
];

const result = searchPage({
    engines,
    query: { kind: 'images', color: 'blue', size: 'large', first: 'openverse', max_cost_usd: '0.05' },
    found: [{ engine: 'openverse', receipt: { cost_usd: 0, time_ms: 12 }, results: [{
        title: 'Blue mountain', url: 'https://example.org/image.jpg', thumbnail: 'https://example.org/thumb.jpg',
        source_page: 'https://example.org/page', license: 'cc-by', license_url: 'https://example.org/license',
        author: 'Alice', width: 2400, height: 1600, rank: 1, upstream_rank: 2, upstream: 'openverse',
    }] }],
});
assert.ok(result.includes('Source, rights and rank'));
assert.ok(result.includes('2400 × 1600 px'));
assert.ok(result.includes('name="color"') && result.includes('name="after"'));
assert.ok(result.includes('name="max_cost_usd"'));
assert.ok(result.includes('Our order #1') && result.includes("Provider's rank #2"));
assert.ok(result.includes('No provider fee') && !result.includes('>Free<'));
assert.match(result, /name="mode" value="single" checked/);
assert.match(result, /name="engine">[\s\S]*?value="openverse" selected/);
const defaulted = searchPage({ engines, query: { kind: 'images' } });
assert.match(defaulted, /name="engine">[\s\S]*?value="auto" selected/);
assert.ok(result.includes('Compare 2 or 3 engines'));
assert.ok(result.includes('One combined cap') === false, 'single mode has one cap, not a combined one');
assert.ok(result.includes('Licence: Provider') && result.includes('Colour: Not supported'));
assert.ok(result.includes('Your key') && result.includes('Your instance') && result.includes('No provider fee'));
assert.ok(result.includes('Included allowance: 250 searches a month'));
assert.ok(result.includes('New keys paused'));
assert.ok(result.includes('Reverse image'));

const compare = searchPage({
    engines, query: { kind: 'images', mode: 'compare', first: 'openverse', second: 'unsplash', max_cost_usd: '0.02', spent: 0.01 },
});
assert.match(compare, /name="mode" value="compare" checked/);
assert.ok(compare.includes('One combined cap $0.02') && compare.includes('spent $0.01'));
assert.match(compare, /name="second">[\s\S]*?value="unsplash" selected/);

// The engine list never says a provider is free; only the words the brief allows.
assert.ok(!result.includes('Free'));
process.stdout.write('image search view passed\n');
