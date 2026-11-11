'use strict';
const kit = require('openvibe-shared/kit');
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
function table(models) {
    if (!models.length) return '<p class="xm-empty">No models match these filters.</p>';
    return `<ul class="xm-list">${models.map((m) => {
        const o = best(m);
        const badges = [
            (m.offers || []).some(free) ? kit.badge('Free to try') : (m.offers || []).some(paused) ? kit.badge('Free paused') : '',
            m.uncensored ? kit.badge('18+', 'bad') : '',
            o.fixed_price ? kit.badge('Fixed price') : '',
        ].filter(Boolean).join(' ');
        const fact = (label, value) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
        return `<li class="xm-row"><div class="xm-name"><a href="/models/${encodeURIComponent(id(m))}">${esc(m.name)}</a><span class="xm-maker">${esc(legacy.familyLabel(m))}</span>${badges ? `<span class="xm-badges">${badges}</span>` : ''}</div>`
            + `<dl class="xm-facts">${fact('In / out per M', `${perM(o.price?.in)} / ${perM(o.price?.out)}`)}${fact('Uptime', o.uptime == null ? '–' : `${dash(o.uptime * 100)}%`)}${fact('Speed', o.speed?.tokens_per_second == null ? '–' : `${dash(o.speed.tokens_per_second)} tok/s`)}</dl>`
            + `<p class="xm-acts">${kit.button({ href: chat(m), label: 'Try in Chat', kind: 'quiet', small: true })} ${kit.button({ href: rank(m), label: 'How it ranks', kind: 'quiet', small: true })}</p></li>`;
    }).join('')}</ul>`;
}
// What each way of calling costs, in the reader's words (home's Pricing section and /pricing). Opus, 11-09.
const PRICING = [
    ['Your own provider key', "The provider's price. OpenVibe adds 0%, with no cap and no end date."],
    ['Managed models', 'The input and output price per million tokens shown on each model, before you call.'],
    ["Open models on OpenVibe's GPUs", 'A fixed price per million tokens, the same on every call. Coming next.'],
    ['Your own endpoint', 'An hourly price, quoted before it starts; it stops when idle.'],
    ['Search', "Each engine's price per 1,000 searches; the free engines first."],
];
const pricingRows = () => `<ul class="xpr-list">${PRICING.map(([name, what]) => `<li><strong>${esc(name)}</strong><span>${esc(what)}</span></li>`).join('')}</ul>`
    + '<p class="xpr-note">Paid models open soon. Every price shows before you call, and nothing is charged until then.</p>';
function pricing() {
    return section('Pricing', pricingRows());
}
/** /pricing: the page, with its head (it had no h1). */
function pricingPage() {
    return `<div class="ex-wrap xp">${kit.head({ title: 'Pricing', sub: 'What a call costs, before you make it.' })}<section class="xpr">${pricingRows()}</section></div>`;
}
function home({ catalog, usage, viewer }) {
    const models = listed(catalog);
    return `<div class="ex-wrap xp">${unavailable(catalog)}<section class="xp-hero"><h1>One API for every model.<br>Pay what the model costs.</h1>${kit.find({ action: '/models', name: 'q', placeholder: 'Find a model', icon: 'search' })}<p>${kit.button({ href: viewer?.kind === 'user' ? '/dashboard/keys#new' : '/auth/login?next=%2Fdashboard%2Fkeys%23new', label: 'Get a key' })} ${kit.button({ href: '/docs', label: 'Read the docs', kind: 'quiet' })}</p>${code()}</section>${kit.stats(
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
    )}${section('Popular models', table([...models].sort((a, b) => (b.requests_7d || 0) - (a.requests_7d || 0)).slice(0, 10)))}<div class="xp-reasons">${section('0% fee on your own key', '<p>Bring your provider key and pay the provider\'s price, nothing more. No cap, no end date.</p>')}${section('The cheapest route', '<p>Every call goes to the cheapest provider that is up. Open models on OpenVibe\'s own GPUs, at a fixed price per million tokens, are coming next.</p>')}${section('Uncensored, 18+', '<p>Uncensored models for adults who opt in. The content floor applies on every request.</p><a href="/uncensored">What the floor covers</a>')}</div>${pricing()}${section('Questions', '<details><summary>Can I use my existing client?</summary><p>Yes. Use the OpenAI-compatible endpoint with your Exchange key.</p></details><details><summary>Where can I talk to a model?</summary><p><a href="https://openvibe.chat/vibe">Open Chat</a> to talk or compare models.</p></details><details><summary>Where do the numbers come from?</summary><p>Prices come from the live catalogue. Speed and reliability come from measured requests. Missing measurements stay unknown.</p></details>')}</div>`;
}
function modelsPage({ catalog, query = {} }) {
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
        if (!count && query[key] !== value) return `<span class="ex-chip is-empty" aria-disabled="true">${esc(label)} (0)</span>`;
        return `<a class="ex-chip ${query[key] === value ? 'is-on' : ''}" href="/models?${esc(q.toString())}">${esc(label)} (${count})</a>`;
    };
    for (const [key, test] of Object.entries(tests))
        if (query[key]) rows = rows.filter((m) => test(m, query[key]));
    if (query.q)
        rows = rows.filter((m) =>
            `${m.name} ${id(m)} ${m.family}`
                .toLowerCase()
                .includes(String(query.q).toLowerCase()),
        );
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
    return `<div class="ex-wrap xp">${kit.head({ title: 'Models', sub: `${rows.length} models · live prices and measured performance` })}${unavailable(catalog)}${kit.find({ action: '/models', name: 'q', value: query.q || '', placeholder: 'Find a model', icon: 'search' })}<nav class="ex-chips" aria-label="Model filters">${chips.join('')}</nav>${table(rows)}<p class="ex-more"><a href="https://openvibe.compare/">Compare models side by side on OpenVibe.Compare →</a></p></div>`;
}
module.exports = { home, modelsPage, pricing, pricingPage, table };
