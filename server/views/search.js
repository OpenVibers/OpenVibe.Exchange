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
const { asset } = require('../render/layout');

// What a picture's reuse rights say, in plain words, from the result's rights (OpenVibe.AI, plan §W.2 step 1). A web
// discovery result grants nothing; a provider's licence is not an open licence; an open licence names its conditions.
const PROVIDER_NAMES = { unsplash: 'Unsplash', pexels: 'Pexels', pixabay: 'Pixabay' };
function rightsLine(r) {
    const x = r && r.rights;
    if (!x) return '';
    if (x.status === 'unknown' || x.family === 'third_party') return '<p class="xs-rights is-unknown">Rights unknown · discovery only: ask the source before reusing it</p>';
    if (x.family === 'provider_content_license') return `<p class="xs-rights">${esc(PROVIDER_NAMES[x.license_id] || 'Provider')} licence · free to use, not to resell on its own${x.attribution_required ? ' · credit the photographer' : ''}</p>`;
    if (x.family === 'public_domain') return '<p class="xs-rights is-open">Public domain · free to use</p>';
    if (x.family === 'open_license') {
        const terms = [x.commercial_use === false ? 'not for commercial use' : 'commercial use allowed', x.modifications === false ? 'no changes' : '', x.attribution_required ? 'credit the author' : ''].filter(Boolean).join(' · ');
        return `<p class="xs-rights is-open">${esc(x.license_id || 'Open licence')} · ${esc(terms)}</p>`;
    }
    return `<p class="xs-rights is-unknown">${x.license_id ? `${esc(x.license_id)}: ` : ''}a licence the catalog does not name · check before reusing</p>`;
}

const ENGINES = {
    openvibe: ['OpenVibe Search', "OpenVibe's own index of the network's pages."],
    searxng: ['SearXNG', 'Many search engines at once, through our own instance.'],
    wikipedia: ['Wikipedia', "Wikipedia's own search over its articles: facts, with the article linked."],
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
            return `<li><a href="${esc(r.source_page || r.url)}" rel="noopener noreferrer">${esc(r.title || r.url)}</a>${r.snippet || r.attribution ? `<p>${esc(r.snippet || r.attribution)}</p>` : ''}${r.thumbnail ? `<img src="${esc(r.thumbnail)}" alt="" loading="lazy" width="160">` : ''}${rightsLine(r)}`
                + `<details><summary>Source, rights and rank</summary><p><a href="${esc(r.source_page || r.url)}" rel="noopener noreferrer">Source page</a>${r.author ? ` · ${esc(r.author)}` : ''}${r.license ? ` · ${r.license_url ? `<a href="${esc(r.license_url)}" rel="noopener noreferrer">${esc(r.license)}</a>` : esc(r.license)}` : ' · Reuse rights unknown'}${r.width && r.height ? ` · ${Number(r.width)} × ${Number(r.height)} px` : ''}`
                + ` · Our order #${Number(r.rank) || i + 1}${r.upstream_rank ? ` · Provider's rank #${Number(r.upstream_rank)}` : ''}${upstream ? ` · Upstream: ${esc(upstream)}` : ''}${r.reverse_image ? ' · Reverse image match' : ''}${r.published ? ` · ${esc(r.published)}` : ''}</p></details>${use}</li>`;
        }).join('') || '<li class="xs-note">Nothing found.</li>'}</ol>`;
        // The engine that answered (the router's pick names itself in the receipt), never "Auto".
        const who = x.engine === 'auto' ? (x.receipt?.engine ? nameOf({ id: x.receipt.engine }) : "The router's pick") : nameOf({ id: x.engine });
        return `<section class="xs-result"><h3>${esc(who)}</h3>${receipt}${attempts}${rows}</section>`;
    }).join('')}</div>`;
}

