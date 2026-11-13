'use strict';
/**
 * /search (Opus, 11-09; one engine and honest words 11-13): one engine by default, the router's pick unless
 * the person names one. Comparing two or three engines is an explicit choice with ONE combined spending cap.
 * Prices are words, never "Free": no provider fee, your instance, included allowance or your key. The filters
 * say whether the chosen engine applies them, we filter locally, or they are not supported and therefore
 * refused rather than dropped. Results keep the provider's rank beside our order.
 */
const kit = require('openvibe-shared/kit');
const { esc } = require('../render/html');

const ENGINES = {
    openvibe: ['OpenVibe Search', "OpenVibe's own index of the network's pages."],
    searxng: ['SearXNG', 'Many search engines at once, through our own instance.'],
    openverse: ['Openverse', 'Openly licensed pictures, with their licence and author.'],
    commons: ['Wikimedia Commons', "Wikimedia's open media, with the attribution line."],
    iconify: ['Iconify', 'Open icon sets, as SVG with their licence.'],
    deepseek: ['DeepSeek Search', 'Web search with fetched page text.'],
    brave: ['Brave Search', 'An independent web index.'],
    'brave-images': ['Brave Images', "Pictures from Brave's independent index."],
    exa: ['Exa', 'Search by meaning, built for agents.'],
    tavily: ['Tavily', 'Web search shaped for AI answers.'],
    serper: ['Serper', "Google's results, fast."],
    'serper-images': ['Serper Images', 'Google Images results, fast.'],
    serpapi: ['SerpAPI', "Google's results with every feature."],
    'serpapi-images': ['SerpAPI Google Images', "Google Images through SerpAPI."],
    'serpapi-reverse': ['SerpAPI Reverse Image', 'Pages that carry a picture, through Google.'],
    'searchapi-images': ['SearchAPI Images', 'One supplier for Google, Bing and Yandex images.'],
    tineye: ['TinEye', 'Reverse image matching against its own index.'],
    jina: ['Jina', 'Search and a reader that cleans pages.'],
    perplexity: ['Perplexity Sonar', 'An answer with its sources.'],
    kagi: ['Kagi', 'A paid index without ads.'],
    google: ['Google Programmable Search', 'Google, in a site-scoped engine.'],
    meta: ['Meta AI search', 'A Muse Spark answer with the web pages it read.'],
    'openvibe-egress': ['OpenVibe Fetch', 'Reads one page you name, through OpenVibe.'],
    unsplash: ['Unsplash', 'Stock photographs.'],
    pexels: ['Pexels', 'Stock photographs and videos.'],
    pixabay: ['Pixabay', 'Stock pictures and illustrations.'],
};
const KINDS = [['web', 'Web'], ['images', 'Pictures'], ['icons', 'Icons']];
const GROUPS = [...KINDS, ['reverse_image', 'Reverse image']];
const FILTERS = {
    web: [['freshness', 'Freshness'], ['safe_search', 'Strict safe search']],
    images: [
        ['license', 'Licence'], ['commercial', 'Commercial use'], ['format', 'Format'],
        ['orientation', 'Orientation'], ['size', 'Size'], ['color', 'Colour'],
        ['after', 'After'], ['type', 'Type'], ['safe_search', 'Strict safe search'],
    ],
    icons: [['set', 'Icon set'], ['style', 'Style'], ['license', 'Licence'], ['format', 'Format']],
};
const OPEN_DATA = new Set(['openverse', 'commons', 'iconify', 'openvibe']);
const titled = (id) => String(id || '').split(/[-_]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const nameOf = (e) => (ENGINES[e.id] || [titled(e.id)])[0];
const lineOf = (e) => (ENGINES[e.id] || [])[1] || '';
const money = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 6 })}`;
const priceWords = (e) => {
    if (e.id === 'searxng') return 'Your instance';
    if (e.byok) return 'Your key';
    if (e.price_per_1000 == null) return 'Priced per call';
    if (OPEN_DATA.has(e.id) || Number(e.price_per_1000) === 0) return 'No provider fee';
    return `${money(e.price_per_1000)} per 1,000`;
};
const priceNote = (e) => {
    const bits = [];
    if (e.byok && Number(e.price_per_1000) > 0) bits.push(`The provider charges ${money(e.price_per_1000)} per 1,000`);
    if (e.included_allowance) bits.push(`Included allowance: ${e.included_allowance}`);
    if (e.onboarding === 'paused') bits.push('Not offered to new keys while issuance is paused');
    if (!bits.length) bits.push(priceWords(e) === 'No provider fee' ? 'Open data; no provider query fee' : '');
    return bits.filter(Boolean).join(' · ');
};
const state = (e) => {
    if (e.onboarding === 'paused' && e.available === false) return kit.badge('New keys paused', 'warn');
    if (e.available === false) return kit.badge(e.byok ? 'Add your key' : 'Not set up yet');
    if (e.healthy === false) return kit.badge('Resting', 'warn');
    return kit.badge('Ready', 'ok');
};
const supportWord = (v) => (v === 'native' ? 'Provider applies it' : v === 'local' ? 'We filter' : 'Not supported');
const supportShort = (v) => (v === 'native' ? 'Provider' : v === 'local' ? 'We filter' : 'Not supported');
const filterSupport = (e, kind) => (FILTERS[kind] || []).map(([key, label]) => [label, e && e.filters ? e.filters[key] || 'unsupported' : 'unsupported']);

function engineRow(e) {
    const note = priceNote(e);
    return `<li class="xs-engine${e.available === false ? ' is-off' : ''}"><div class="xs-engine-main"><strong>${esc(nameOf(e))}</strong>`
        + (lineOf(e) ? `<span>${esc(lineOf(e))}</span>` : '')
        + `${e.upstreams && e.upstreams.length && !['openverse', 'commons', 'iconify', 'unsplash', 'pexels', 'pixabay', 'tineye', 'searxng', 'openvibe'].includes(e.id) ? `<span class="xs-upstream">Upstream: ${esc(e.upstreams.join(', '))}</span>` : ''}`
        + `${note ? `<span class="xs-price-note">${esc(note)}</span>` : ''}</div>`
        + `<span class="xs-engine-price">${esc(priceWords(e))}</span>${state(e)}</li>`;
}

function enginePick(field, label, engines, chosen, includeAuto = false, optional = false) {
    const rows = engines.map((e) => `<option value="${esc(e.id)}"${e.id === chosen ? ' selected' : ''}>${esc(nameOf(e))}${e.available === false ? ' (needs a key)' : ''}</option>`).join('');
    const empty = optional ? `<option value=""${chosen ? '' : ' selected'}>No third engine</option>` : '';
    return `<label class="xs-field"><span>${label}</span><select name="${field}">${empty}${includeAuto ? `<option value="auto"${chosen === 'auto' ? ' selected' : ''}>Choose for me (the router's pick)</option>` : ''}${rows}</select></label>`;
}

function resultRows(list, engines, query) {
    if (!list.length) return '';
    const byId = new Map(engines.map((e) => [e.id, e]));
    return `<div class="xs-results">${list.map((x) => {
        const engineId = x.receipt?.engine || x.engine;
        const meta = byId.get(engineId) || byId.get(x.engine) || { id: engineId };
        const cost = Number(x.receipt?.cost_usd) || 0;
        const receipt = x.error ? '' : `<p class="xs-receipt">${cost > 0 ? `${money(cost)} provider cost` : 'No provider fee'} · ${Number(x.receipt?.time_ms) || 0} ms</p>`;
        const attempts = x.receipt?.attempts?.length
            ? `<details class="xs-attempts"><summary>Every attempt</summary><ul>${x.receipt.attempts.map((a) => `<li>${esc(a.engine)}: ${esc(a.status)}${a.reason ? ` · ${esc(a.reason)}` : ''}${Number(a.cost_usd) ? ` · ${money(a.cost_usd)}` : ''}</li>`).join('')}</ul></details>`
            : '';
        const rows = x.error ? `<p class="xs-note">${esc(x.error)}</p>` : `<ol>${x.results.map((r, i) => {
            const upstream = r.upstream || (meta.upstreams && meta.upstreams[0]) || null;
            const use = r.download_location && engineId === 'unsplash'
                ? `<form method="post" action="/search/unsplash" class="xs-use"><input type="hidden" name="download_location" value="${esc(r.download_location)}"><input type="hidden" name="url" value="${esc(r.url)}">${kit.button({ label: 'Use this picture', type: 'submit', kind: 'quiet' })}</form>`
                : '';
            return `<li><a href="${esc(r.source_page || r.url)}" rel="noopener noreferrer">${esc(r.title || r.url)}</a>${r.snippet || r.attribution ? `<p>${esc(r.snippet || r.attribution)}</p>` : ''}${r.thumbnail ? `<img src="${esc(r.thumbnail)}" alt="" loading="lazy" width="160">` : ''}`
                + `<details><summary>Source, rights and rank</summary><p><a href="${esc(r.source_page || r.url)}" rel="noopener noreferrer">Source page</a>${r.author ? ` · ${esc(r.author)}` : ''}${r.license ? ` · ${r.license_url ? `<a href="${esc(r.license_url)}" rel="noopener noreferrer">${esc(r.license)}</a>` : esc(r.license)}` : ' · Reuse rights unknown'}${r.width && r.height ? ` · ${Number(r.width)} × ${Number(r.height)} px` : ''}`
                + ` · Our order #${Number(r.rank) || i + 1}${r.upstream_rank ? ` · Provider's rank #${Number(r.upstream_rank)}` : ''}${upstream ? ` · Upstream: ${esc(upstream)}` : ''}${r.reverse_image ? ' · Reverse image match' : ''}${r.published ? ` · ${esc(r.published)}` : ''}</p></details>${use}</li>`;
        }).join('') || '<li class="xs-note">Nothing found.</li>'}</ol>`;
        return `<section class="xs-result"><h3>${esc(nameOf({ id: x.engine }))}</h3>${receipt}${attempts}${rows}</section>`;
    }).join('')}</div>`;
}

