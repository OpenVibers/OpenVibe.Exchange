'use strict';
const kit = require('openvibe-shared/kit');
const glyphs = require('openvibe-shared/glyphs');
const thread = require('openvibe-shared/thread');
const legacy = require('./exchange');
const listed = (catalog) => legacy.chatModels(catalog);
const unavailable = (catalog) =>
    catalog.unavailable
        ? '<p role="status">The live catalogue is not reachable right now.</p>'
        : '';
const { esc } = require('../render/html');
const free = (o) =>
    o.free_now === undefined ? o.free_tier === true : o.free_now === true;
const paused = (o) => o.free_tier === true && o.free_now === false;
const id = (m) => m.slug || m.canonical;
const price = (v) =>
    v == null
        ? 'Not priced'
        : `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
const metric = (v, unit = '') =>
    v == null
        ? 'Not measured'
        : `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}${unit}`;
const best = (m) =>
    [...(m.offers || [])]
        .filter((o) => o.price)
        .sort(
            (a, b) => a.price.in + a.price.out - b.price.in - b.price.out,
        )[0] ||
    (m.offers || [])[0] ||
    {};
const chat = (m) =>
    `https://openvibe.chat/vibe?models=${encodeURIComponent(id(m))}`;
const rank = (m) =>
    `https://openvibe.compare/ai/models/${encodeURIComponent(id(m))}`;
const section = (title, body) => kit.section({ title, body });
const modelSearch = (query = {}, filters = false, suggest = null) => {
    const field = (name, label, placeholder = '') => `<label>${esc(label)} <input name="${name}" value="${esc(query[name] || '')}" placeholder="${esc(placeholder)}"></label>`;
    const options = filters ? { label: 'Search filters', html: [
        field('provider', 'Provider'), field('capability', 'Capability', 'vision'),
        field('min_price', 'Min $/M out'), field('max_price', 'Max $/M out'),
        field('max_speed_ms', 'Max median ms'), field('rating_kind', 'Benchmark', 'chat.arena'),
        '<button class="ovk-btn ovk-btn--quiet" type="submit">Apply filters</button>',
    ].join('') } : null;
    const form = thread.composer({ action: '/models', method: 'get', name: 'q', value: query.q || '',
        id: filters ? 'model-search' : 'home-model-search', label: 'Search models',
        placeholder: 'Find a model or a provider', sendLabel: 'Search models', maxlength: 120,
        // A model search takes words (typed or spoken), never a camera, photos or files: no + and no file chips (11-14).
        options, attrs: { 'data-ovc-no-draft': '', 'data-ovc-no-more': '', 'data-ovc-no-files': '', style: '--ovt-line:var(--border,#1f2d47);--ovt-accent:var(--accent,#3b82f6)',
            // What rotates in the box (openvibe-shared ov-trending, 4.284.0): this page's own models, never the network's
            // trending people (the owner, 11-16: "the suggestions … animated … shared with the other sites").
            ...(Array.isArray(suggest) && suggest.length ? { 'data-ov-trending-items': JSON.stringify(suggest.slice(0, 12)) } : {}) },
        commands: [{ name: 'gemini', hint: 'Find Gemini models', insert: 'gemini' },
            { name: 'gpt', hint: 'Find GPT models', insert: 'gpt' }],
    });
    // The shared prompt is required by default. Filters can be submitted on their own.
    return filters ? form.replace(' data-ovt-text required', ' data-ovt-text') : form;
};
const code = (m) =>
    kit.snippet({
        id: 'platform-curl',
        code: `curl https://api.openvibe.exchange/v1/chat/completions \\\n  -H "Authorization: Bearer $OPENVIBE_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify({ model: m || 'openvibe/auto', messages: [{ role: 'user', content: 'Hello' }] })}'`,
    });
/** "$0.05" / "$0.40": prices per million tokens in a person's terms (free shows as Free). */
const perM = (v) => (v == null ? '–' : Number(v) === 0 ? 'Free' : `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 })}`);
const dash = (v, unit = '') => (v == null ? '–' : `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}${unit}`);
/**
 * The models as rows (home's popular models and /models): the name and its maker with badges, in / out per million,
 * uptime and speed with their labels, and Try in Chat / How it ranks as small quiet buttons. Opus, 11-09.
 */