// Search v2's depths (AI #669), in the words the page shows: what each does, and its usual cost.
const DEPTHS = [
    ['instant', 'Instant', 'One engine'],
    ['fast', 'Fast', 'Two engines, merged'],
    ['standard', 'Standard', 'Three engines, rewrites, pages read'],
    ['deep', 'Deep', 'A second round for what is missing'],
];
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
// A depth's steps, changed for one search (search v2's steps; the owner, 11-21: "more configurable"): each defaults to
// the chosen depth's own, so nobody has to touch them.
const STEP_ROWS = [
    ['rewrites', 'rewrites', 'Rewritten queries', [0, 1, 2, 3], 'The question asked again in other words.'],
    ['second', 'second_round', 'Second round', [0, 2, 3], 'Searches for what the first round missed.'],
    ['pages', 'pages_read', 'Pages read', [0, 3, 6, 10], 'Top pages read for the passage that answers.'],
];
function stepsBlock(steps) {
    const set = steps && typeof steps === 'object' ? steps : {};
    const changed = STEP_ROWS.filter(([, name]) => set[name] != null);
    const words = changed.length ? changed.map(([, name, label]) => `${label.toLowerCase()} ${set[name]}`).join(' · ') : "the depth's own";
    return `<details class="xs-steps"${changed.length ? ' open' : ''}><summary>Steps<small>${esc(words)}</small></summary><div class="xs-steps-body">`
        + STEP_ROWS.map(([field, name, label, values, hint]) => `<div class="xs-field xs-time"><span id="xs-st-${field}">${label}</span><fieldset class="xs-modes" aria-labelledby="xs-st-${field}">`
            + [['', 'Depth'], ...values.map((n) => [String(n), String(n)])].map(([v, l]) => `<label><input type="radio" name="${field}" value="${v}"${String(set[name] == null ? '' : set[name]) === v ? ' checked' : ''}><span>${l}</span></label>`).join('')
            + `</fieldset><small>${esc(hint)}</small></div>`).join('')
        + '</div></details>';
}
// What the search box suggests while it is empty (openvibe-shared ov-trending's data-ov-trending-items): questions that
// show what a web search here does. Without a list of its own the box suggested the page's headings, and one came out as
// "The engines35" (the heading with its count badge, 11-20).
const BOX_EXAMPLES = ['When does the Louvre close on Wednesdays?', 'The current Node.js LTS version', 'Who won the 2024 Nobel Prize in Physics?', 'Cheapest H100 per hour this month', 'Best open-source search engines for agents'];
const PICTURE_EXAMPLES = ['Mountain lake at sunrise', 'Open-licence city skyline', 'Vintage robot illustration'];
const ICON_EXAMPLES = ['home', 'search', 'settings', 'arrow right'];
/** An answer's text with its [n] markers as links to the numbered sources below it. */
const cited = (text) => esc(text).replace(/\[(\d{1,2})\]/g, (m, n) => `<a class="xs-cite" href="#xs-r${n}">[${n}]</a>`);

/**
 * One search v2 answer (AI #669): the sourced answer first when asked, then one list, every engine's results merged and
 * deduplicated, each saying which engines found it and, read from the page, the passage that answers the question.
 * One line says what it cost and what was folded away; the receipt (every call, read and model step) folds below.
 */
