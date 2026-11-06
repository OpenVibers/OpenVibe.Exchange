'use strict';

/**
 * The Exchange pages, built from openvibe-shared/kit: the home with live numbers, the model list and a model's
 * page (every offer, the presets, the Try box, curl and the SDK), the API page, selling compute, the uncensored
 * tier, AI in OpenVibe and the status board. Every number comes from the AI read API (server/ai.js); when that
 * read is unavailable the page says so and shows no invented figure.
 */
const kit = require('openvibe-shared/kit');
const { esc } = require('../render/html');
const { mark, product, productMark } = require('./marks');

const ENDPOINT = 'https://api.openvibe.exchange/v1/chat/completions';

const money = (n, free = false) => (free ? 'free' : n == null ? '–' : n === 0 ? '$0' : `$${Number(n) < 0.1 ? Number(n).toPrecision(2) : Number(n).toFixed(2)}`);
const inOut = (price) => (price ? `${money(price.in)} in · ${money(price.out)} out` : 'no per-token price');
const ms = (n) => (n == null ? '–' : n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`);
const pct = (n) => (n == null ? '–' : `${(n * 100).toFixed(1)}%`);
const count = (n) => (n == null ? '–' : Number(n).toLocaleString('en-US'));
const blended = (price) => (price ? (Number(price.in) + Number(price.out)) / 2 : Number.POSITIVE_INFINITY);
const cheapest = (m) => (m.offers || []).filter((o) => o.price).sort((a, b) => blended(a.price) - blended(b.price))[0] || null;
const hrefOf = (m) => `/m/${String(m.slug).split('/').map(encodeURIComponent).join('/')}`;
const providerCount = (models) => new Set(models.flatMap((m) => (m.offers || []).map((o) => o.provider))).size;
const offerCount = (models) => models.reduce((n, m) => n + (m.offers || []).length, 0);

/**
 * Only chat and vision models are sold here, and the read API's kind (when it sends one) is the truth; the
 * older type field is the fallback until every deployment carries kind.
 */
const kindOf = (m) => String((m.kind || m.type || 'chat')).toLowerCase();
const NOT_CHAT = new Set(['embedding', 'embeddings', 'stt', 'asr', 'tts', 'speech', 'image', 'images', 'rerank', 'moderation']);
const isChat = (m) => !NOT_CHAT.has(kindOf(m));
const chatModels = (catalog) => (catalog.models || []).filter(isChat);

/**
 * A provider's internal label ("Shared provider (Live's shared key)", "Local model (OpenAI-compatible server
 * on this host)") is an operations name, not something to print. It is shown as what it is in public: OpenVibe's
 * own capacity. Community capacity is a person's machine, said as that.
 */
const INTERNAL = /provider|shared key|openai-compatible|local model|speech-to-text|whisper\.cpp|^local$|^shared$/i;
function providerLabel(offer) {
    if (!offer) return '';
    const name = String(offer.provider_name || offer.provider || '');
    if (INTERNAL.test(name) || INTERNAL.test(String(offer.provider || ''))) return offer.trust === 'community' ? 'A community machine' : 'OpenVibe';
    return name;
}

function familyLabel(m) {
    const name = String((m && m.family) || '');
    return !name || INTERNAL.test(name) || name.length > 24 ? 'Other' : name;
}

/** The model families on sale now, most requested first ("GPT", "DeepSeek"); internal and unnamed ones are left out. */
function familiesOnSale(models) {
    const out = [];
    for (const m of [...models].sort((a, b) => (b.requests_7d || 0) - (a.requests_7d || 0))) {
        const f = familyLabel(m);
        if (f !== 'Other' && !out.includes(f)) out.push(f);
    }
    return out;
}

/** "A", "A and B", "A, B and C". */
function listSaid(xs) {
    return xs.length <= 1 ? (xs[0] || '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

/**
 * The privacy label the design asks for, from facts only: a community machine sees the prompt; zero retention
 * and no training is Private; no training alone is said as that. "Anonymized" is never claimed, because no
 * offer here anonymises the request.
 */
function privacyOf(offer) {
    if (!offer) return null;
    if (offer.trust === 'community') return { label: 'Community', kind: 'accent', short: 'Community' };
    const p = offer.data_policy;
    if (p && p.anonymized === true) return { label: 'Anonymized', kind: 'accent', short: 'Anonymized' };
    if (p && p.trains === false && p.retention_days === 0) return { label: 'Private', kind: 'ok', short: 'Private' };
    if (p && p.trains === false) return { label: 'No training', kind: 'ok', short: 'No training' };
    return { label: 'Standard', kind: '', short: 'Standard' };
}

const freeTier = (o) => Boolean(o && o.free_tier === true);

function badgesOf(m, best) {
    const out = [
        m.uncensored ? kit.badge('18+', 'bad') : '',
        m.community ? kit.badge('Community', 'accent') : '',
        (m.offers || []).some(freeTier) ? kit.badge('Free to try') : '',
        m.capabilities && m.capabilities.tools ? kit.badge('Tools') : '',
    ];
    const p = privacyOf(best);
    if (p && p.label === 'Private') out.push(kit.badge('Private', 'ok'));
    return out.join('');
}

function unavailable(catalog, what = 'The live catalog') {
    if (!catalog.unavailable && !catalog.stale) return '';
    return kit.notice({ kind: 'warn', text: `${what} is not reachable right now. Prices and speeds are read live from OpenVibe.AI; reload in a moment.` });
}

/** A card: one section, in the page's one column, with its links inside its padding. */
function panel({ title, note = '', id, body, cls = '' }) {
    // kit.section is already the card: do not wrap it in another one, and keep its body on the heading's line.
    return kit.section({ title, note, id, cls: `ex-card${cls ? ` ${cls}` : ''}`, body: `<div class="ex-sec-body">${body}</div>` });
}

/** One model row: family mark, name and badges, the cheapest offer's price, speed and uptime, and Try it. */
function modelRow(m, { withTry = true } = {}) {
    const best = cheapest(m);
    const bits = [];
    if (best) bits.push(providerLabel(best), inOut(best.price), ms(best.speed.p50_ms), pct(best.uptime));
    else if (m.offers[0]) bits.push(providerLabel(m.offers[0]), 'free capacity');
    if (best && best.refusal_rate != null) bits.push(`refuses ${pct(best.refusal_rate)}`);
    const pv = privacyOf(best || m.offers[0]);
    if (pv) bits.push(pv.short);
    return `<li class="ex-mrow">
<a class="ex-mrow-main" href="${hrefOf(m)}">${mark(familyLabel(m))}<span class="ex-mrow-text"><span class="ex-mrow-title"><b>${esc(m.name)}</b>${badgesOf(m, best)}</span><small>${bits.map((b) => esc(b)).join(' · ')}</small></span></a>
${withTry ? `<a class="ex-try-link" href="${hrefOf(m)}#try">Try it</a>` : ''}
</li>`;
}

function modelList(models, { empty = 'No model matches yet.', withTry = true } = {}) {
    if (!models.length) return kit.empty({ icon: 'spark', title: 'Nothing here yet', text: empty });
    return `<ul class="ex-mlist">${models.map((m) => modelRow(m, { withTry })).join('')}</ul>`;
}

// ── Home ───────────────────────────────────────────────────
function home({ catalog, usage, viewer, q = '', config = null }) {
    const models = chatModels(catalog);
    const paid = models.map((m) => ({ m, o: cheapest(m) })).filter((x) => x.o).sort((a, b) => blended(a.o.price) - blended(b.o.price));
    const popular = [...models].sort((a, b) => (b.requests_7d || 0) - (a.requests_7d || 0)).slice(0, 8);
    const bestPrice = paid[0] && paid[0].o;
    // The hero names only the families on sale now, most requested first: never one no provider sells yet.
    const families = familiesOnSale(models);
    const preview = (paid.length >= 2 ? paid.slice(0, 2) : models.slice(0, 2).map((m) => ({ m, o: cheapest(m) })));

    const stats = [];
    if (models.length) stats.push([models.length, 'models']);
    if (providerCount(models)) stats.push([providerCount(models), 'providers']);
    if (bestPrice) stats.push([money(bestPrice.price.in), 'cheapest in, per million']);
    if (config) stats.push([config.chat.perDay, 'messages free every day']);
    if (usage.today && usage.today.requests >= 1000) stats.push([count(usage.today.requests), 'requests today']);

    return `<div class="ex-wrap ex-home">
<section class="ex-hero">
<div class="ex-hero-copy">
<p class="ex-kicker">OpenVibe.Exchange</p>
<h1>Every AI model, one account.</h1>
<p class="ex-lead">${families.length ? `${esc(listSaid(families.slice(0, 6)))} now, more as their providers join: the` : 'The'} live price, speed and uptime of every offer, one OpenAI-compatible endpoint, and a chat that puts two or three models side by side.</p>
${kit.find({ action: '/models', name: 'q', placeholder: families.length ? `Find a model: ${families.slice(0, 3).join(', ')}…` : 'Find a model or a provider', value: q, icon: 'search' })}
<p class="ex-hero-actions">${kit.button({ href: '/models', label: 'All models' })} ${kit.button({ href: '/chat', label: 'Open chat', kind: 'quiet' })} ${kit.button({ href: '/api', label: 'The API', kind: 'ghost' })}</p>
</div>
${preview.length === 2 ? previewCard(preview) : ''}
</section>
${unavailable(catalog)}
${stats.length ? kit.stats(stats) : ''}
${panel({
        title: 'Popular now', note: 'By real requests in the last seven days.', id: 'popular',
        body: `${modelList(popular, { empty: 'No requests yet. The first one will show up here.', withTry: true })}
${models.length ? `<p class="ex-more"><a href="/models">All ${models.length} models →</a></p>` : ''}`,
    })}
<div class="ex-lines">
${lineCard({ href: '/uncensored', name: 'Uncensored (18+)', text: 'Abliterated models for adults, with the floor that holds on every request.', mark: mark('Llama') })}
${lineCard({ href: '/sell', name: 'Run on people’s machines', text: 'Community GPUs through OpenVibe Node, labelled on every answer.', mark: mark('Qwen') })}
${lineCard({ href: '/api', name: 'Bring your own key, 0% fee', text: 'Your provider key pays the provider directly; the router never adds a fee on it.', mark: mark('GLM') })}
</div>
${panel({
        title: 'Use it from code', note: 'One endpoint, compatible with OpenAI and with Anthropic.', id: 'code', body: `
<p class="ex-prose">Point an OpenAI client at <code>https://api.openvibe.exchange/v1</code>, or Claude Code at its <code>/v1/messages</code>. Model ids are <code>deepseek/deepseek-chat</code>, or <code>openvibe/auto</code> to let the router pick by your floor, ceiling and policy.</p>
${kit.snippet({ code: `curl ${ENDPOINT} \\\n  -H "Authorization: Bearer $OPENVIBE_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"deepseek/deepseek-chat","messages":[{"role":"user","content":"Hello"}]}'`, id: 'home-curl' })}
<p class="ex-more"><a href="/api">Keys, usage and the full reference →</a></p>`,
    })}
${panel({
        title: 'AI in OpenVibe', note: 'Which products run which models, and what each costs a day.', id: 'products',
        body: productsSummary(usage),
    })}
</div>`;
}

/** The hero's side-by-side chat preview: real models and prices, example words, said as an example. */
function previewCard(preview) {
    // Two models of one family would say the same example words; the second takes another wording, so the preview
    // never shows two identical answers.
    const said = [];
    const answerFor = (m) => {
        let text = EXAMPLE_ANSWER[familyLabel(m)] || EXAMPLE_ANSWER.Default;
        if (said.includes(text)) text = Object.values(EXAMPLE_ANSWER).find((t) => !said.includes(t)) || text;
        said.push(text);
        return text;
    };
    const cells = preview.map(({ m, o }) => `<article class="ex-preview-cell">
<header>${mark(familyLabel(m), { size: 22, label: false })}<b>${esc(m.name)}</b></header>
<p>${esc(answerFor(m))}</p>
<footer>${o ? `${money(o.price.in)} in · ${money(o.price.out)} out · ${ms(o.speed.p50_ms)}` : 'free capacity'}</footer>
</article>`).join('');
    return `<aside class="ex-preview" aria-label="A preview of the side-by-side chat">
<p class="ex-preview-tag">A side-by-side answer <span>example words · live prices</span></p>
<p class="ex-preview-q">“Summarize this contract in three bullets.”</p>
<div class="ex-preview-grid">${cells}</div>
<p class="ex-more"><a href="/chat">Open the real chat →</a></p>
</aside>`;
}

const EXAMPLE_ANSWER = {
    DeepSeek: 'Three bullets: the term renews yearly, either side may exit with 30 days’ notice, and liability is capped at the fees paid.',
    Qwen: '• Renews yearly\n• 30 days’ notice to exit\n• Liability capped at fees paid',
    Kimi: 'It runs a year at a time, needs 30 days’ notice to end, and caps liability at what was paid.',
    GLM: 'Three points: a yearly term, a 30-day exit notice, and liability limited to the fees.',
    MiniMax: 'The term is yearly; notice to end is 30 days; liability stops at the fees paid.',
    Llama: 'Renews yearly. Exit needs 30 days’ notice. Liability is capped at the fees paid.',
    Default: 'The term renews yearly, either side may exit with 30 days’ notice, and liability is capped at the fees paid.',
};

function lineCard({ href, name, text, mark: markHtml }) {
    return `<a class="ex-line" href="${href}">${markHtml}<span><b>${esc(name)}</b><small>${esc(text)}</small></span><span class="ex-line-go" aria-hidden="true">→</span></a>`;
}

function productsSummary(usage) {
    const products = usage.by_product || [];
    if (usage.unavailable) return kit.notice({ kind: 'info', text: 'Product usage is read from OpenVibe.AI and is not available right now.' });
    if (!products.length) return kit.empty({ icon: 'code', title: 'No product has run a model yet', text: 'When one does, its models and daily cost show here and on <a href="/ai">AI in OpenVibe</a>.' });
    const rows = products.slice(0, 5).map((p) => {
        const prod = product(p.product);
        const top = (p.models || []).slice(0, 2).map((m) => m.model || m.provider).filter(Boolean).join(', ');
        return `<li class="ex-product-row"><a href="/ai">${productMark(p.product, { size: 28 })}<span><b>${esc(prod.name)}</b><small>${top ? `runs ${esc(top)}` : 'runs models through OpenVibe.AI'}</small></span><span class="ex-trail"><b>${count(p.requests)}</b><small>requests</small></span></a></li>`;
    }).join('');
    return `<ul class="ex-product-list">${rows}</ul>`;
}

// ── Models ─────────────────────────────────────────────────
function modelsPage({ catalog, q = '', family = '', sort = '' }) {
    let models = chatModels(catalog);
    const families = [...new Set(models.map(familyLabel))].filter((f) => f !== 'Other').sort();
    if (family) models = models.filter((m) => familyLabel(m) === family);
    if (q) {
        const needle = String(q).toLowerCase();
        models = models.filter((m) => `${m.name} ${familyLabel(m)} ${m.slug} ${m.offers.map(providerLabel).join(' ')}`.toLowerCase().includes(needle));
    }
    if (sort === 'cheap') models = [...models].sort((a, b) => blended((cheapest(a) || { price: null }).price) - blended((cheapest(b) || { price: null }).price));
    else if (sort === 'fast') models = [...models].sort((a, b) => (cheapest(a) ? cheapest(a).speed.p50_ms || 1e9 : 1e9) - (cheapest(b) ? cheapest(b).speed.p50_ms || 1e9 : 1e9));
    else models = [...models].sort((a, b) => (b.requests_7d || 0) - (a.requests_7d || 0));

    const links = [['All', '/models'], ['Cheapest', '/models?sort=cheap'], ['Fastest', '/models?sort=fast']].map(([label, href]) => `<a class="ex-chip${(sort === 'cheap' && href.includes('cheap')) || (sort === 'fast' && href.includes('fast')) || (!sort && href === '/models') ? ' is-on' : ''}" href="${href}">${label}</a>`).join('');
    const familyLinks = families.slice(0, 10).map((f) => `<a class="ex-chip${f === family ? ' is-on' : ''}" href="/models?family=${encodeURIComponent(f)}">${esc(f)}</a>`).join('');

    return `<div class="ex-wrap ex-page">
${kit.head({ title: 'Models', sub: `${models.length} model${models.length === 1 ? '' : 's'} · ${offerCount(models)} offers, live`, actions: [kit.button({ href: '/chat', label: 'Chat', icon: 'chat', kind: 'quiet' })] })}
${kit.find({ action: '/models', name: 'q', placeholder: 'Find a model or a provider', value: q, icon: 'search' })}
<div class="ex-chips" role="group" aria-label="Sort">${links}</div>
${families.length ? `<div class="ex-chips" role="group" aria-label="Family">${familyLinks}</div>` : ''}
${unavailable(catalog)}
${panel({ title: '', body: modelList(models, { empty: 'No model matches that search. Try a family or a provider.' }) })}
<p class="ex-more"><a href="/status">Uptime and incidents →</a></p>
</div>`;
}

// ── One model ──────────────────────────────────────────────
function modelPage({ model, viewer, result = null, problem = null, text = '', adult = false }) {
    const offers = model.offers || [];
    const best = cheapest(model);
    const badges = [model.uncensored ? kit.badge('18+', 'bad') : '', model.community ? kit.badge('Community', 'accent') : '', offers.some(freeTier) ? kit.badge('Free to try') : ''].join('');
    const stats = [
        best ? [money(best.price.in), 'cheapest in, per M'] : null,
        best ? [money(best.price.out), 'cheapest out, per M'] : null,
        model.context ? [count(model.context), 'context, tokens'] : null,
        best ? [ms(best.speed.p50_ms), 'typical first answer'] : null,
        best ? [pct(best.uptime), 'uptime, 7 days'] : null,
    ].filter(Boolean);

    const columns = [
        { key: 'provider', label: 'Offer', primary: true, html: true },
        { key: 'price', label: 'In / out per M', html: true },
        { key: 'speed', label: 'Speed', html: true },
        { key: 'uptime', label: 'Uptime' },
        { key: 'privacy', label: 'Privacy', html: true },
        { key: 'policy', label: 'Data policy', html: true },
        { key: 'try', label: 'Try', html: true },
    ];
    const rows = offers.map((o) => {
        const p = privacyOf(o);
        return {
            provider: `<a class="ex-offer-name" href="#try">${esc(providerLabel(o))}</a>${o.trust === 'community' ? ` ${kit.badge('Community', 'accent')}` : ''}${freeTier(o) ? ` ${kit.badge('Free to try')}` : ''}`,
            price: o.price ? `<b>${money(o.price.in)}</b> / ${money(o.price.out)}` : '<span class="ex-muted">free capacity</span>',
            speed: `${ms(o.speed.p50_ms)} <small>p50</small> · ${ms(o.speed.p95_ms)} <small>p95</small>`,
            uptime: o.uptime == null ? '–' : pct(o.uptime),
            privacy: p ? `${kit.badge(p.label, p.kind)}${o.refusal_rate != null ? `<br><small>refuses ${pct(o.refusal_rate)}</small>` : ''}` : '–',
            policy: policyText(o.data_policy),
            try: '<a class="ex-mini" href="#try">Try it</a>',
        };
    });

    const bestOffer = offers.find((o) => o.id) || offers[0];
    const modelId = (bestOffer && bestOffer.id) || model.canonical;
    const code = `curl ${ENDPOINT} \\\n  -H "Authorization: Bearer $OPENVIBE_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"${modelId}","messages":[{"role":"user","content":"Hello"}]}'`;
    const sdk = `import OpenAI from 'openai';\nconst ai = new OpenAI({ baseURL: 'https://api.openvibe.exchange/v1', apiKey: process.env.OPENVIBE_KEY });\nconst r = await ai.chat.completions.create({ model: '${modelId}', messages: [{ role: 'user', content: 'Hello' }] });`;

    return `<div class="ex-wrap ex-page">
${kit.head({ title: model.name, sub: `${familyLabel(model)}${model.variant ? ` · ${model.variant}` : ''} · ${offers.length} offer${offers.length === 1 ? '' : 's'}`, back: { href: '/models', label: 'Models' }, actions: badges ? [badges] : [] })}
${stats.length ? kit.stats(stats) : ''}
${model.description ? `<p class="ex-prose">${esc(model.description)}</p>` : ''}
${panel({ title: 'Every offer that serves it', note: 'Price in, out and cached per million tokens; speed and uptime from the last seven days of real requests; the privacy label and the provider’s own data policy.', id: 'offers', body: kit.table({ columns, rows, label: `Offers for ${model.name}`, empty: 'No live offer serves this model right now.' }) })}
${panel({ title: 'Presets', note: 'A preset fixes the router’s floor, ceiling and policy, and you name it as the model.', id: 'presets', body: presetsBox() })}
${panel({ title: 'Try it', id: 'try', body: tryBox(model, viewer, { result, problem, text, adult }) })}
${panel({ title: 'Use it from code', id: 'code', body: `${kit.snippet({ code, id: 'model-curl' })}
${kit.snippet({ code: sdk, id: 'model-sdk' })}
<p class="ex-more">The endpoint, keys and usage: <a href="/api">the API</a>.</p>` })}
</div>`;
}

const PRESETS = [
    ['openvibe/economy', 'Cheapest', 'The lowest cost per successful answer.'],
    ['openvibe/fast', 'Fastest', 'The quickest measured offer.'],
    ['openvibe/private', 'Private', 'Only capacity OpenVibe runs or that sits on a local machine.'],
    ['openvibe/auto', 'Balanced', 'Cost, health and latency weighed together. The default.'],
];

function presetsBox() {
    const cards = PRESETS.map(([id, name, text]) => `<article class="ex-preset">
<header><b>${esc(name)}</b><code>model: "${esc(id)}"</code></header>
<p>${esc(text)}</p>
</article>`).join('');
    return `<div class="ex-presets">${cards}</div>
<p class="ex-prose">These four aliases work today. Saved presets (<code>model: "@preset/cheapest"</code>) add your own floor, ceiling, quantization, region, data policy and <code>max_price</code>; they arrive with the router’s presets.</p>`;
}

function tryBox(model, viewer, { result, problem, text, adult }) {
    const canTry = viewer && viewer.kind === 'user' && viewer.subject;
    const blocked = model.uncensored && !adult;
    if (blocked) {
        return kit.card({ tone: 'wait', icon: 'shield', title: 'This is an uncensored model', text: 'Adults only, with the floor. Confirm you are 18 or over to use it.', html: '<p><a class="ovk-btn ovk-btn--primary" href="/uncensored">Read the floor and confirm</a></p>' });
    }
    if (!canTry) {
        return `<div class="ex-signin">${kit.button({ href: `/auth/login?next=${encodeURIComponent(hrefOf(model))}`, label: 'Sign in to try it' })}<span class="ex-muted">Free daily allowance, no card.</span></div>`;
    }
    return `<form class="ovk-form ex-try" method="post" action="${hrefOf(model)}/try">
${problem ? kit.notice({ kind: 'error', text: problem }) : ''}
<label class="ex-label" for="try-text">Try ${esc(model.name)}</label>
<textarea id="try-text" name="text" rows="4" maxlength="4000" required placeholder="Ask it anything. The answer is one run on your own allowance.${model.uncensored ? ' The floor applies.' : ''}">${esc(text)}</textarea>
<div class="ex-try-row">${kit.button({ label: 'Send', type: 'submit' })}<span class="ex-muted">Free daily allowance; the run’s cost is shown with the answer.</span></div>
</form>
${result ? resultCard(result) : ''}`;
}

function policyText(p) {
    if (!p) return '<span class="ex-muted">not stated</span>';
    const bits = [];
    bits.push(p.trains === false ? 'no training' : p.trains === true ? 'may train' : 'training not stated');
    if (p.retention_days != null) bits.push(p.retention_days === 0 ? 'no retention' : `kept ${p.retention_days} d`);
    if (p.region) bits.push(esc(p.region));
    return bits.join(' · ');
}

function resultCard(result) {
    const facts = [
        ['Offer', result.provider ? (INTERNAL.test(String(result.provider)) ? 'OpenVibe' : result.provider) : '–'],
        ['Cost', result.cost_usd == null ? '–' : `$${Number(result.cost_usd).toFixed(6)}`],
        ['Latency', result.latency_ms == null ? '–' : ms(result.latency_ms)],
        ['Tokens', `${count(result.tokens_in)} in · ${count(result.tokens_out)} out`],
        ['Run', result.run_id || '–'],
    ];
    return kit.receipt({
        title: result.model ? `${result.model} answered` : 'The answer',
        body: `<div class="ex-answer">${esc(result.content || '(no text)')}</div>`,
        facts,
    });
}

// ── API ────────────────────────────────────────────────────
function apiPage({ catalog, usage }) {
    const models = chatModels(catalog).filter((m) => !m.uncensored).slice(0, 12);
    const rows = models.map((m) => ({ model: `<code>${esc(m.slug)}</code>`, family: esc(familyLabel(m)), context: m.context || null }));
    const byDay = (usage.by_day || []).slice(-14).reverse();
    const usageRows = byDay.map((d) => ({ day: d.day, requests: count(d.requests), tokens: count((d.tokens_in || 0) + (d.tokens_out || 0)), cost: d.cost_usd == null ? '–' : `$${Number(d.cost_usd).toFixed(4)}` }));
    return `<div class="ex-wrap ex-page">
${kit.head({ title: 'The API', sub: 'One endpoint. OpenAI and Anthropic compatible.', actions: [kit.button({ href: '/chat', label: 'Chat', icon: 'chat', kind: 'quiet' })] })}
${panel({ title: 'One endpoint', body: `
<p class="ex-prose"><code>${ENDPOINT}</code> speaks OpenAI's Chat Completions; <code>https://api.openvibe.exchange/v1/messages</code> speaks Anthropic's Messages API, so Claude Code works by pointing <code>ANTHROPIC_BASE_URL</code> at it.</p>
${kit.snippet({ code: `curl ${ENDPOINT} \\\n  -H "Authorization: Bearer $OPENVIBE_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"openvibe/auto","messages":[{"role":"user","content":"Hello"}]}'`, id: 'api-curl' })}
<h3 class="ex-h3">Keys</h3>
<p class="ex-prose">Keys are OpenVibe.Network developer keys: make one, name its scope, and revoke it any time. They are shown once and never stored here.</p>
<p>${kit.button({ href: 'https://openvibe.network/developers', label: 'Make a key on Network' })}</p>
<h3 class="ex-h3">Model ids</h3>
<p class="ex-prose"><code>openvibe/auto</code> lets the router pick by your floor, ceiling and policy, and the answer says which model ran and why. An exact id pins one artifact. Bring your own provider key and those requests pay the provider directly, at no fee from us.</p>
${kit.table({ columns: [{ key: 'model', label: 'Model', primary: true, html: true }, { key: 'family', label: 'Family' }, { key: 'context', label: 'Context', num: true }], rows, label: 'Model ids' })}
` })}
${panel({ title: 'Usage', note: 'Aggregate, from OpenVibe.AI: no prompt and no person.', id: 'usage', body: usage.unavailable ? kit.notice({ kind: 'info', text: 'Usage is not available right now.' }) : (usageRows.length ? kit.table({ columns: [{ key: 'day', label: 'Day', primary: true }, { key: 'requests', label: 'Requests' }, { key: 'tokens', label: 'Tokens' }, { key: 'cost', label: 'Cost' }], rows: usageRows, label: 'Usage by day', caption: 'The last 14 days, all products and people.' }) : kit.empty({ icon: 'spark', title: 'No requests yet', text: 'The first call through the endpoint will show here.' })) })}
${panel({ title: 'What it costs', body: '<p class="ex-prose">Every price is the offer\'s own, per million tokens, and the answer carries the exact cost of that run. A small free daily allowance comes with every account; it grows with account age and contribution. Paid use, when the owner turns money on, is at cost plus a margin and shown before the request.</p>' })}
</div>`;
}

// ── Sell compute ───────────────────────────────────────────
function sellPage({ catalog, usage }) {
    const offers = (catalog.models || []).flatMap((m) => m.offers.filter((o) => o.trust === 'community').map((o) => ({ model: m, offer: o })));
    const first = offers[0];
    const seller = first
        ? sellerCard({ machine: providerLabel(first.offer), model: first.model, offer: first.offer, example: false })
        : sellerCard({ machine: 'RTX 3090', model: { name: 'Qwen 32B', family: 'Qwen' }, offer: { speed: { p50_ms: 24 }, uptime: 0.994 }, example: true });
    const machineRows = offers.slice(0, 10).map(({ model, offer }) => ({
        model: `<a href="${hrefOf(model)}">${esc(model.name)}</a>`, provider: esc(providerLabel(offer)),
        price: offer.price ? `${money(offer.price.in)} / ${money(offer.price.out)}` : 'volunteer (free)',
        uptime: offer.uptime == null ? '–' : pct(offer.uptime),
    }));
    return `<div class="ex-wrap ex-page">
${kit.head({ title: 'Sell your compute', sub: 'Turn a GPU or a spare machine into credits.', actions: [kit.button({ href: 'https://node.openvibe.network', label: 'Get Node', kind: 'quiet' })] })}
${panel({ title: 'A machine on the network', id: 'seller', body: `${seller}<p class="ex-prose">Every offer shows this card: the machine, what it runs, how fast it answers, its uptime, and whether it is verified.</p>` })}
${panel({ title: 'Turn it on', body: `
<p class="ex-prose">Install <a href="https://node.openvibe.network">OpenVibe Node</a> on the machine, open the AI plugin, and turn on <strong>Offer to the network</strong>. Choose the models it serves, the hours, how many requests at once, a price (0 to volunteer), and who may use it: everyone, your followers, or a group.</p>
<p class="ex-prose"><strong>Idle-only:</strong> it pauses while you game, stream or render, so the machine stays yours. Flip it back when you are done.</p>
<p class="ex-prose">A new machine serves the free tier until it is trusted: canary prompts with known answers, a model fingerprint that proves the declared model and quantization, and spot re-runs (about 1% of requests) compared on a trusted machine. Uptime and latency build your reputation score. Verified tokens earn credits, usable across OpenVibe.</p>
<p class="ex-prose"><strong>Kudos for volunteers:</strong> an offer at 0 earns kudos that never expire and buy queue priority and bigger free limits. Kudos are never cash.</p>
<p class="ex-prose"><strong>Privacy, said plainly:</strong> a community machine sees the prompt. Only requests that allow community capacity ever go there, and the answer is labelled Community.</p>
<div class="ex-steps"><ol><li>Install Node and sign in.</li><li>Open the AI plugin and pick the models it can serve.</li><li>Set hours, concurrency, price, idle-only and who may use it.</li><li>Watch tokens served, earnings and verification on this page.</li></ol></div>
<p>${kit.button({ href: 'https://node.openvibe.network', label: 'Install OpenVibe Node' })}</p>` })}
${panel({ title: 'Your dashboard', id: 'dashboard', body: kit.empty({ icon: 'spark', title: 'No machine offered yet', text: 'When Node is offering capacity, its tokens served, credits, uptime, verification and reputation show here.' }) })}
${panel({ title: 'What is not sold here', note: 'Said plainly, because it gets accounts banned elsewhere.', id: 'not-sold', body: `
<ul class="ex-list">
<li><strong>Personal subscription plans</strong> (Codex, ChatGPT, Claude, MiniMax and others). Their terms make them personal, and pooled accounts get banned. A plan works for its owner on their own machine, through <a href="https://openvibe.codes">OpenVibe.Codes</a>.</li>
<li><strong>Personal API keys.</strong> A key serves its owner only, never a pool.</li>
<li><strong>What is sold:</strong> compute people own, and capacity OpenVibe buys under terms that allow resale.</li>
</ul>
<p class="ex-prose">A contributor's offer obeys the same content floor as every offer here. An offer that breaks it is removed, and so is the account.</p>` })}
${panel({ title: 'Machines on the network now', id: 'community', body: machineRows.length ? kit.table({ columns: [{ key: 'model', label: 'Model', primary: true, html: true }, { key: 'provider', label: 'Machine' }, { key: 'price', label: 'In / out per M' }, { key: 'uptime', label: 'Uptime' }], rows: machineRows, label: 'Community offers', empty: 'No community machine is offering capacity yet.' }) : kit.empty({ icon: 'robot', title: 'No community capacity yet', text: 'Be the first: the owner’s own machine is off by default, and volunteers set the free tier.' }) })}
</div>`;
}

function sellerCard({ machine, model, offer, example }) {
    const speed = offer.speed && offer.speed.p50_ms != null ? `answers in ${ms(offer.speed.p50_ms)}` : 'speed not measured yet';
    const label = /owner|volunteer|machine/i.test(String(machine)) ? '@name’s own machine' : `@name’s ${machine}`;
    return `<article class="ex-seller${example ? ' is-example' : ''}">
<span class="ex-mk ex-mk--machine" style="--ex-mk-size:36px" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 6h16v9H4zM8 19h8M12 15v4"/></svg></span>
<div><b>${esc(label)}</b>
<p>${esc(model.name)} · ${speed} · ${offer.uptime == null ? 'uptime not measured yet' : `${pct(offer.uptime)} uptime`} · verified</p></div>
${example ? '<span class="ex-badge-note">Example</span>' : ''}
</article>`;
}

// ── Uncensored ─────────────────────────────────────────────
function uncensoredPage({ catalog, adult, signedIn }) {
    const models = (catalog.models || []).filter((m) => m.uncensored);
    const gate = !signedIn
        ? kit.section({ title: 'Adults only', body: `<p class="ex-prose">The uncensored tier is for adults. Sign in first (the confirmation sits on your account), then confirm you are 18 or over.</p><p>${kit.button({ href: '/auth/login?next=%2Funcensored', label: 'Sign in with OpenVibe' })}</p>` })
        : !adult
            ? kit.section({ title: 'Confirm you are 18 or over', body: `<p class="ex-prose">Uncensored models are abliterated builds. They will answer what a filtered model refuses. The floor below applies to every request, and a breach ends the account.</p>${floorText()}<form method="post" action="/uncensored/confirm" class="ovk-form ex-confirm"><label class="ex-check"><input type="checkbox" name="adult" value="yes" required> <span>I am 18 or over and I accept the floor.</span></label>${kit.button({ label: 'Confirm', type: 'submit' })}</form>` })
            : '';
    return `<div class="ex-wrap ex-page">
${kit.head({ title: 'Uncensored', sub: 'Abliterated models, for adults. The same floor, always.', actions: [kit.badge('18+', 'bad')] })}
${gate || ''}
${panel({ title: 'The floor on every offer, uncensored or not', id: 'floor', body: floorText(true) })}
${adult ? panel({ title: 'Uncensored models', id: 'models', body: modelList(models, { empty: 'No uncensored model is live right now. Featherless and Refuseless offers appear here when their keys are on.' }) }) : ''}
${panel({ title: 'How to use it', body: '<p class="ex-prose">Pick an uncensored model in <a href="/chat">chat</a>, or send its exact id to the API. Your 18+ confirmation sits on your account, so it follows you here; the floor applies to every request on this tier, and a breach ends the account.</p>' })}
${companionsPolicy()}
${changelogPanel()}
</div>`;
}

/**
 * The same floor, said for the companions (Opus's design, 2026-11-06): the floor holds on a character card at
 * save and on every message of a chat, in and out.
 */
function companionsPolicy() {
    const body = '<ul class="ex-list ex-floor">'
        + '<li>A character card that sets an age under 18 and is rated 18+ is refused at save.</li>'
        + '<li>A card that breaks the floor is refused at save, and never reaches the gallery.</li>'
        + '<li>On a chat, your own message is checked before it is sent, and the answer is checked before it is shown.</li>'
        + '<li>An answer that breaks the floor is never delivered: the chat ends and the account is reviewed.</li>'
        + '<li>An 18+ character shows only to people signed in with the 18+ confirmation, and never reaches a public list, a sitemap, llms.txt or a search.</li>'
        + '</ul><p class="ex-prose">The same three rules as everywhere else, with the character’s own card in scope: no sexual content involving minors, no non-consensual sexual content (fiction included) or incest, no help with weapons of mass harm or attacks on others.</p>';
    return panel({ title: 'The floor on characters and chats', id: 'companions-floor', body });
}

/**
 * The dated changelog of the adults’ tier (Opus’s design, 2026-11-06: "Changes are announced: a policy change is a
 * dated changelog entry on /uncensored"). Newest first.
 */
const ADULT_CHANGELOG = [
    { date: '2026-11-06', what: 'Characters and one-character chats arrived at <a href="/companions">/companions</a>. A card rated 18+ may not state an age under 18, and the floor now holds on the card at save and on every message of a chat, in and out. An 18+ character shows only to people signed in with the 18+ confirmation, and never reaches a public list, a sitemap, llms.txt or a search.' },
];

function changelogPanel() {
    const rows = ADULT_CHANGELOG.map((e) => '<li><b>' + esc(e.date) + '</b> — ' + e.what + '</li>').join('');
    return panel({ title: 'What changed', note: 'Newest first.', id: 'adult-changelog', body: '<ul class="ex-list">' + rows + '</ul>' });
}

function floorText() {
    const body = `<ul class="ex-list ex-floor">
<li>No sexual content involving minors.</li>
<li>No non-consensual sexual content (fiction included), and no incest.</li>
<li>No help with weapons of mass harm or attacks on others.</li>
</ul><p class="ex-prose">Non-consensual sexual content (fiction included) and incest are refused, because payment providers and hosts ban them.</p><p class="ex-prose">A breach ends the account. This is not a suggestion a model may talk its way past; it is the condition of being here.</p>`;
    return `<div class="ex-floor-box">${body}</div>`;
}

// ── AI in OpenVibe ─────────────────────────────────────────
function aiPage({ catalog, usage }) {
    const products = usage.by_product || [];
    const days = usage.days ? Math.max(1, usage.days) : 30;
    const rows = products.map((p) => {
        const prod = product(p.product);
        return {
            product: `<span class="ex-product-cell">${productMark(p.product, { size: 28 })}<b>${esc(prod.name)}</b></span>`,
            models: (p.models || []).slice(0, 4).map((m) => `<code>${esc(m.model || m.provider)}</code>`).join(' ') || '–',
            requests: count(p.requests),
            tokens: count((p.tokens_in || 0) + (p.tokens_out || 0)),
            cost: p.cost_usd == null ? '–' : `$${(Number(p.cost_usd) / days).toFixed(4)}`,
        };
    });
    const perDay = (n) => (n == null ? '–' : `$${(Number(n) / days).toFixed(4)}`);
    return `<div class="ex-wrap ex-page">
${kit.head({ title: 'AI in OpenVibe', sub: 'One layer for every product: the same router, offers, failover and prices.', actions: [kit.button({ href: '/models', label: 'Models', kind: 'quiet' })] })}
${usage.unavailable ? kit.notice({ kind: 'info', text: 'Usage is not reachable right now.' }) : ''}
${panel({ title: 'Who runs what', note: `Requests in the last ${days} days, from OpenVibe.AI.`, id: 'products', body: rows.length ? kit.table({ columns: [
        { key: 'product', label: 'Product', primary: true, html: true },
        { key: 'models', label: 'Models', html: true },
        { key: 'requests', label: 'Requests' },
        { key: 'tokens', label: 'Tokens', hide: 'sm' },
        { key: 'cost', label: 'Cost a day' },
    ], rows, label: 'Product usage', caption: 'A product names its quality floor, price ceiling and policy; the router does the rest.' }) : kit.empty({ icon: 'spark', title: 'No product has run a model yet', text: 'Products appear here the first time they call the router.' }) })}
${panel({ title: 'What each product gets', body: `
<ul class="ex-list">
<li>the same offers and failover as this site;</li>
<li>its own quality floor, price ceiling and content policy;</li>
<li>usage and cost, per product, per day;</li>
<li>no product keeps its own provider keys or its own model list.</li>
</ul>
<p class="ex-prose">Watch, Actor, Codes, Live, Blog, News, Wiki, Vision, Bench, Space, Help, Food and Trade call the same router with their service token. The numbers above are read from AI's daily rollup, never from a prompt or a person.</p>` })}
${panel({ title: 'The cost, per day', body: usage.totals ? `<p class="ex-prose">${count(usage.totals.requests)} requests and ${count((usage.totals.tokens_in || 0) + (usage.totals.tokens_out || 0))} tokens over ${days} days, at about ${perDay(usage.totals.cost_usd)} a day across the network.</p>` : '<p class="ex-prose">Cost is not available right now.</p>' })}
</div>`;
}

// ── Status ─────────────────────────────────────────────────
function statusPage({ catalog, usage }) {
    const offers = chatModels(catalog).flatMap((m) => m.offers.map((o) => ({ m, o })));
    offers.sort((a, b) => (b.o.requests_7d || 0) - (a.o.requests_7d || 0));
    const rows = offers.slice(0, 40).map(({ m, o }) => ({
        model: `<a href="${hrefOf(m)}">${esc(m.name)}</a>`,
        provider: esc(providerLabel(o)),
        uptime: o.uptime == null ? '<span class="ex-muted">no traffic</span>' : pct(o.uptime),
        traffic: count(o.requests_7d),
        speed: o.speed.p95_ms == null ? '–' : ms(o.speed.p95_ms),
        updated: o.updated_at ? String(o.updated_at).slice(0, 10) : '–',
    }));
    const recent = [...offers].filter(({ o }) => o.updated_at).sort((a, b) => String(b.o.updated_at).localeCompare(String(a.o.updated_at))).slice(0, 10)
        .map(({ m, o }) => `<li><time>${esc(String(o.updated_at).slice(0, 10))}</time> ${esc(m.name)} on ${esc(providerLabel(o))}${o.price ? ` · ${inOut(o.price)}` : ''}</li>`).join('');
    return `<div class="ex-wrap ex-page">
${kit.head({ title: 'Status', sub: 'Uptime per offer, the model changelog, and incidents.', actions: [kit.button({ href: '/models', label: 'Models', kind: 'quiet' })] })}
${unavailable(catalog, 'The status board')}
${panel({ title: 'Uptime per offer', note: 'Measured from real requests in the last seven days. An offer with no traffic has no uptime to show, and says so.', id: 'uptime', body: rows.length ? kit.table({ columns: [
        { key: 'model', label: 'Model', primary: true, html: true },
        { key: 'provider', label: 'Offer' },
        { key: 'uptime', label: 'Uptime', html: true },
        { key: 'traffic', label: 'Requests, 7 d' },
        { key: 'speed', label: 'p95' },
        { key: 'updated', label: 'Changed', hide: 'sm' },
    ], rows, label: 'Uptime per offer' }) : kit.empty({ icon: 'spark', title: 'No offers yet', text: 'Offers appear here when a provider key or a Node machine is on.' }) })}
${panel({ title: 'Model changelog', note: 'What changed in the catalogue, newest first. Prices move when a provider moves them.', id: 'changelog', body: recent ? `<ul class="ex-changelog">${recent}</ul>` : '<p class="ex-prose">No catalogue change recorded yet.</p>' })}
${panel({ title: 'Incidents', id: 'incidents', body: catalog.unavailable || catalog.stale ? kit.notice({ kind: 'error', text: 'OpenVibe.AI is not answering right now, so these numbers are not live. Live prices and the catalog on the other pages say so too.' }) : '<p class="ex-prose">No incident recorded. When an offer goes down, a failover is used and the answer says so; here is where an outage is written down.</p>' })}
${panel({ title: 'Requests today', body: usage.unavailable ? '<p class="ex-prose">Usage is not reachable right now.</p>' : `<p class="ex-prose">${count(usage.today ? usage.today.requests : 0)} requests today, ${count(usage.today ? (usage.today.tokens_in || 0) + (usage.today.tokens_out || 0) : 0)} tokens.</p>` })}
</div>`;
}

// ── Retired v1 ─────────────────────────────────────────────
function retired(pathName) {
    return `<div class="ex-wrap ex-page ex-narrow">
${kit.empty({
        icon: 'spark', title: 'This part of Exchange is retired',
        text: `“${pathName}” was Exchange v1: free and swap listings for agents, templates, themes and game assets. Exchange is now the network's AI: every model, one account.`,
    })}
${panel({ title: 'Where those things live now', body: `<ul class="ex-list">
<li>Agents and MCP tools: <a href="https://openvibe.codes">OpenVibe.Codes</a> and <a href="https://openvibe.network">Connect</a>.</li>
<li>Templates: <a href="https://openvibe.space">OpenVibe.Space</a> and <a href="https://openvibe.report">OpenVibe.Report</a>.</li>
<li>Themes: <a href="https://openvibe.design">OpenVibe.Design</a>.</li>
<li>Every AI model, with live prices and chat: <a href="/">the new Exchange</a>.</li>
</ul><p class="ex-prose">v1's tables are kept read-only for their owners; nothing new is written to them.</p>` })}
</div>`;
}

module.exports = { home, modelsPage, modelPage, apiPage, sellPage, uncensoredPage, aiPage, statusPage, retired, privacyOf, providerLabel, familyLabel, chatModels, ENDPOINT };