function table(models, searchMeta = null) {
    if (!models.length) return kit.empty({ icon: 'search', title: 'Nothing you can call now matches',
        text: 'The registry below lists every model a provider names, routed or not.',
        action: { href: '/models#directory-more', label: 'See the registry', kind: 'quiet' } });
    return `<ul class="xm-list">${models.map((m) => {
        const found = searchMeta && searchMeta.get(id(m));
        const o = found ? { price: found.price, speed: found.speed, provider_name: found.provider } : best(m);
        const badges = [
            (m.offers || []).some(free) ? kit.badge('Free to try') : (m.offers || []).some(paused) ? kit.badge('Free paused') : '',
            m.uncensored ? kit.badge('18+', 'bad') : '',
            o.fixed_price ? kit.badge('Fixed price') : '',
        ].filter(Boolean).join(' ');
        // Only what was measured: a fact with no value is left out, never a dash (the owner, 11-16).
        const fact = (label, value) => (value == null || value === '–' || value === '– / –' ? '' : `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`);
        return `<li class="xm-row"><div class="xm-name"><a href="/models/${encodeURIComponent(id(m))}">${esc(m.name)}</a><span class="xm-maker">${esc(legacy.familyLabel(m))}</span>${badges ? `<span class="xm-badges">${badges}</span>` : ''}</div>`
            + `<dl class="xm-facts">${fact('In / out per M', `${perM(o.price?.in)} / ${perM(o.price?.out)}`)}${fact('Uptime', o.uptime == null ? '–' : `${dash(o.uptime * 100)}%`)}${fact('Speed', o.speed?.tokens_per_second != null ? `${dash(o.speed.tokens_per_second)} tok/s` : o.speed?.p50_ms == null ? '–' : `${dash(o.speed.p50_ms)} ms`)}${found ? fact('Quality', found.quality ? `${dash(found.quality.elo)} Elo · ${found.quality.games} games` : 'Not measured') : ''}${found ? fact('Provider', found.provider) : ''}${found?.task_match ? fact('Task match', found.task_match) : ''}</dl>`
            + `<p class="xm-acts">${kit.button({ href: chat(m), label: 'Try in Chat', icon: 'chat', kind: 'quiet', small: true, attrs: { 'aria-label': `Try ${m.name} in Chat`, title: 'Try in Chat' } })} ${kit.button({ href: rank(m), label: 'How it ranks', icon: 'trophy', kind: 'quiet', small: true, attrs: { 'aria-label': `How ${m.name} ranks`, title: 'How it ranks' } })}</p></li>`;
    }).join('')}</ul>`;
}
// What each way of calling costs, in the reader's words (home's Pricing section and /pricing). Opus, 11-09.
const glyph = (name) => require('openvibe-shared/glyphs').svg(name);
const PRICING = [
    ['key', 'Your own provider key', "The provider's price. OpenVibe adds 0%, with no cap and no end date."],
    ['coin', 'Managed models', 'The input and output price per million tokens shown on each model, before you call.'],
    ['chip', "Open models on OpenVibe's GPUs", 'A fixed price per million tokens, the same on every call. Coming next.'],
    ['server', 'Your own endpoint', 'An hourly price, quoted before it starts; it stops when idle.'],
    ['search', 'Search', "Each engine's price per 1,000 searches; the free engines first."],
];
const pricingRows = () => `<ul class="xpr-list">${PRICING.map(([icon, name, what]) => `<li><span class="xpr-ic" aria-hidden="true">${glyph(icon)}</span><span class="xpr-t"><strong>${esc(name)}</strong><span>${esc(what)}</span></span></li>`).join('')}</ul>`
    + '<p class="xpr-note">Paid models open soon. Every price shows before you call, and nothing is charged until then.</p>';