function multiResults(out, engines, { pending = null, answering = false } = {}) {
    if (!out) return '';
    const rec = out.receipt || {};
    const names = (ids) => (ids || []).map((id) => nameOf({ id })).join(', ');
    const cost = Number(rec.cost_usd) || 0;
    const line = [`${(out.results || []).length} results from ${names(rec.engines) || 'the engines'}`,
        rec.duplicates_removed ? `${rec.duplicates_removed} duplicate${rec.duplicates_removed === 1 ? '' : 's'} folded` : '',
        cost > 0 ? `${money(cost)}` : 'No provider fee', `${(Number(rec.time_ms) / 1000).toFixed(1)} s`].filter(Boolean).join(' · ');
    const q = out.queries || {};
    const also = [...(q.variants || []), ...(q.follow_ups || [])];
    const answer = out.answer && out.answer.text
        ? `<section class="xs-answer" aria-labelledby="xs-answer-h"><h3 id="xs-answer-h">${kit.icon('spark')}<span>Answer</span></h3><p>${cited(out.answer.text)}</p>`
            + ((out.answer.citations || []).length ? `<ol class="xs-cites">${out.answer.citations.map((c) => `<li value="${Number(c.n)}"><a href="${esc(c.url)}" rel="noopener noreferrer">${esc(c.title || c.url)}</a> <span>${esc(hostOf(c.url))}</span></li>`).join('')}</ol>` : '')
            + '</section>'
        : answering
            // Streaming: the answer's place is kept at the top while the model writes it from the sources below.
            ? `<section class="xs-answer is-pending" aria-labelledby="xs-answer-h" aria-busy="true"><h3 id="xs-answer-h">${kit.icon('spark')}<span>Answer</span></h3><p class="xs-pending"><span></span><span></span><span></span></p></section>`
            // A stopped search never wrote its answer: that is the stop, not the sources (11-21).
            : (out.answer === null && !(out.receipt && out.receipt.stopped) ? '<p class="xs-note">The sources did not give an answer this time; the results are below.</p>' : '');
    const rows = (out.results || []).map((r, i) => `<li id="xs-r${i + 1}" class="xs-hit"><a href="${esc(r.url)}" rel="noopener noreferrer">${esc(r.title || r.url)}</a>`
        + `<span class="xs-hit-meta">${esc(hostOf(r.url))}${r.published ? ` · ${esc(String(r.published).slice(0, 10))}` : ''}</span>`
        + (r.excerpt ? `<blockquote class="xs-excerpt">${esc(r.excerpt)}</blockquote>` : r.snippet ? `<p>${esc(r.snippet)}</p>` : '')
        + `<span class="xs-found">${(r.engines || [r.engine]).map((id) => `<b>${esc(nameOf({ id }))}</b>`).join('')}${(r.engines || []).length > 1 ? '<em>agree</em>' : ''}</span></li>`).join('');
    const calls = (rec.calls || []).map((c) => `<li>${esc(nameOf({ id: c.engine }))}: “${esc(c.query)}” · ${esc(c.status)}${c.reason ? ` (${esc(c.reason)})` : ''} · ${Number(c.results) || 0} results${Number(c.cost_usd) ? ` · ${money(c.cost_usd)}` : ''} · ${Number(c.time_ms) || 0} ms${c.cache ? ' · kept answer' : ''}</li>`).join('');
    const reads = (rec.reads || []).map((x) => `<li>Read ${esc(hostOf(x.url))} · ${esc(x.status)}${x.reason ? ` (${esc(x.reason)})` : ''}</li>`).join('');
    const steps = (rec.steps || []).map((x) => `<li>${esc({ variants: 'Rewrote the question', follow_ups: 'Planned a second round', answer: 'Wrote the answer', structured: 'Filled the shape' }[x.step] || x.step)} · ${esc(x.status)}${x.model ? ` · ${esc(x.model)}` : ''}${Number(x.cost_usd) ? ` · ${money(x.cost_usd)}` : ''}</li>`).join('');
    if (pending) {
        // Streaming: what is being done now instead of the receipt, which only the end knows.
        return `<div class="xs-multi is-streaming">${answer}<p class="xs-receipt xs-now" role="status">${esc(`${(out.results || []).length} results so far · ${pending}`)}</p>`
            + (rows ? `<ol class="xs-hits">${rows}</ol>` : '') + '</div>';
    }
    // Watch for new results (plan AD.34 item 6): the same words, once a day, the person told of what is new.
    const asked = (q.asked || [])[0];
    const watch = asked ? `<form method="post" action="/search/watch" class="xs-watch"><input type="hidden" name="q" value="${esc(asked)}">${kit.button({ label: 'Watch for new results', type: 'submit', icon: 'bell', kind: 'quiet' })}<small>Once a day, you are told of results not shown before.</small></form>` : '';
    return `<div class="xs-multi">${answer}<p class="xs-receipt">${esc(line)}</p>${watch}`
        + (also.length ? `<p class="xs-also"><span>Also searched</span>${also.map((x) => `<em>${esc(x)}</em>`).join('')}</p>` : '')
        + (rows ? `<ol class="xs-hits">${rows}</ol>` : '<p class="xs-note">Nothing found.</p>')
        + `<details class="xs-attempts"><summary>Every call, read and step</summary><ul>${calls}${reads}${steps}</ul></details></div>`;
}

