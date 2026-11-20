'use strict';
// The API page documents search (plan AD.34; the owner sent Linkup's "3 lines of code" ad, 11-20): the call in three
// lines, the four depths with what their recent searches really cost and took (or a dash before they were measured),
// the outputs, the filters, streaming and the SDK and MCP ways in, near the top of the page.
const assert = require('assert');
const views = require('../server/views/exchange');

const measured = [{ depth: 'fast', measured: { results: { n: 9, cost_usd: { p50: 0.00075, p90: 0.001 }, time_ms: { p50: 1200, p90: 2000 } }, answer: null } }];
const html = views.apiPage({ catalog: { models: [] }, usage: {}, depths: measured });

const at = html.indexOf('Search the web');
assert.ok(at > 0, 'a search section');
assert.ok(at < html.indexOf('Batches, at half price'), 'near the top of the page');
assert.match(html, /curl https:\/\/api\.openvibe\.exchange\/v1\/search/);
assert.match(html, /&quot;depth&quot;:&quot;standard&quot;,&quot;output&quot;:&quot;answer&quot;|"depth":"standard","output":"answer"/, 'the call asks for a depth and an answer');
for (const d of ['instant', 'fast', 'standard', 'deep']) assert.match(html, new RegExp(`<code>${d}</code>`), `${d} is listed`);
assert.match(html, /<td data-label="Lately, a list">~1\.2 s · \$0\.0008<\/td>/, "fast's measured time and cost");
assert.match(html, /<code>deep<\/code><\/th><td[^>]*>[^<]*<\/td><td data-label="Lately, a list">–<\/td>/, 'nothing measured yet is a dash, not a guess');
for (const word of ['"stream": true', 'output', 'include_domains', 'max_cost_usd', 'exchange_search', "require('openvibe-sdk/exchange')"]) {
    assert.ok(html.includes(word) || html.includes(word.replace(/"/g, '&quot;').replace(/'/g, '&#39;')), `it names ${word}`);
}
assert.ok(views.apiPage({ catalog: { models: [] }, usage: {} }).includes('Search the web'), 'without measurements the section still shows');
console.log('api-page-search: 1 check passed');