function pricing() {
    return section('Pricing', pricingRows());
}
// Why Exchange: three cards, each with its mark, its words and the page that says more (the owner, 11-12: the
// reasons read as bare text flush against their boxes).
const REASONS = [
    ['route', 'The cheapest route', 'Every call goes to the cheapest provider that is up, among every offer of the model you name.', '/models', 'Compare the offers'],
    ['chart', 'Measured, not guessed', 'Prices come from the live catalogue; speed and uptime from real requests. A number nobody has measured stays unknown.', '/status', 'See the status'],
    ['shield', 'Uncensored & abliterated, 18+', 'Abliterated and uncensored models that answer what filtered models refuse, through the same API, for adults who opt in. The floor applies on every request.', '/uncensored', 'Uncensored models'],
];
function reasons() {
    return `<section class="xp-features" aria-label="Why OpenVibe.Exchange">${REASONS.map(([icon, title, text, href, label]) =>
        `<article class="xp-feature" data-ov-reveal><span class="xp-feature-ic" aria-hidden="true">${glyph(icon)}</span><h3>${esc(title)}</h3><p>${esc(text)}</p><a class="xp-feature-a" href="${href}">${esc(label)}<span aria-hidden="true">${glyph('arrow-right')}</span></a></article>`).join('')}</section>`;
}
const QUESTIONS = [
    ['code', 'Can I use my existing client?', 'Yes. Point any OpenAI-compatible client at the Exchange endpoint with your Exchange key; Anthropic-style clients work through /v1/messages.', '/docs', 'Read the docs'],
    ['chat', 'Where can I talk to a model?', 'In Vibe on OpenVibe.Chat: talk to any model here, or two side by side.', 'https://openvibe.chat/vibe', 'Open Vibe'],
    ['server', 'What does my own endpoint cost?', 'An hourly price for the computer it runs on, quoted before it starts; it stops when idle. Compute prices lists what each provider charges.', '/compute', 'Compute prices'],
];
const question = ([icon, q, a, href, label]) => `<details class="xp-q"><summary><span class="xp-q-ic" aria-hidden="true">${glyph(icon)}</span><span class="xp-q-t">${esc(q)}</span><span class="xp-q-chev" aria-hidden="true">${glyph('chevron')}</span></summary><div class="xp-q-a"><p>${esc(a)}</p><a href="${href}">${esc(label)}</a></div></details>`;
function questions() {
    return section('Questions', `<div class="xp-faq">${QUESTIONS.map(question).join('')}</div>`);
}

// /compute: what an hour of a computer or a GPU costs at each provider (the owner, 11-12: the raw table ran off a
// phone; "this compute list should be on openvibe.compare … or at least interconnected"). Cards by kind, the cheapest
// marked, the provider's own price page one tap away; the same list is GET /api/compute/prices, and OpenVibe.Compare
// compares it.
const PROVIDER = { baseten: 'Baseten', daytona: 'Daytona', e2b: 'E2B', fly: 'Fly.io', runpod: 'RunPod', modal: 'Modal', vast: 'Vast.ai', lambda: 'Lambda' };
const REGION = { 'us-pdx-1': 'US West', 'eu-lon-1': 'London', us: 'US', eu: 'EU', iad: 'Virginia', ewr: 'New Jersey', 'provider-default': "The provider's region" };
const gb = (mb) => `${Math.round((Number(mb) || 0) / 1024)} GB`;
const perHour = (n) => `$${Number(n).toFixed(n < 0.1 ? 3 : 2)}`;
function ago(iso, now) {
    const days = Math.floor((now - Date.parse(iso)) / 86400000);
    return !Number.isFinite(days) ? 'recently' : days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}