/** The same search from code: three lines (the owner sent Linkup's "3 lines of code" ad, 11-20). */
function codeCard(q, depth, answer, apiBase) {
    const base = String(apiBase || 'https://api.openvibe.exchange').replace(/\/+$/, '');
    const body = { q: q || 'who raised a Series A this week?', depth: depth || 'standard', ...(answer ? { output: 'answer' } : {}) };
    const json = JSON.stringify(body);
    const curl = `curl ${base}/v1/search -H "Authorization: Bearer $OPENVIBE_KEY" \\\n  -H "Content-Type: application/json" -d '${json.replace(/'/g, "'\\''")}'`;
    const js = `const r = await fetch('${base}/v1/search', { method: 'POST',\n  headers: { Authorization: \`Bearer \${key}\`, 'Content-Type': 'application/json' },\n  body: JSON.stringify(${json}) });`;
    const py = `import requests\nr = requests.post("${base}/v1/search", headers={"Authorization": f"Bearer {key}"},\n  json=${json.replace(/true/g, 'True').replace(/false/g, 'False')})`;
    return `<details class="xs-code"><summary>${kit.icon('code')}<span>Use it in code</span><small>three lines, your Exchange key</small></summary>`
        + `<div class="xs-code-body"><p class="xs-note">One call for people and agents. Leave everything but q out for one quick engine; add depth (instant, fast, standard, deep), queries (up to five at once), output (results, answer, structured with a JSON schema), include_domains, exclude_domains or from. Every answer has a receipt. <a href="/keys">Get a key</a> · <a href="/api">The API</a></p>`
        + `<p class="xs-code-k">curl</p><pre><code>${esc(curl)}</code></pre><p class="xs-code-k">JavaScript</p><pre><code>${esc(js)}</code></pre><p class="xs-code-k">Python</p><pre><code>${esc(py)}</code></pre></div></details>`;
}

/**
 * Deep dive this (11-15, the owner: Exchange's search was meant to "deep dive any query in a general sense"): under
 * any question, the way to the general deep dive, its three depths and their prices. It reads the best pages in full
 * and answers with every source named (AI research.deep_dive); the search above stays the quick look.
 */
function diveCard(q, depths) {
    const list = (depths && depths.length ? depths : [{ key: 'quick', label: 'Quick', price_usd: 0.1, pages: 8 }, { key: 'thorough', label: 'Thorough', price_usd: 0.3, pages: 16 }, { key: 'expert', label: 'Expert', price_usd: 0.8, pages: 30 }]);
    const dollars = (n) => `$${Number(n || 0).toFixed(2)}`;
    return `<section class="xs-dive" aria-labelledby="xs-dive-h"><div class="xs-dive-text"><h2 id="xs-dive-h">${kit.icon('spark')}<span>Deep dive this</span></h2><p>We plan the questions an expert would ask, read the best pages in full, and answer with every source named.</p></div>`
        + `<form method="post" action="/deep-dive" class="xs-dive-form"><input type="hidden" name="question" value="${esc(q)}">`
        + `<fieldset class="xs-dive-depths"><legend class="ex-sr">How deep</legend>${list.map((d, i) => `<label><input type="radio" name="depth" value="${esc(d.key)}"${i === 0 ? ' checked' : ''}><span><b>${esc(d.label || d.key)}</b><small>${esc(String(d.pages || ''))} pages · ${esc(dollars(d.price_usd))}</small></span></label>`).join('')}</fieldset>`
        + `${kit.button({ label: 'Deep dive', type: 'submit', icon: 'spark' })}</form></section>`;
}

/**
 * The part of the page a search changes: the results first (on a phone the offer above them pushed every result off
 * the screen, 11-20), then the deep dive offer for the same question.
 */
