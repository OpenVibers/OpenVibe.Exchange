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
    `https://openvibe.compare/things/${encodeURIComponent(id(m))}`;
const section = (title, body) => kit.section({ title, body });
const modelSearch = (query = {}, filters = false) => {
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
        options, attrs: { 'data-ovc-no-draft': '', style: '--ovt-line:var(--border,#1f2d47);--ovt-accent:var(--accent,#3b82f6)' },
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
        const fact = (label, value) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
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
    ['key', '0% fee on your own key', "Bring your provider key and pay the provider's price, nothing more. No cap, no end date.", '/dashboard/keys', 'Add a key'],
    ['route', 'The cheapest route', "Every call goes to the cheapest provider that is up. Open models on OpenVibe's own GPUs, at a fixed price per million tokens, are coming next.", '/compute', 'Compute prices'],
    ['shield', 'Uncensored, 18+', 'Uncensored models for adults who opt in. The content floor applies on every request.', '/uncensored', 'What the floor covers'],
];
function reasons() {
    return `<section class="xp-features" aria-label="Why OpenVibe.Exchange">${REASONS.map(([icon, title, text, href, label]) =>
        `<article class="xp-feature"><span class="xp-feature-ic" aria-hidden="true">${glyph(icon)}</span><h3>${esc(title)}</h3><p>${esc(text)}</p><a class="xp-feature-a" href="${href}">${esc(label)}<span aria-hidden="true">${glyph('arrow-right')}</span></a></article>`).join('')}</section>`;
}
const QUESTIONS = [
    ['code', 'Can I use my existing client?', 'Yes. Point any OpenAI-compatible client at the Exchange endpoint with your Exchange key; Anthropic-style clients work through /v1/messages.', '/docs', 'Read the docs'],
    ['chat', 'Where can I talk to a model?', 'In Vibe on OpenVibe.Chat: talk to any model here, or two side by side.', 'https://openvibe.chat/vibe', 'Open Vibe'],
    ['chart', 'Where do the numbers come from?', 'Prices come from the live catalogue. Speed and reliability come from measured requests. A number nobody has measured stays unknown, never guessed.', '/status', 'See the status'],
];
function questions() {
    return section('Questions', `<div class="xp-faq">${QUESTIONS.map(([icon, q, a, href, label]) =>
        `<details class="xp-q"><summary><span class="xp-q-ic" aria-hidden="true">${glyph(icon)}</span><span class="xp-q-t">${esc(q)}</span><span class="xp-q-chev" aria-hidden="true">${glyph('chevron')}</span></summary><div class="xp-q-a"><p>${esc(a)}</p><a href="${href}">${esc(label)}</a></div></details>`).join('')}</div>`);
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
function home({ catalog, usage, viewer }) {
    const models = listed(catalog);
    return `<div class="ex-wrap xp">${unavailable(catalog)}<section class="xp-hero"><h1>One API for every model.<br>Pay what the model costs.</h1>${modelSearch()}<p>${kit.button({ href: viewer?.kind === 'user' ? '/dashboard/keys#new' : '/auth/login?next=%2Fdashboard%2Fkeys%23new', label: 'Get a key' })} ${kit.button({ href: '/docs', label: 'Read the docs', kind: 'quiet' })} ${kit.button({ href: '/compute', label: 'Compute prices', kind: 'quiet' })}</p>${code()}</section>${kit.stats(
        [
            [models.length, 'models'],
            [
                metric(
                    usage?.totals
                        ? Number(usage.totals.tokens_in || 0) +
                              Number(usage.totals.tokens_out || 0)
                        : null,
                ),
                'tokens routed this week',
            ],
            [
                metric(catalog.median_ttft_ms, ' ms'),
                'median time to first token',
            ],
        ],
    )}${section('Popular models', table([...models].sort((a, b) => (b.requests_7d || 0) - (a.requests_7d || 0)).slice(0, 10)))}${reasons()}${pricing()}${questions()}</div>`;
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