function computePage({ prices = [], checked_at, now = Date.now() }) {
    const kinds = [['gpu', 'GPUs', 'chip', 'For models and anything that needs a graphics card.'], ['cpu', 'Computers', 'server', 'Sandboxes and desks: two cores and a few GB of memory.']];
    const stale = prices.some((p) => p.expires_at && now > p.expires_at);
    const row = (p, cheapest) => {
        const name = PROVIDER[p.provider] || p.provider;
        const what = p.gpu ? `${p.gpu} · ${gb(p.gpu_mb)}` : `${p.cpu} vCPU · ${gb(p.ram_mb)} memory`;
        const where = REGION[p.region] || p.region || '';
        // Daytona's own price page calls the cheap tier "Preemptible": the machine may be stopped at any time.
        // The tag says the provider's word, so a reader who has seen the page recognises the row.
        const tags = [cheapest ? '<span class="xc-tag is-best">Cheapest</span>' : '', p.interruptible ? '<span class="xc-tag" title="The provider may stop this machine at any time">Preemptible</span>' : '', p.promotion ? `<span class="xc-tag is-promo" title="${esc(p.promotion)}">Offer</span>` : ''].join('');
        return `<li class="xc-row"><span class="xc-mark" aria-hidden="true">${esc(name.charAt(0))}</span><span class="xc-t"><b>${esc(name)}</b><small>${esc([what, where].filter(Boolean).join(' · '))}</small>${tags ? `<span class="xc-tags">${tags}</span>` : ''}</span>`
            + `<span class="xc-p"><b>${perHour(p.hourly)}<small>/hour</small></b><small>$${Number(p.per_second).toFixed(6)}/second</small></span>`
            + `<a class="xc-src" href="${esc(p.source)}" rel="noopener nofollow" target="_blank" aria-label="${esc(name)}'s price page">${glyph('open')}</a></li>`;
    };
    const groups = kinds.map(([kind, title, icon, note]) => {
        const list = prices.filter((p) => (p.kind || (p.gpu ? 'gpu' : 'cpu')) === kind).sort((a, b) => a.hourly - b.hourly);
        if (!list.length) return '';
        return `<section class="xc-group" id="${kind}"><h2><span class="xc-ic" aria-hidden="true">${glyph(icon)}</span>${esc(title)} <span class="xc-n">${list.length}</span></h2><p class="xc-note">${esc(note)}</p><ul class="xc-list">${list.map((p, i) => row(p, i === 0)).join('')}</ul></section>`;
    }).join('');
    return `<div class="ex-wrap xc">${kit.head({ title: 'Compute prices', sub: `What an hour of a computer or a GPU costs at each provider, checked ${ago(checked_at, now)}.` })}`
        + `<nav class="xc-jump" aria-label="Kinds"><a href="#gpu">${glyph('chip')}GPUs</a><a href="#cpu">${glyph('server')}Computers</a><a href="https://openvibe.compare/compute">${glyph('scale')}Compare them on OpenVibe.Compare</a></nav>`
        + (stale ? '<p class="xc-stale" role="status">Some of these prices are past their review date: check the provider before you rely on one.</p>' : '')
        + groups
        + `<p class="xc-foot">Base compute only: storage, network and plan fees may apply, and offers are per account. The same list is <a href="/api/compute/prices">GET /api/compute/prices</a> (JSON, open to anyone). <a href="/">Model prices</a></p></div>`;
}
/** /pricing: the page, with its head (it had no h1). */
function pricingPage() {
    return `<div class="ex-wrap xp">${kit.head({ title: 'Pricing', sub: 'What a call costs, before you make it.' })}<section class="xpr">${pricingRows()}</section></div>`;
}
/** A model's name as a person reads it: a raw id ("qwen/qwen4-max") becomes "Qwen4 Max"; a real name is kept. */
const UPPER = new Set(['gpt', 'oss', 'glm', 'ai', 'vl', 'tts', 'asr', 'llm', 'xl']);
function readable(name) {
    const n = String(name || '');
    if (!/^[a-z0-9._-]+\/[a-z0-9._:-]+$/.test(n)) return n;
    return n.split('/').pop().replace(/[-_]+/g, ' ').split(' ').filter(Boolean)
        .map((w) => (UPPER.has(w) ? w.toUpperCase() : /^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}
/** New this week (plan §AB.37): each model first seen in the last seven days, its maker and the day, to its page. */
function freshSection(fresh) {
    const rows = (Array.isArray(fresh) ? fresh : []).filter((m) => m && m.id && m.name);
    if (!rows.length) return '';
    const PROVIDERS = { gemini: 'Google', openai: 'OpenAI', anthropic: 'Anthropic', openrouter: 'OpenRouter', arena: 'LMArena', deepseek: 'DeepSeek', mistral: 'Mistral', xai: 'xAI', meta: 'Meta' };
    const day = (t) => { const d = Date.parse(t || ''); return Number.isFinite(d) ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''; };
    const iso = (t) => { const d = Date.parse(t || ''); return Number.isFinite(d) ? new Date(d).toISOString() : ''; };
    const list = kit.list(rows.map((m) => kit.row({ href: `/models/${encodeURIComponent(m.id)}`, title: readable(m.name),
        mark: `<span class="xh-new-ic${m.status === 'spotted' ? ' is-spotted' : ''}" aria-hidden="true">${glyph(m.status === 'spotted' ? 'eye' : 'spark')}</span>`,
        badge: m.status === 'spotted' ? ` ${kit.badge('Spotted')}` : '',
        meta: day(m.first_seen_at), metaIso: iso(m.first_seen_at),
        sub: [PROVIDERS[m.provider] || m.provider, m.status === 'spotted' ? 'not on sale yet' : 'on sale'].filter(Boolean).join(' · ') })));
    return homeSection('New this week', list, { href: '/models?status=spotted', label: 'Every model spotted' });
}
/**
 * The home (the owner, 11-16, /ov-gui-polish on a phone): the promise, one line to find a model, a key and the docs, the
 * call itself in a card with its copy button in its own bar; the real counts (ready to call, tracked, providers, the
 * week's tokens, the median reply); the popular models full width with only the numbers that were measured; what is
 * new; why; what it costs; questions. Sections are headings with a "more" link, never a card around cards.
 */
const compact = (n) => {
    const v = Number(n) || 0;
    if (v >= 1e9) return `${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)}B`;
    if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e8 ? 0 : 1)}M`;
    if (v >= 1e4) return `${Math.round(v / 1e3)}K`;
    return v.toLocaleString('en-US');
};
const slug = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function homeSection(title, body, more = null) {
    const idOf = `xh-${slug(title)}`;
    const link = more ? `<a class="xh-more" href="${esc(more.href)}">${esc(more.label)}<span aria-hidden="true">${glyph('arrow-right')}</span></a>` : '';
    return `<section class="xh-sec" aria-labelledby="${idOf}" data-ov-reveal><header class="xh-sec-h"><h2 id="${idOf}">${esc(title)}</h2>${link}</header>${body}</section>`;
}
// The copy button is the bar's own (kit.js copies any [data-ovk-copy]; it shows once copying works), centred in the bar.
const codeCard = () => `<div class="xh-code"><div class="xh-code-h"><span class="xh-code-ic" aria-hidden="true">${glyph('code')}</span><span class="xh-code-t">Call any model</span><code>openvibe/auto</code>`
    + `<button type="button" class="xh-copy" data-ovk-copy="#platform-curl" aria-label="Copy the call" title="Copy" hidden>${glyph('copy')}</button></div>${code()}</div>`;
function home({ catalog, usage, viewer, fresh = [], directory = null }) {
    const models = listed(catalog);
    const tracked = Array.isArray(directory?.models) ? directory.models : [];
    const providers = new Set(tracked.map((m) => m.provider).filter(Boolean)).size;
    const tokens = usage?.totals ? Number(usage.totals.tokens_in || 0) + Number(usage.totals.tokens_out || 0) : null;
    const keyHref = viewer?.kind === 'user' ? '/dashboard/keys#new' : '/auth/login?next=%2Fdashboard%2Fkeys%23new';
    const popular = [...models].sort((a, b) => (b.requests_7d || 0) - (a.requests_7d || 0)).slice(0, 6);
    const count = (v) => (typeof v === 'number' ? `<b data-ov-ticker="${v}">${v.toLocaleString('en-US')}</b>` : `<b>${esc(v)}</b>`);
    const stat = ([v, label, icon, href]) => (v == null || v === 0 || v === '' ? '' : `<li>${href ? `<a href="${href}">` : '<span>'}<span class="xh-st-ic" aria-hidden="true">${glyph(icon)}</span><span class="xh-st-t">${count(v)}<small>${esc(label)}</small></span>${href ? '</a>' : '</span>'}</li>`);
    // A figure nobody has measured is left out, never shown as "Not measured".
    const numbers = `<ul class="xh-stats" aria-label="Exchange in numbers" data-ov-reveal>${[
        [models.length || null, 'ready to call', 'check', '/models'],
        [tracked.length || null, providers ? `tracked · ${providers} providers` : 'models tracked', 'layers', '/models#directory-more'],
        [tokens ? compact(tokens) : null, 'tokens this week', 'chart', null],
        [catalog.median_reply_ms == null ? null : metric(catalog.median_reply_ms, ' ms'), 'median reply', 'clock', '/status'],
    ].map(stat).join('')}</ul>`;
    const suggest = [...new Set([...popular.map((m) => m.name), ...models.map((m) => legacy.familyLabel(m))].filter(Boolean))];
    return `<div class="ex-wrap xp xh">${unavailable(catalog)}`
        + `<section class="xp-hero"><div class="xh-hero-main"><h1>One API for every model.<br>Pay what the model costs.</h1>${modelSearch({}, false, suggest)}`
        + `<p class="xh-cta">${kit.button({ href: keyHref, label: 'Get a key', icon: 'key' })}${kit.button({ href: '/docs', label: 'Read the docs', kind: 'quiet', icon: 'book' })}</p></div>`
        + `${codeCard()}</section>`
        + numbers
        + homeSection('Popular models', table(popular), models.length > popular.length ? { href: '/models', label: `All ${models.length}` } : null)
        + freshSection(fresh)
        + reasons()
        + homeSection('Pricing', pricingRows(), { href: '/pricing', label: 'Pricing' })
        + homeSection('Questions', `<div class="xp-faq">${QUESTIONS.map(question).join('')}</div>`)
        + '</div>';
}
function modelsPage({ catalog, query = {}, searchResults = null }) {
    const all = listed(catalog);
    let rows = all;
    if (query.family && !query.maker) query = { ...query, maker: query.family };
    const tests = {
        maker: (m, v) => m.family === v,
        weights: (m) => m.open_weights === true,
        price: (m, v) =>
            v === 'free'
                ? best(m).price?.in === 0 && best(m).price?.out === 0
                : best(m).price && best(m).price.in + best(m).price.out <= 2,
        context: (m) => m.context >= 128000,
        uncensored: (m) => m.uncensored,
        gpu: (m) => (m.offers || []).some((o) => o.on_our_gpus === true),
    };
    const chip = (label, key, value, count) => {
        const q = new URLSearchParams(
            Object.entries(query).filter(([, v]) => typeof v === 'string'),
        );
        if (q.get(key) === value) q.delete(key);
        else q.set(key, value);
        if (!count && query[key] !== value) return `<span class="ex-chip is-empty" aria-disabled="true">${esc(label)} <span>0</span></span>`;
        return `<a class="ex-chip ${query[key] === value ? 'is-on' : ''}" href="/models?${esc(q.toString())}"${query[key] === value ? ' aria-current="true"' : ''}>${esc(label)} <span>${count}</span></a>`;
    };
    for (const [key, test] of Object.entries(tests))
        if (query[key]) rows = rows.filter((m) => test(m, query[key]));
    if (query.q)
        rows = rows.filter((m) =>
            `${m.name} ${id(m)} ${m.family}`
                .toLowerCase()
                .includes(String(query.q).toLowerCase()),
        );
    if (searchResults) {
        const byId = new Map(all.map((m) => [id(m), m]));
        rows = searchResults.map((r) => byId.get(r.model)).filter(Boolean);
    }
    const chips = [...new Set(all.map((m) => m.family).filter(Boolean))].map(
        (v) => chip(v, 'maker', v, all.filter((m) => tests.maker(m, v)).length),
    );
    for (const [key, label, value] of [
        ['weights', 'Open weights', 'open'],
        ['price', 'Free', 'free'],
        ['price', 'Under $1/M blended', 'low'],
        ['context', '128K+ context', '128k'],
        ['uncensored', 'Uncensored 18+', '1'],
        ['gpu', 'On our GPUs', '1'],
    ])
        chips.push(
            chip(
                label,
                key,
                value,
                all.filter((m) => tests[key](m, value)).length,
            ),
        );
    for (const [key, label, value] of [['capability', 'Vision', 'vision'], ['capability', 'Tools', 'tools'], ['max_price', 'Under $1/M out', '1'], ['max_speed_ms', 'Under 500 ms', '500']]) {
        const params = new URLSearchParams(Object.entries(query).filter(([, v]) => typeof v === 'string'));
        if (params.get(key) === value) params.delete(key); else params.set(key, value);
        chips.push(`<a class="ex-chip ${query[key] === value ? 'is-on' : ''}" href="/models?${esc(params.toString())}"${query[key] === value ? ' aria-current="true"' : ''}>${label}</a>`);
    }
    const searchMeta = searchResults && new Map(searchResults.map((r) => [r.model, r]));
    const filters = modelSearch(query, true);
    // Filters that match nothing go last (still there, still saying 0), so the row starts with what narrows.
    const ordered = [...chips.filter((c) => !c.includes('is-empty')), ...chips.filter((c) => c.includes('is-empty'))];
    const sub = rows.length ? `${rows.length} to call now · live prices, measured speed` : 'None to call now match · the registry is below';
    return `<div class="ex-wrap xp xm-page">${kit.head({ title: 'Models', sub })}${unavailable(catalog)}<div class="xm-find">${filters}<nav class="ex-chips" aria-label="Model filters">${ordered.join('')}</nav></div>${table(rows, searchMeta)}<p class="ex-more"><a href="https://openvibe.compare/">Compare models side by side on OpenVibe.Compare ${glyphs.svg('arrow-right', { size: 16 })}</a></p></div>`;
}
module.exports = { computePage, home, modelsPage, pricing, pricingPage, table };