function searchPage({ engines = [], found = [], query = {} } = {}) {
    const kind = KINDS.some(([k]) => k === query.kind) ? query.kind : 'web';
    const mode = query.mode === 'compare' ? 'compare' : 'single';
    const forKind = engines.filter((e) => Array.isArray(e.kinds) && e.kinds.includes(kind));
    const ready = forKind.filter((e) => e.available !== false);
    const singleDefault = query.engine || 'auto';
    const compareDefaults = [
        query.first && query.first !== 'auto' ? query.first : (ready[0] || forKind[0] || {}).id,
        query.second || (ready[1] || forKind[1] || {}).id,
        query.third || '',
    ];
    const selectedIds = mode === 'compare'
        ? compareDefaults.filter(Boolean)
        : singleDefault === 'auto'
            ? (ready.length ? ready : forKind).slice(0, 3).map((e) => e.id)
            : [singleDefault].filter(Boolean);
    const selected = selectedIds.map((id) => engines.find((e) => e.id === id)).filter(Boolean);
    const support = selected.map((e) => `<div class="xs-support-engine"><strong>${esc(nameOf(e))}</strong><span>${filterSupport(e, kind).map(([label, v]) => `${esc(label)}: ${esc(supportShort(v))}`).join(' · ')}</span></div>`).join('');

    const field = (name, label, type = 'text', extra = '') => `<label class="xs-field"><span>${label}</span><input name="${name}" type="${type}" ${extra} value="${esc(query[name] || '')}"></label>`;
    const select = (name, label, values) => `<label class="xs-field"><span>${label}</span><select name="${name}"><option value="">Any</option>${values.map((v) => `<option value="${esc(v[0])}"${query[name] === v[0] ? ' selected' : ''}>${esc(v[1])}</option>`).join('')}</select></label>`;
    const filters = kind === 'images'
        ? select('size', 'Size', [['small', 'Small (under 800 px)'], ['medium', 'Medium (800 to 1999 px)'], ['large', 'Large (2000 px and up)']])
            + select('orientation', 'Orientation', [['landscape', 'Landscape'], ['portrait', 'Portrait'], ['square', 'Square']])
            + select('color', 'Colour', ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'black_and_white'].map((v) => [v, v.replace(/_/g, ' ')]))
            + select('type', 'Type', [['photo', 'Photo'], ['illustration', 'Illustration'], ['vector', 'Vector']])
            + field('license', 'Licence', 'text', 'placeholder="cc0"')
            + `<label class="xs-check"><input type="checkbox" name="commercial" value="true"${query.commercial ? ' checked' : ''}><span>Commercial use only</span></label>`
            + field('format', 'Format', 'text', 'placeholder="jpeg or svg"')
            + field('after', 'After', 'date')
            + `<label class="xs-check"><input type="checkbox" name="safe_search" value="strict"${query.safe_search ? ' checked' : ''}><span>Strict safe search only</span></label>`
        : kind === 'icons'
            ? field('set', 'Icon set', 'text', 'placeholder="lucide"') + select('style', 'Style', [['any', 'Any'], ['line', 'Line'], ['solid', 'Solid']]) + field('license', 'Licence')
            : select('freshness', 'Freshness', [['day', 'Past day'], ['month', 'Past month'], ['year', 'Past year']])
                + `<label class="xs-check"><input type="checkbox" name="safe_search" value="strict"${query.safe_search ? ' checked' : ''}><span>Strict safe search only</span></label>`;
    const filterCount = Object.keys(FILTERS[kind].reduce((a, [key]) => ({ ...a, [key]: query[key] }), {})).filter((key) => query[key]).length;

    const groups = GROUPS.map(([groupKind, label]) => {
        const rows = engines.filter((e) => Array.isArray(e.kinds) && e.kinds.includes(groupKind));
        return rows.length ? `<section class="xs-group"><h3>${esc(label)}<span class="ovk-count">${rows.length}</span></h3><ul class="xs-engines">${rows.map(engineRow).join('')}</ul></section>` : '';
    }).join('');
    const single = `<div class="xs-single">${enginePick('engine', 'Engine', forKind, singleDefault, true)}</div>`;
    const compare = `<div class="xs-compare">${enginePick('first', 'First engine', forKind, compareDefaults[0])}${enginePick('second', 'Second engine', forKind, compareDefaults[1])}${enginePick('third', 'Third engine (optional)', forKind, compareDefaults[2], false, true)}</div>`;
    const resultHead = mode === 'compare'
        ? `<p class="xs-receipt">One combined cap ${query.max_cost_usd != null && query.max_cost_usd !== '' ? money(query.max_cost_usd) : 'not set'} · spent ${money(query.spent || 0)}</p>`
        : `<p class="xs-receipt">Cap ${query.max_cost_usd != null && query.max_cost_usd !== '' ? money(query.max_cost_usd) : 'not set'} · spent ${money(query.spent || 0)}</p>`;
    return `<div class="ex-wrap xs">${kit.head({ title: 'Search', sub: 'Web, pictures and icons from many engines, with the same key as your models. One engine by default; comparing is your choice.' })}`
        + `<section class="xs-try" aria-labelledby="xs-try-h"><h2 id="xs-try-h">Search</h2><form method="post" action="/search" class="xs-form">`
        + `<div class="xs-q"><input name="q" required maxlength="500" placeholder="What are you looking for?" value="${esc(query.q || '')}" aria-label="Search for">`
        + `${kit.button({ label: 'Search', type: 'submit', icon: 'search' })}</div>`
        + `<fieldset class="xs-kinds"><legend class="ex-sr">What to find</legend>${KINDS.map(([k, l]) => `<label><input type="radio" name="kind" value="${k}"${k === kind ? ' checked' : ''}><span>${l}</span></label>`).join('')}</fieldset>`
        + `<fieldset class="xs-modes"><legend class="ex-sr">How many engines</legend><label><input type="radio" name="mode" value="single"${mode === 'single' ? ' checked' : ''}><span>One engine</span></label><label><input type="radio" name="mode" value="compare"${mode === 'compare' ? ' checked' : ''}><span>Compare 2 or 3 engines</span></label></fieldset>`
        + `${single}${compare}`
        + `<label class="xs-field xs-cap"><span>Spending cap, USD</span><input name="max_cost_usd" type="number" min="0" step="0.001" placeholder="Set a cap" value="${query.max_cost_usd != null ? esc(query.max_cost_usd) : ''}"><small>${mode === 'compare' ? 'One combined cap for every engine in this comparison. The search stops before it is exceeded.' : 'The most this search may spend with the provider.'}</small></label>`
        + `<details class="xs-more"${filterCount ? ' open' : ''}><summary>Filters${filterCount ? `<span class="ovk-count">${filterCount}</span>` : ''}<small>for ${esc((KINDS.find(([k]) => k === kind) || [])[1] || 'Web')}</small></summary><div class="xs-more-body">${filters}</div></details>`
        + `<details class="xs-support"${support ? ' open' : ''}><summary>What the chosen ${mode === 'compare' ? 'engines' : 'engine'} can filter</summary>${support || '<p class="xs-note">Choose an engine to see what it can honour.</p>'}<p class="xs-note">A filter the chosen engine cannot honour is refused before the search, never dropped.</p></details>`
        + `</form>${query.note ? `<p class="xs-note">${esc(query.note)}</p>` : ''}${resultHead}${resultRows(found, engines, query)}</section>`
        + `<section class="xs-list" aria-labelledby="xs-list-h"><h2 id="xs-list-h">The engines<span class="ovk-count">${engines.length}</span></h2>`
        + (groups || '<p class="xs-note">The engine list is not reachable right now.</p>') + '</section>'
        + `<p class="xs-note">The words matter: “No provider fee” is open data; “Your instance” is a SearXNG you run; “Included allowance” is a provider free tier; “Your key” is your own key and the provider may charge. Nothing here is labelled free. Pictures come with their licence and author: keep the attribution line with each one.</p></div>`;
}

module.exports = { searchPage, ENGINES };
