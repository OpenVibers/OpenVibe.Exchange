'use strict';
/**
 * The home after the owner's phone review (11-16, /ov-gui-polish): the counts are the real ones (ready to call, tracked,
 * from how many providers), a model row shows only what was measured (no "–"), nothing is said twice (the 0% key is
 * Pricing's first row, not also a reason card), sections are headings with a "more" link instead of cards around
 * cards, the call has its own bar, and the rows are not capped at the shared reading measure.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const platform = require('../server/views/platform');

const offer = (o = {}) => ({ provider_name: 'P', price: { in: 0.2, out: 0.3 }, ...o });
const catalog = {
    models: [
        { slug: 'a/one', name: 'One', family: 'A', offers: [offer({ uptime: 0.97, speed: { p50_ms: 500 } })], requests_7d: 9, chat: true },
        { slug: 'b/two', name: 'Two', family: 'B', offers: [offer()], requests_7d: 3, chat: true },
    ],
    median_reply_ms: 1840,
};
const directory = { models: [{ provider: 'openai' }, { provider: 'google' }, { provider: 'openai' }, { provider: 'xai' }] };
const html = platform.home({ catalog, usage: { totals: { tokens_in: 15000000, tokens_out: 569721 } }, viewer: { kind: 'anonymous' }, directory });

assert.ok(/tracked · 3 providers/.test(html) && /<b data-ov-ticker="4">4<\/b>/.test(html), 'the tracked count and its providers, counting up when seen');
assert.ok((html.match(/class="xh-st-ic"/g) || []).length === 4, 'each count has its mark (the owner: "compact … add icons")');
assert.ok(/data-ovk-copy="#platform-curl"/.test(html) && /class="xh-copy"/.test(html), "the call's copy button sits in its bar");
assert.ok(!html.includes('openvibe.compare/things/') && html.includes('https://openvibe.compare/ai/models/a%2Fone'), 'How it ranks opens Compare\'s model page (/things/<id> was a 404: "broke")');
assert.ok(/data-ov-trending-items="\[&quot;One&quot;,&quot;Two&quot;/.test(html), "the search rotates this page's own models (openvibe-shared ov-trending)");
assert.ok((html.match(/data-ov-reveal/g) || []).length >= 6, 'sections and cards rise in as they are seen (motion.js)');
assert.ok(/15\.6M/.test(html) && /tokens this week/.test(html), "the week's tokens, short");
assert.ok(/1,840 ms/.test(html) && /median reply/.test(html), 'a measured median reply');
assert.ok(/Uncensored &amp; abliterated, 18\+|Uncensored & abliterated, 18\+/.test(html), 'the 18+ card uses the words people search');
{
    const ex = require('../server/views/exchange');
    const un = ex.uncensoredPage({ catalog: { models: [] }, adult: false, signedIn: false });
    assert.ok(/abliterated/i.test(un) && /obliterated/.test(un) && /over-refuse/.test(un) && /OpenAI-compatible/.test(un), 'the uncensored page answers the words people search');
    const ld = ex.uncensoredFaqLd();
    assert.ok(ld['@type'] === 'FAQPage' && ld.mainEntity.length === ex.UNCENSORED_TERMS.length, 'and marks them up as an FAQ');
    const fresh = platform.home({ catalog, usage: {}, viewer: { kind: 'anonymous' }, fresh: [{ id: 'qwen/qwen4-max', name: 'qwen/qwen4-max', provider: 'openrouter', status: 'spotted', first_seen_at: '2026-11-14T00:00:00Z' }] });
    assert.ok(fresh.includes('Qwen4 Max') && fresh.includes('Spotted') && fresh.includes('xh-new-ic is-spotted'), 'a new model reads as a name, with Spotted as a badge and a mark');
}
assert.ok(!/<dd>–/.test(html) && !/– \/ –/.test(html), 'no dashes for what nobody measured');
assert.ok(!html.includes('0% fee on your own key'), 'the 0% key is said once, in Pricing');
assert.ok(html.includes('Your own provider key') && html.includes('Measured, not guessed'), 'Pricing keeps it; a reason of its own takes the card');
assert.ok(!html.includes('Compute prices</a></p>') && !/kind: 'quiet' }\)} \$\{kit\.button\(\{ href: '\/compute'/.test(html), 'the hero has two actions');
assert.ok(/class="xh-code-h"/.test(html) && html.includes('api.openvibe.exchange/v1/chat/completions'), 'the call has its own bar');
assert.ok(/<section class="xh-sec" aria-labelledby="xh-popular-models" data-ov-reveal>/.test(html) && !/<section class="ovk-section"><h2>Popular models/.test(html), 'a heading, not a card around cards');
assert.strictEqual((html.match(/<h1[\s>]/g) || []).length, 1, 'one h1');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'platform.css'), 'utf8');
assert.ok(/\.xm-row, \.xm-facts dd \{ max-width: none; \}/.test(css), 'model rows are not capped at the reading measure');
assert.ok(/#home-model-search \{ display: grid; grid-template-columns: minmax\(0, 1fr\) auto;/.test(css), 'the search is one line');
console.log('home-polish-1116: real counts, no dashes, said once, sections as headings, the call in its own bar, rows full width');
