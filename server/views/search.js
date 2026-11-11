'use strict';
/**
 * /search (Opus, 11-09): the engines AI has, grouped by what they find (web, pictures, icons), each with what it is,
 * its price per 1,000 searches and whether it works now; then "Try two engines" side by side. The engine list is
 * AI's own (GET /api/v1/exchange/search/engines), so a new engine shows here the day AI adds it.
 */
const kit = require('openvibe-shared/kit');
const { esc } = require('../render/html');

// What each engine is, in a line; an engine AI adds before this list knows it shows its id and no line.
const ENGINES = {
    openvibe: ['OpenVibe Search', "OpenVibe's own index of the network's pages."],
    searxng: ['SearXNG', 'Many search engines at once, through our own instance.'],
    openverse: ['Openverse', 'Openly licensed pictures, with their licence and author.'],
    commons: ['Wikimedia Commons', "Wikipedia's free media, with the attribution line."],
    iconify: ['Iconify', 'Open icon sets, as SVG with their licence.'],
    deepseek: ['DeepSeek Search', 'Web search with fetched page text.'],
    brave: ['Brave Search', 'An independent web index.'],
    exa: ['Exa', 'Search by meaning, built for agents.'],
    tavily: ['Tavily', 'Web search shaped for AI answers.'],
    serper: ['Serper', "Google's results, fast."],
    serpapi: ['SerpAPI', "Google's results with every feature."],
    jina: ['Jina', 'Search and a reader that cleans pages.'],
    perplexity: ['Perplexity Sonar', 'An answer with its sources.'],
    kagi: ['Kagi', 'A paid index without ads.'],
    google: ['Google Programmable Search', 'Google, in a site-scoped engine.'],
    unsplash: ['Unsplash', 'Free photographs.'],
    pexels: ['Pexels', 'Free photographs and videos.'],
    pixabay: ['Pixabay', 'Free pictures and illustrations.'],
};
const KINDS = [['web', 'Web'], ['images', 'Pictures'], ['icons', 'Icons']];
const nameOf = (e) => (ENGINES[e.id] || [e.id])[0];
const price = (e) => (!Number(e.price_per_1000) ? 'Free' : `$${Number(e.price_per_1000).toLocaleString('en-US', { maximumFractionDigits: 3 })} per 1,000`);
const state = (e) => (e.available === false ? kit.badge(e.byok ? 'Your key' : 'Not set up yet') : e.healthy === false ? kit.badge('Resting', 'warn') : kit.badge('Ready', 'ok'));

function engineRow(e) {
    const line = (ENGINES[e.id] || [])[1];
    return `<li class="xs-engine${e.available === false ? ' is-off' : ''}"><div class="xs-engine-main"><strong>${esc(nameOf(e))}</strong>${line ? `<span>${esc(line)}</span>` : ''}</div>`
        + `<span class="xs-engine-price">${esc(price(e))}</span>${state(e)}</li>`;
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
        return rows.length ? `<section class="xs-group"><h2>${esc(label)}<span class="ovk-count">${rows.length}</span></h2><ul class="xs-engines">${rows.map(engineRow).join('')}</ul></section>` : '';
    }).join('');
    const options = engines.map((e) => `<option value="${esc(e.id)}">${esc(nameOf(e))}</option>`).join('');
    const pick = (field, label, i) => `<label class="xs-field"><span>${label}</span><select name="${field}">${engines.map((e, j) => `<option value="${esc(e.id)}"${j === i ? ' selected' : ''}>${esc(nameOf(e))}</option>`).join('') || options}</select></label>`;
    return `<div class="ex-wrap xs">${kit.head({ title: 'Search', sub: 'Web, pictures and icons from many engines, with the same key as your models.' })}`
        + (groups || '<p class="xs-note">The engine list is not reachable right now.</p>')
        + `<section class="xs-try"><h2>Try two engines</h2><form method="post" action="/search" class="xs-form">`
        + `<label class="xs-field xs-field--wide"><span>Search for</span><input name="q" required maxlength="500" placeholder="open source live streaming" value="${esc(query.q || '')}"></label>`
        + `<label class="xs-field"><span>Kind</span><select name="kind">${KINDS.map(([k, l]) => `<option value="${k}"${query.kind === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>`
        + `<label class="xs-field"><span>Size</span><select name="size"><option value="">Any</option>${['small', 'medium', 'large'].map((v) => `<option value="${v}"${query.size === v ? ' selected' : ''}>${v}</option>`).join('')}</select></label>`
        + `<label class="xs-field"><span>Color</span><select name="color"><option value="">Any</option>${['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'black_and_white'].map((v) => `<option value="${v}"${query.color === v ? ' selected' : ''}>${v.replace('_', ' ')}</option>`).join('')}</select></label>`
        + `<label class="xs-field"><span>Type</span><select name="type"><option value="">Any</option>${['photo', 'illustration', 'vector'].map((v) => `<option value="${v}"${query.type === v ? ' selected' : ''}>${v}</option>`).join('')}</select></label>`
        + `<label class="xs-field"><span>License</span><input name="license" value="${esc(query.license || '')}" placeholder="cc0"></label>`
        + `<label class="xs-field"><span>After</span><input name="after" type="date" value="${esc(query.after || '')}"></label>`
        + `${pick('first', 'First engine', 0)}${pick('second', 'Second engine', 1)}`
        + `<p class="xs-go">${kit.button({ label: 'Compare', type: 'submit' })}</p></form>${results(found)}</section>`
        + `<p class="xs-note">Pictures come with their licence and author: keep the attribution line with each one. With your own engine key a search costs the engine's price and nothing more.</p></div>`;
}

module.exports = { searchPage, ENGINES };