function liveBlock({ q = '', kind = 'web', dive = null, out = '' } = {}) {
    return (out ? `<section class="xs-out" aria-labelledby="xs-out-h"><h2 id="xs-out-h" class="ex-sr">Results</h2>${out}</section>` : '')
        + (q && kind === 'web' ? diveCard(q, dive && dive.depths) : '');
}

/**
 * What a depth really cost and took lately, in a few words ("~1.2 s · $0.0008"), from AI's measurements of its recent
 * searches; nothing until a handful were measured. One line for a list, one for a list with an answer.
 */
function measuredWords(m) {
    if (!m || !(m.n >= 3) || !m.time_ms || !m.cost_usd) return '';
    const s = m.time_ms.p50 / 1000;
    const c = m.cost_usd.p50;
    const cost = c <= 0 ? 'no fee' : c < 0.0001 ? 'under $0.0001' : `$${c < 0.01 ? c.toFixed(4).replace(/0+$/, '') : c.toFixed(3)}`;
    return `~${s < 10 ? s.toFixed(1) : Math.round(s)} s · ${cost}`;
}

function searchPage({ engines = [], found = [], query = {}, dive = null, multi = null, apiBase = null, depths = [], accuracy = false } = {}) {
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
                + `<label class="xs-check"><input type="checkbox" name="safe_search" value="strict"${query.safe_search ? ' checked' : ''}><span>Strict safe search only</span></label>`
                + field('from', 'Published after', 'date')
                + field('include', 'Only these sites', 'text', 'placeholder="example.com, docs.example.org" autocomplete="off"')
                + field('exclude', 'Never these sites', 'text', 'placeholder="pinterest.com" autocomplete="off"')
                + `<label class="xs-field xs-more-q"><span>More searches at once</span><textarea name="more" rows="3" maxlength="2600" placeholder="One per line, up to five: searched with the box above and merged into one list">${esc(query.more || '')}</textarea></label>`;
    const filterCount = Object.keys(FILTERS[kind].reduce((a, [key]) => ({ ...a, [key]: query[key] }), {})).filter((key) => query[key]).length
        + (kind === 'web' ? ['from', 'include', 'exclude', 'more'].filter((k) => query[k]).length : 0);

    const groups = GROUPS.map(([groupKind, label]) => {
        const rows = engines.filter((e) => Array.isArray(e.kinds) && e.kinds.includes(groupKind));
        return rows.length ? `<section class="xs-group"><h3>${esc(label)}<span class="ovk-count">${rows.length}</span></h3><ul class="xs-engines">${rows.map(engineRow).join('')}</ul></section>` : '';
    }).join('');
    const single = `<div class="xs-single">${enginePick('engine', 'Engine', forKind, singleDefault, true)}</div>`;
    const compare = `<div class="xs-compare">${enginePick('first', 'First engine', forKind, compareDefaults[0])}${enginePick('second', 'Second engine', forKind, compareDefaults[1])}${enginePick('third', 'Third engine (optional)', forKind, compareDefaults[2], false, true)}</div>`;
    const capSet = query.max_cost_usd != null && query.max_cost_usd !== '';
    const searched = found.length > 0 || query.spent != null || !!multi;   // a search ran (the cost line shows even when nothing came back)
    const depth = DEPTHS.some(([d]) => d === query.depth) ? query.depth : 'fast';
    const resultHead = !searched ? ''
        : mode === 'compare'
            ? `<p class="xs-receipt">One combined cap ${capSet ? money(query.max_cost_usd) : 'not set'} · spent ${money(query.spent || 0)}</p>`
            : `<p class="xs-receipt">Cap ${capSet ? money(query.max_cost_usd) : 'not set'} · spent ${money(query.spent || 0)}</p>`;
    // What the folded settings are now, in a few words, so nobody has to open them to know.
    const engineWords = mode === 'compare'
        ? `Compare ${compareDefaults.filter(Boolean).map((id) => nameOf({ id })).join(', ')}`
        : singleDefault === 'auto' ? "The router's pick" : nameOf({ id: singleDefault });
    const optsWords = [engineWords, query.free_only ? 'free engines only' : '', capSet ? `cap ${money(query.max_cost_usd)}` : 'no cap', query.time_limit ? `${query.time_limit} s limit` : '', query.steps ? 'own steps' : '', filterCount ? `${filterCount} filter${filterCount === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
    const optsOpen = mode === 'compare' || capSet || filterCount > 0 || !!query.free_only || !!query.time_limit || !!query.steps;
    // Spending less (web, one search): only what costs nothing, and a time after which the search answers with what it
    // has. Both are search v2's (free_only, max_time_ms); the Stop button while it runs is the third way.
    const saving = kind === 'web' && mode === 'single'
        ? `<label class="xs-answer-sw xs-free-sw"><input type="checkbox" name="free_only" value="true" role="switch"${query.free_only ? ' checked' : ''}><span class="xs-sw" aria-hidden="true"></span><span>Free engines only<small>OpenVibe's own index, Wikipedia and the metasearch: the search itself costs nothing.</small></span></label>`
            + `<div class="xs-field xs-time"><span id="xs-time-l">Time limit</span><fieldset class="xs-modes" aria-labelledby="xs-time-l">${[['', 'None'], ...[5, 15, 30].map((n) => [String(n), `${n} s`])].map(([v, l]) => `<label><input type="radio" name="time_limit" value="${v}"${String(query.time_limit || '') === v ? ' checked' : ''}><span>${l}</span></label>`).join('')}</fieldset><small>When it runs out, you get the results found so far and pay only for what ran.</small></div>`
            + stepsBlock(query.steps)
        : '';
    // 11-15 (the owner: "nothing happens upon search attempt … the search bar fixed float top when you scroll down"):
    // the box, its button and the kind ride at the top while the page scrolls; the answer (results, or why there are
    // none) comes straight under them; the engine, the cap and the filters fold below, closed until they matter. The
    // controls in the bar belong to the form through form="xs-form", so the bar can stick across the whole page.
    const F = 'form="xs-form"';
    return `<div class="ex-wrap xs">${kit.head({ title: 'Search', sub: 'Web, pictures and icons from many engines, with the same key as your models.', sticky: false, actions: [kit.button({ href: query.q ? `/deep-dive?q=${encodeURIComponent(query.q)}` : '/deep-dive', label: 'Deep dive', icon: 'spark', kind: 'quiet' })] })}`
        + `<div class="xs-bar" role="search">`
        + `<div class="xs-q"><input ${F} name="q" type="search" required maxlength="500" enterkeyhint="search" placeholder="What are you looking for?" value="${esc(query.q || '')}" aria-label="Search for" data-ov-trending-items="${esc(JSON.stringify(kind === 'images' ? PICTURE_EXAMPLES : kind === 'icons' ? ICON_EXAMPLES : BOX_EXAMPLES))}">`
        + `${kit.button({ label: 'Search', type: 'submit', icon: 'search', attrs: { form: 'xs-form' } })}</div>`
        + `<fieldset class="xs-kinds"><legend class="ex-sr">What to find</legend>${KINDS.map(([k, l]) => `<label><input ${F} type="radio" name="kind" value="${k}"${k === kind ? ' checked' : ''}><span>${l}</span></label>`).join('')}</fieldset>`
        + `</div>`
        // How deep, and whether to write an answer (web, one search): the two choices that matter most, right under the
        // bar. Outside it, so what rides along while results scroll is only the box and the kind (on a phone the
        // whole set took 40 % of the screen, 11-20).
        + (kind === 'web' && mode === 'single' ? `<div class="xs-deep${query.answer ? ' is-answer' : ''}"><fieldset class="xs-depths"><legend class="ex-sr">How deep</legend>${DEPTHS.map(([d, l, hint]) => {
            const m = (Array.isArray(depths) ? depths : []).find((x) => x && x.depth === d);
            const list = measuredWords(m && m.measured && m.measured.results), answered = measuredWords(m && m.measured && m.measured.answer);
            const lately = list || answered ? `<em class="xs-dm"${list ? '' : ' hidden'}>${esc(list)}</em><em class="xs-dm xs-dm-a">${esc(answered || list)}</em>` : '';
            return `<label title="${esc(hint)}"><input ${F} type="radio" name="depth" value="${d}"${d === depth ? ' checked' : ''}><span><b>${l}</b><small>${esc(hint)}</small>${lately}</span></label>`;
        }).join('')}</fieldset>`
            + `<label class="xs-answer-sw"><input ${F} type="checkbox" name="answer" value="true" role="switch"${query.answer ? ' checked' : ''}><span class="xs-sw" aria-hidden="true"></span><span>Answer with sources</span></label>${accuracy ? '<a class="xs-acc" href="/search/accuracy">How accurate is each depth?</a>' : ''}</div>` : '')
        + `<div id="xs-working" class="xs-working"></div>`
        + `<div id="xs-live">${liveBlock({ q: query.q, kind, dive, out: searched || query.note ? `${query.note ? (query.noteOk ? `<p class="xs-note is-ok" role="status">${kit.icon('check')}<span>${esc(query.note)}</span></p>` : `<p class="xs-note">${esc(query.note)}</p>`) : ''}${multi ? multiResults(multi, engines) : resultHead + resultRows(found, engines, query)}` : '' })}</div>`
        + (kind === 'web' ? `<div id="xs-code">${codeCard(query.q, depth === 'instant' ? 'fast' : depth, !!query.answer, apiBase)}</div>` : '')
        + `<form id="xs-form" method="post" action="/search" class="xs-form" data-working-in="#xs-working" data-stream="/search/stream"${query.autorun ? ' data-autorun="1"' : ''}>`
        + (kind === 'web' ? `<script src="${asset('js/search-stream.js')}" defer></script>` : '')
        + `<details class="xs-opts"${optsOpen ? ' open' : ''}><summary><span>Engine, cap and filters</span><small>${esc(optsWords)}</small></summary><div class="xs-opts-body">`
        + `<fieldset class="xs-modes"><legend class="ex-sr">How many engines</legend><label><input type="radio" name="mode" value="single"${mode === 'single' ? ' checked' : ''}><span>One engine</span></label><label><input type="radio" name="mode" value="compare"${mode === 'compare' ? ' checked' : ''}><span>Compare 2 or 3 engines</span></label></fieldset>`
        + `${single}${compare}${saving}`
        + `<label class="xs-field xs-cap"><span>Spending cap, USD</span><input name="max_cost_usd" type="number" min="0" step="0.001" inputmode="decimal" placeholder="No cap" value="${query.max_cost_usd != null ? esc(query.max_cost_usd) : ''}"><small>${mode === 'compare' ? 'One combined cap for every engine in this comparison. The search stops before it is exceeded.' : 'The most this search may spend with the provider.'}</small></label>`
        + `<details class="xs-more"${filterCount ? ' open' : ''}><summary>Filters${filterCount ? `<span class="ovk-count">${filterCount}</span>` : ''}<small>for ${esc((KINDS.find(([k]) => k === kind) || [])[1] || 'Web')}</small></summary><div class="xs-more-body">${filters}</div></details>`
        + `<details class="xs-support"><summary>What the chosen ${mode === 'compare' ? 'engines' : 'engine'} can filter</summary>${support || '<p class="xs-note">Choose an engine to see what it can honour.</p>'}<p class="xs-note">A filter the chosen engine cannot honour is refused before the search, never dropped.</p></details>`
        + `</div></details></form>`
        + `<section class="xs-list" aria-labelledby="xs-list-h"><h2 id="xs-list-h">The engines<span class="ovk-count">${engines.length}</span></h2>`
        + (groups || '<p class="xs-note">The engine list is not reachable right now.</p>') + '</section>'
        + `<p class="xs-note">The words matter: “No provider fee” is open data; “Your instance” is a SearXNG you run; “Included allowance” is a provider free tier; “Your key” is your own key and the provider may charge. Nothing here is labelled free. Pictures come with their licence and author: keep the attribution line with each one.</p></div>`;
}

module.exports = { searchPage, ENGINES, multiResults, codeCard, liveBlock, measuredWords, DEPTHS };
