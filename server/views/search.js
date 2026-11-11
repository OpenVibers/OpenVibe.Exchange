'use strict';
/**
 * /search (Opus, 11-09; the tool first 11-11): "Compare two engines" at the top (what to search for, the kind as a
 * switch, the two engines side by side, the picture filters in one fold), the results under it, then the engines AI
 * has, grouped by what they find (web, pictures, icons), each with what it is, its price per 1,000 searches and whether
 * it works now. The engine list is AI's own (GET /api/v1/exchange/search/engines), so a new engine shows here the day
 * AI adds it, named from its id until this list knows it.
 */
const kit = require('openvibe-shared/kit');
const { esc } = require('../render/html');

// What each engine is, in a line.
const ENGINES = {
    openvibe: ['OpenVibe Search', "OpenVibe's own index of the network's pages."],
    searxng: ['SearXNG', 'Many search engines at once, through our own instance.'],
    openverse: ['Openverse', 'Openly licensed pictures, with their licence and author.'],
    commons: ['Wikimedia Commons', "Wikipedia's free media, with the attribution line."],
    iconify: ['Iconify', 'Open icon sets, as SVG with their licence.'],
    deepseek: ['DeepSeek Search', 'Web search with fetched page text.'],
    brave: ['Brave Search', 'An independent web index.'],
    'brave-images': ['Brave Images', "Pictures from Brave's independent index."],
    exa: ['Exa', 'Search by meaning, built for agents.'],
    tavily: ['Tavily', 'Web search shaped for AI answers.'],
    serper: ['Serper', "Google's results, fast."],
    'serper-images': ['Serper Images', 'Google Images results, fast.'],
    serpapi: ['SerpAPI', "Google's results with every feature."],
    jina: ['Jina', 'Search and a reader that cleans pages.'],
    perplexity: ['Perplexity Sonar', 'An answer with its sources.'],
    kagi: ['Kagi', 'A paid index without ads.'],
    google: ['Google Programmable Search', 'Google, in a site-scoped engine.'],
    meta: ['Meta AI search', 'A Muse Spark answer with the web pages it read.'],
    'openvibe-egress': ['OpenVibe Fetch', 'Reads one page you name, through OpenVibe.'],
    unsplash: ['Unsplash', 'Free photographs.'],
    pexels: ['Pexels', 'Free photographs and videos.'],
    pixabay: ['Pixabay', 'Free pictures and illustrations.'],
};
const KINDS = [['web', 'Web'], ['images', 'Pictures'], ['icons', 'Icons']];
const titled = (id) => String(id || '').split(/[-_]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const nameOf = (e) => (ENGINES[e.id] || [titled(e.id)])[0];
// A missing price is not free: an engine billed per token says so instead of claiming "Free".
const price = (e) => (e.price_per_1000 == null || !Number.isFinite(Number(e.price_per_1000)) ? 'Priced per call'
    : !Number(e.price_per_1000) ? 'Free' : `$${Number(e.price_per_1000).toLocaleString('en-US', { maximumFractionDigits: 3 })} per 1,000`);
const state = (e) => (e.available === false ? kit.badge(e.byok ? 'Your key' : 'Not set up yet') : e.healthy === false ? kit.badge('Resting', 'warn') : kit.badge('Ready', 'ok'));

function engineRow(e) {
    const line = (ENGINES[e.id] || [])[1];
    return `<li class="xs-engine${e.available === false ? ' is-off' : ''}"><div class="xs-engine-main"><strong>${esc(nameOf(e))}</strong>${line ? `<span>${esc(line)}</span>` : ''}</div>`
        + `<span class="xs-engine-price"${e.pricing_note ? ` title="${esc(e.pricing_note)}"` : ''}>${esc(price(e))}</span>${state(e)}</li>`;
}

function results(list) {
    if (!list.length) return '';
    return `<div class="xs-results">${list.map((x) => `<section class="xs-result"><h3>${esc(nameOf({ id: x.engine }))}</h3>${x.error
        ? `<p class="xs-note">${esc(x.error)}</p>`
        : `<p class="xs-receipt">${esc(Number(x.receipt.cost_usd) ? `$${Number(x.receipt.cost_usd)}` : 'Free')} · ${Number(x.receipt.time_ms)} ms</p><ol>${x.results.map((r) => `<li><a href="${esc(r.source_page || r.url)}" rel="noopener noreferrer">${esc(r.title)}</a>${r.snippet || r.attribution ? `<p>${esc(r.snippet || r.attribution)}</p>` : ''}${r.thumbnail ? `<img src="${esc(r.thumbnail)}" alt="" loading="lazy" width="160">` : ''}${r.source_page ? `<details><summary>Source and usage</summary><p><a href="${esc(r.source_page)}" rel="noopener noreferrer">Source page</a>${r.author ? ` · ${esc(r.author)}` : ''}${r.license ? ` · ${r.license_url ? `<a href="${esc(r.license_url)}" rel="noopener noreferrer">${esc(r.license)}</a>` : esc(r.license)}` : ' · Reuse rights unknown'}${r.width && r.height ? ` · ${Number(r.width)} × ${Number(r.height)} px` : ''}${r.published ? ` · ${esc(r.published)}` : ''}</p></details>` : ''}</li>`).join('') || '<li class="xs-note">Nothing found.</li>'}</ol>`}</section>`).join('')}</div>`;
}

function searchPage({ engines = [], found = [], query = {} } = {}) {
    const groups = KINDS.map(([kind, label]) => {
        const rows = engines.filter((e) => Array.isArray(e.kinds) && e.kinds.includes(kind));
        return rows.length ? `<section class="xs-group"><h3>${esc(label)}<span class="ovk-count">${rows.length}</span></h3><ul class="xs-engines">${rows.map(engineRow).join('')}</ul></section>` : '';
    }).join('');
    const kind = KINDS.some(([k]) => k === query.kind) ? query.kind : 'web';
    // The engines in each list grouped by what they find; the first two that work are picked unless the search named some.
    const ready = engines.filter((e) => e.available !== false);
    const defaults = [query.first || (ready[0] || engines[0] || {}).id, query.second || (ready[1] || engines[1] || {}).id];
    const pick = (field, label, chosen) => `<label class="xs-field"><span>${label}</span><select name="${field}">${KINDS.map(([k, l]) => {
        const rows = engines.filter((e) => (Array.isArray(e.kinds) ? e.kinds[0] === k : k === 'web'));
        return rows.length ? `<optgroup label="${esc(l)}">${rows.map((e) => `<option value="${esc(e.id)}"${e.id === chosen ? ' selected' : ''}>${esc(nameOf(e))}${e.available === false ? ' (needs a key)' : ''}</option>`).join('')}</optgroup>` : '';
    }).join('')}</select></label>`;
    const sel = (name, label, values) => `<label class="xs-field"><span>${label}</span><select name="${name}"><option value="">Any</option>${values.map((v) => `<option value="${v}"${query[name] === v ? ' selected' : ''}>${v.replace(/_/g, ' ')}</option>`).join('')}</select></label>`;
    const set = ['size', 'color', 'type', 'license', 'after'].filter((k) => query[k]).length;
    const filters = `<details class="xs-more"${set ? ' open' : ''}><summary>Picture filters${set ? `<span class="ovk-count">${set}</span>` : ''}<small>for Pictures</small></summary><div class="xs-more-body">`
        + sel('size', 'Size', ['small', 'medium', 'large'])
        + sel('color', 'Colour', ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'black_and_white'])
        + sel('type', 'Type', ['photo', 'illustration', 'vector'])
        + `<label class="xs-field"><span>Licence</span><input name="license" value="${esc(query.license || '')}" placeholder="cc0"></label>`
        + `<label class="xs-field"><span>After</span><input name="after" type="date" value="${esc(query.after || '')}"></label></div></details>`;
    const kinds = `<fieldset class="xs-kinds"><legend class="ex-sr">What to find</legend>${KINDS.map(([k, l]) => `<label><input type="radio" name="kind" value="${k}"${k === kind ? ' checked' : ''}><span>${l}</span></label>`).join('')}</fieldset>`;
    return `<div class="ex-wrap xs">${kit.head({ title: 'Search', sub: 'Web, pictures and icons from many engines, with the same key as your models.' })}`
        + `<section class="xs-try" aria-labelledby="xs-try-h"><h2 id="xs-try-h">Compare two engines</h2><form method="post" action="/search" class="xs-form">`
        + `<div class="xs-q"><input name="q" required maxlength="500" placeholder="What are you looking for?" value="${esc(query.q || '')}" aria-label="Search for">`
        + `${kit.button({ label: 'Compare', type: 'submit', icon: 'search' })}</div>`
        + `${kinds}<div class="xs-pair">${pick('first', 'First engine', defaults[0])}<span class="xs-vs" aria-hidden="true">vs</span>${pick('second', 'Second engine', defaults[1])}</div>`
        + `${filters}</form>${results(found)}</section>`
        + `<section class="xs-list" aria-labelledby="xs-list-h"><h2 id="xs-list-h">The engines<span class="ovk-count">${engines.length}</span></h2>`
        + (groups || '<p class="xs-note">The engine list is not reachable right now.</p>') + '</section>'
        + `<p class="xs-note">Pictures come with their licence and author: keep the attribution line with each one. With your own engine key a search costs the engine's price and nothing more.</p></div>`;
}

module.exports = { searchPage, ENGINES };
