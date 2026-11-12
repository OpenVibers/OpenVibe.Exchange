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
const CHAT = 'https://openvibe.chat/vibe';
const chatModel = (m) => `${CHAT}?models=${encodeURIComponent(m.slug)}`;

const money = (n, free = false) => (free ? 'free' : n == null ? '–' : n === 0 ? '$0' : `$${Number(n) < 0.1 ? Number(n).toPrecision(2) : Number(n).toFixed(2)}`);
const inOut = (price) => (price ? `${money(price.in)} in · ${money(price.out)} out` : 'no per-token price');
const ms = (n) => (n == null ? '–' : n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`);
const pct = (n) => (n == null ? '–' : `${(n * 100).toFixed(1)}%`);

/**
 * The refusal rate of an offer, with the day it was measured. The rate is a share of the published probe set
 * (OpenVibe.AI measures it), and a number without its date would look current when it may be weeks old, so
 * the day is part of the number. An offer nobody measured shows nothing at all: no rate, no dash.
 */
const refusalText = (o) => {
    if (!o || o.refusal_rate == null) return null;
    const date = o.refusal_measured_on ? ` (measured ${o.refusal_measured_on})` : '';
    return `refuses ${pct(o.refusal_rate)}${date}`;
};
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
 * The privacy label the design asks for, from facts only. AI's offer carries the label it read from the provider's
 * own terms (`offer.privacy`, the same function the router filters on): Private when it keeps nothing and trains on
 * nothing, Anonymized when it declares a policy that is weaker, Community for a person's machine. An offer that
 * declares nothing is Standard. "No training" is said as that when the provider promises only that.
 */
/** The tier, the latency class and the free allowance of one offer, in words (AI reads them from the provider). */
function tierOf(offer) { return offer && offer.service_tier === 'flex' ? 'Flex' : null; }
function latencyOf(offer) {
    const c = offer && offer.latency_class;
    return Array.isArray(c) && c.length && !(c.length === 1 && c[0] === 'interactive') ? c.join('/') : null;
}
function freeAllowanceOf(offer) {
    const a = offer && offer.free_allowance;
    if (!a || a.ended || !(a.left > 0)) return null;
    return `${count(a.left)} free tokens left${a.ends_at ? ' until ' + String(a.ends_at).slice(0, 10) : ''}`;
}

function privacyOf(offer) {
    if (!offer) return null;
    if (offer.trust === 'community') return { label: 'Community', kind: 'accent', short: 'Community' };
    const label = offer.privacy && offer.privacy.label;
    if (label === 'private') return { label: 'Private', kind: 'ok', short: 'Private' };
    const p = offer.data_policy;
    if (p && p.anonymized === true) return { label: 'Anonymized', kind: 'accent', short: 'Anonymized' };
    if (p && p.trains === false) return { label: 'No training', kind: 'ok', short: 'No training' };
    if (label === 'anonymized') return { label: 'Anonymized', kind: 'accent', short: 'Anonymized' };
    return { label: 'Standard', kind: '', short: 'Standard' };
}

/** The label of an answer, from the run's own explain (`privacy` in AI). */
const ANSWER_LABELS = { private: ['Private', 'ok'], anonymized: ['Anonymized', 'accent'], community: ['Community', 'accent'] };
function answerPrivacy(result) {
    if (!result || !result.privacy) return null;
    const [name, kind] = ANSWER_LABELS[result.privacy] || ['Standard', ''];
    const d = result.privacy_detail || {};
    const facts = [];
    if (d.retention === 'none') facts.push('no retention');
    if (d.training === false) facts.push('no training');
    if (d.trust === 'own_machine') facts.push('your own machine');
    if (d.trust === 'own_deployment') facts.push('OpenVibe’s own hardware');
    if (d.trust === 'community') facts.push('a community machine sees the prompt');
    return { label: name, kind, facts: facts.join(' · ') || (d.known === false ? 'the offer declared no policy' : '') };
}

// Free to try now: AI's free_now (a free-tier offer whose provider can answer); free_tier alone on an older AI.
const freeTier = (o) => Boolean(o && (o.free_now !== undefined ? o.free_now === true : o.free_tier === true));
// A free-tier offer whose provider cannot answer right now (out of credit, or down): said, never promised.
const freePaused = (o) => Boolean(o && o.free_tier === true && o.free_now === false);
/** An offer's measured status: up, degraded (over 5% of the last hour's requests) or down (its circuit is open), with the plain reason and since when. */
const statusCell = (o) => {
    const s = String((o && o.status) || 'up');
    if (s === 'up') return kit.badge('Up', 'ok');
    const why = o.status_reason ? `<br><small>${esc(o.status_reason)}</small>` : '';
    const since = o.status_since ? `<br><small class="ex-muted">since ${esc(String(o.status_since).slice(0, 16).replace('T', ' '))} UTC</small>` : '';
    return `${kit.badge(s === 'down' ? 'Down' : 'Degraded', s === 'down' ? 'bad' : 'warn')}${why}${since}`;
};
const FREE_PAUSED = 'Free messages are paused right now: the free model\u2019s provider is out of credit. Your own key or Balance still works.';

function badgesOf(m, best) {
    const out = [
        m.uncensored ? kit.badge('18+', 'bad') : '',
        m.community ? kit.badge('Community', 'accent') : '',
        (m.offers || []).some(freeTier) ? kit.badge('Free to try') : ((m.offers || []).some(freePaused) ? kit.badge('Free paused') : ''),
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
    // A stat not measured yet is left out, never printed as a dash ("– · –" read as noise in a row).
    if (best) bits.push(providerLabel(best), inOut(best.price), ...(best.speed && best.speed.p50_ms != null ? [ms(best.speed.p50_ms)] : []), ...(best.uptime != null ? [`${pct(best.uptime)} up`] : []));
    else if (m.offers[0]) bits.push(providerLabel(m.offers[0]), 'free capacity');
    const refuses = refusalText(best);
    if (refuses) bits.push(refuses);
    const pv = privacyOf(best || m.offers[0]);
    if (pv) bits.push(pv.short);
    if (best && tierOf(best)) bits.push(tierOf(best));
    if (best && latencyOf(best)) bits.push(latencyOf(best) + ' only');
    if (best && freeAllowanceOf(best)) bits.push(freeAllowanceOf(best));
    return `<li class="ex-mrow">
<a class="ex-mrow-main" href="${hrefOf(m)}">${mark(familyLabel(m))}<span class="ex-mrow-text"><span class="ex-mrow-title"><b>${esc(m.name)}</b>${badgesOf(m, best)}</span><small>${bits.map((b) => esc(b)).join(' · ')}</small></span></a>
${withTry ? `<a class="ex-try-link" href="${chatModel(m)}">Try it</a>` : ''}
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
    // The free allowance is a stat only while some free model can answer it.
    if (config && catalog.free_available !== false) stats.push([config.chat.perDay, 'messages free every day']);
    if (usage.today && usage.today.requests >= 1000) stats.push([count(usage.today.requests), 'requests today']);

    return `<div class="ex-wrap ex-home">
<section class="ex-hero">
<div class="ex-hero-copy">
<h1>Every AI model, one account.</h1>
<p class="ex-lead">${families.length ? `${esc(listSaid(families.slice(0, 6)))} now, more as their providers join. ` : ''}Live prices, speed and uptime, one OpenAI-compatible endpoint, and a chat that puts models side by side.</p>
${kit.find({ action: '/models', name: 'q', placeholder: families.length ? `Find a model: ${families.slice(0, 3).join(', ')}…` : 'Find a model or a provider', value: q, icon: 'search' })}
<p class="ex-hero-actions">${kit.button({ href: '/models', label: 'All models' })} ${kit.button({ href: '/start', label: 'Start building', kind: 'quiet' })}</p>
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
${lineCard({ href: '/arena', name: 'The Arena', text: 'One prompt, two unnamed models, one vote: then both names and their receipts.', icon: 'swap', tone: 'accent' })}
${lineCard({ href: '/rankings', name: 'Rankings by task', text: 'What people prefer for code, writing, chat and reasoning, beside the price, speed and uptime. Worth it, measured.', icon: 'trophy', tone: 'accent' })}
${lineCard({ href: '/uncensored', name: 'Uncensored (18+)', text: 'Abliterated models for adults, with the floor that holds on every request.', icon: 'shield', tone: 'warn' })}
${lineCard({ href: '/why', name: 'Why this model', text: 'Every answer carries its receipt: the objective, the candidates, their cost and latency, and why the others did not answer.', icon: 'help', tone: 'accent' })}
${lineCard({ href: '/start', name: 'Start building', text: 'One key, one endpoint and the SDK you already use; four steps from a key to a receipt.', icon: 'code', tone: 'accent' })}
${lineCard({ href: '/sell', name: 'Run on people’s machines', text: 'Community GPUs through OpenVibe Link, labelled on every answer.', icon: 'computer', tone: 'accent' })}
${lineCard({ href: '/api', name: 'Bring your own key, 0% fee', text: 'Your provider key pays the provider directly; the router never adds a fee on it.', icon: 'key', tone: 'accent' })}
${lineCard({ href: '/own', name: 'Your own endpoint', text: 'A private GPU for one model or your own weights: only you reach it, and it scales to zero when idle.', icon: 'server', tone: 'accent' })}
</div>
${panel({
        title: 'Use it from code', note: 'One endpoint, compatible with OpenAI and with Anthropic.', id: 'code', body: `
<p class="ex-prose">Point an OpenAI client at <code>https://api.openvibe.exchange/v1</code>, or Claude Code at its <code>/v1/messages</code>. Model ids are <code>deepseek/deepseek-chat</code>, or <code>openvibe/auto</code> to let the router pick by your floor, ceiling and policy.</p>
${kit.snippet({ code: `curl ${ENDPOINT} \\\n  -H "Authorization: Bearer $OPENVIBE_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"deepseek/deepseek-chat","messages":[{"role":"user","content":"Hello"}]}'`, id: 'home-curl' })}
<p class="ex-more"><a href="/start">Start building in four steps →</a> · <a href="/api">Keys, usage and the full reference →</a></p>`,
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
<p class="ex-more"><a href="https://openvibe.chat/vibe">Open the real chat →</a></p>
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

// A feature's own icon, from the kit's set, on a tint of a theme token. Model family marks name models only: on these
// cards a family's mark read as a stray logo (owner, 11-09: "what is it even supposed to be?").
function lineCard({ href, name, text, icon, tone = 'accent' }) {
    return `<a class="ex-line" href="${href}"><span class="ex-line-ic ex-line-ic--${esc(tone)}" aria-hidden="true">${kit.icon(icon)}</span><span><b>${esc(name)}</b><small>${esc(text)}</small></span><span class="ex-line-go" aria-hidden="true">→</span></a>`;
}

function productsSummary(usage) {
    const products = usage.by_product || [];
    if (usage.unavailable) return kit.notice({ kind: 'info', text: 'Product usage is read from OpenVibe.AI and is not available right now.' });
    if (!products.length) return kit.empty({ icon: 'code', title: 'No product has run a model yet', text: 'When one does, its models and daily cost show here and on <a href="/ai">AI in OpenVibe</a>.' });
    const rows = products.slice(0, 5).map((p) => {
        const prod = product(p.product);
        const top = [...new Set((p.models || []).slice(0, 3).map((m) => modelLabel(m.model || m.provider)).filter(Boolean))].slice(0, 2).join(', ');
        return `<li class="ex-product-row"><a href="/ai">${productMark(p.product, { size: 28 })}<span><b>${esc(prod.name)}</b><small>${top ? `runs ${esc(top)}` : 'runs models through OpenVibe.AI'}</small></span><span class="ex-trail"><b>${count(p.requests)}</b><small>requests</small></span></a></li>`;
    }).join('');
    return `<ul class="ex-product-list">${rows}</ul>`;
}

// ── Models ─────────────────────────────────────────────────
function modelsPage({ catalog, q = '', family = '', sort = '', community = null }) {
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
${kit.head({ title: 'Models', sub: `${models.length} model${models.length === 1 ? '' : 's'} · ${offerCount(models)} offers, live`, actions: [kit.button({ href: CHAT, label: 'Chat', icon: 'chat', kind: 'quiet' })] })}
${kit.find({ action: '/models', name: 'q', placeholder: 'Find a model or a provider', value: q, icon: 'search' })}
<div class="ex-chips" role="group" aria-label="Sort">${links}</div>
${families.length ? `<div class="ex-chips" role="group" aria-label="Family">${familyLinks}</div>` : ''}
${unavailable(catalog)}
${panel({ title: '', body: modelList(models, { empty: 'No model matches that search. Try a family or a provider.' }) })}
${communityPools(community)}
<p class="ex-more"><a href="https://openvibe.compare/">Compare models side by side on OpenVibe.Compare →</a></p>
<p class="ex-more"><a href="/status">Uptime and incidents →</a></p>
</div>`;
}

// ── One model ──────────────────────────────────────────────
function modelPage({ model, viewer, result = null, problem = null, text = '', adult = false, community = null, analysis = null }) {
    const offers = model.offers || [];
    const best = cheapest(model);
    const badges = [model.uncensored ? kit.badge('18+', 'bad') : '', model.community ? kit.badge('Community', 'accent') : '', offers.some(freeTier) ? kit.badge('Free to try') : (offers.some(freePaused) ? kit.badge('Free paused') : '')].join('');
    const stats = [
        best ? [money(best.price.in), 'cheapest in, per M'] : null,
        best ? [money(best.price.out), 'cheapest out, per M'] : null,
        model.context ? [count(model.context), 'context, tokens'] : null,
        best ? [ms(best.speed.p50_ms), 'typical first answer'] : null,
        best ? [pct(best.uptime), 'uptime, 7 days'] : null,
    ].filter(Boolean);

    const columns = [
        { key: 'provider', label: 'Offer', primary: true, html: true },
        { key: 'status', label: 'Status', html: true },
        { key: 'price', label: 'In / out per M', html: true },
        { key: 'speed', label: 'Speed', html: true },
        { key: 'first', label: 'First token' },
        { key: 'uptime', label: 'Uptime' },
        { key: 'errors', label: 'Errors' },
        { key: 'privacy', label: 'Privacy', html: true },
        { key: 'policy', label: 'Data policy', html: true },
        { key: 'try', label: 'Try', html: true },
    ];
    const rows = offers.map((o) => {
        const p = privacyOf(o);
        // A pool's head is the offer: the label says how many machines serve it, never which ones (the count is public).
        const pools = poolOffersFor(community, o.model);
        const communityBadge = pools.length
            ? kit.badge(poolLabel((pools[0].pool && pools[0].pool.machines && pools[0].pool.machines.length) || 0), 'accent')
            : (o.trust === 'community' ? kit.badge('Community', 'accent') : '');
        const refuses = refusalText(o);
        return {
            provider: `<a class="ex-offer-name" href="#try">${esc(providerLabel(o))}</a> ${communityBadge}${freeTier(o) ? ` ${kit.badge('Free to try')}` : (freePaused(o) ? ` ${kit.badge('Free paused')}` : '')}`,
            status: statusCell(o),
            price: (o.price ? `<b>${money(o.price.in)}</b> / ${money(o.price.out)}${o.fixed_price ? ` ${kit.badge('Fixed price')}` : ''}` : '<span class="ex-muted">free capacity</span>')
                + (tierOf(o) ? `<br>${kit.badge(tierOf(o), 'accent')}` : '')
                + (freeAllowanceOf(o) ? `<br><small>${esc(freeAllowanceOf(o))}</small>` : ''),
            speed: `${ms(o.speed.p50_ms)} <small>p50</small> · ${ms(o.speed.p95_ms)} <small>p95</small>`,
            first: o.speed && o.speed.ttft_ms != null ? ms(o.speed.ttft_ms) : '–',
            uptime: o.uptime == null ? '–' : pct(o.uptime),
            errors: o.error_rate == null ? '–' : pct(o.error_rate),
            privacy: `${p ? kit.badge(p.label, p.kind) : ''}${refuses ? `<br><small>${esc(refuses)}</small>` : ''}${latencyOf(o) ? `<br><small>${esc(latencyOf(o))} only</small>` : ''}` || '–',
            policy: policyText(o.data_policy),
            try: `<a class="ex-mini" href="${chatModel(model)}">Try it</a>`,
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
<p class="ex-more"><a href="https://openvibe.compare/things/${encodeURIComponent(model.slug)}">Compare ${esc(model.name)} with another model →</a></p>
${activityPanel(model.activity)}
${require('./analysis').modelFacts(analysis)}
${panel({ title: 'Presets', note: 'A preset fixes the router’s floor, ceiling and policy, and you name it as the model.', id: 'presets', body: presetsBox() })}
${panel({ title: 'Try it', id: 'try', body: `<p class="ex-actions">${kit.button({ href: chatModel(model), label: `Chat with ${model.name}` })} ${kit.button({ href: `https://openvibe.report/ai/models/${encodeURIComponent(model.slug || model.canonical)}`, label: 'How it ranks', kind: 'quiet' })}</p>` })}
${panel({ title: 'Use it from code', id: 'code', body: `${kit.snippet({ code, id: 'model-curl' })}
${kit.snippet({ code: sdk, id: 'model-sdk' })}
<p class="ex-more">The endpoint, keys and usage: <a href="/api">the API</a>.</p>` })}
</div>`;
}

/** Requests a day across the model's offers, the last 14 days that have any: bars, with the numbers as their labels. */
function activityPanel(activity) {
    const days = Array.isArray(activity) ? activity.slice(-14) : [];
    if (!days.length) return '';
    const peak = Math.max(1, ...days.map((d) => Number(d.requests) || 0));
    const bars = days.map((d) => {
        const n = Number(d.requests) || 0;
        return `<li><span class="ex-act-bar" style="height:${Math.max(4, Math.round((n / peak) * 100))}%"></span><span class="ex-act-day">${esc(String(d.day).slice(8, 10))}</span><span class="ex-sr">${esc(String(d.day))}: ${n.toLocaleString('en-US')} requests</span></li>`;
    }).join('');
    return panel({ title: 'Activity', note: 'Requests a day across every offer.', id: 'activity', body: `<ol class="ex-act">${bars}</ol>` });
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
<p class="ex-prose">These four aliases work today. A saved preset (<code>model: "@preset/private"</code>) is the router’s floor, ceiling, quantization, region and data policy written down once. The private preset is the strict one: only offers that keep nothing and train on nothing, or OpenVibe’s own deployments, may answer, and the router refuses rather than fall back.</p>`;
}

// ── A sealed chat ──────────────────────────────────────────
/**
 * The shell of a chat whose history is sealed with the person's Locker. The server never renders a turn: the page
 * carries no conversation, the browser opens the envelope and draws it (public/js/exchange.js). Only the chat id
 * and the model list are here, and neither is the history.
 */
function sealedChat({ chat = null, models = [], networkUrl = '', subject = '' }) {
    const options = models.slice(0, 40).map((m) => `<option value="${esc(m.slug)}">${esc(m.name)}${m.uncensored ? ' · 18+' : ''}</option>`).join('');
    return `<div class="ex-wrap ex-page ex-sealed" id="ex-sealed" data-chat="${chat ? esc(chat.id) : ''}" data-subject="${esc(subject)}" data-network="${esc(networkUrl)}">
${kit.head({ title: chat ? 'A sealed chat' : 'A new sealed chat', sub: 'Your history is sealed with your Locker.', back: { href: CHAT, label: 'Chat' }, actions: [kit.button({ href: CHAT, label: 'A normal chat', kind: 'quiet' })] })}
<noscript><p class="ex-prose">A sealed chat needs JavaScript: the sealing and the opening happen in your browser, and nowhere else.</p></noscript>
<div class="ex-sealed-card">
<p class="ex-sealed-title" data-sealed-title hidden></p>
<p class="ex-sealed-status" data-sealed-status>Opening your Locker…</p>
<div class="ex-sealed-turns" data-sealed-turns></div>
<form class="ovk-form ex-sealed-form" data-sealed-form hidden>
<label class="ex-label" for="sealed-text">Your message</label>
<textarea id="sealed-text" name="text" rows="4" maxlength="8000" required placeholder="Ask anything…"></textarea>
<div class="ex-sealed-row">
<label class="ex-label" for="sealed-model">Model</label>
<select id="sealed-model" name="model">${options}</select>
<label class="ex-check ovk-check"><input type="checkbox" name="strict_privacy" value="1" checked> <span>Strict privacy</span></label>
</div>
<div class="ex-try-row">${kit.button({ label: 'Send', type: 'submit' })}<span class="ex-muted">Sealed on this device before it leaves the page.</span></div>
<p class="ovk-msg" data-sealed-msg aria-live="polite"></p>
</form>
</div>
<p class="ex-sealed-note"><strong>Only me, always.</strong> This chat has no Share sheet: it stays yours, because only your Locker can read it. Sharing it would send people a conversation they could not open.</p>
<p class="ex-sealed-note"><strong>Said plainly:</strong> OpenVibe stores only the sealed envelope and cannot read it. The model still receives the text of the turn you send, and the earlier turns your browser sends with it, while it answers; that is privacy at rest, not from the model. Your passphrase, recovery words and keys never leave this tab.</p>
</div>`;
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
    const paused = (model.offers || []).some(freePaused) && !(model.offers || []).some(freeTier);
    return `<form class="ovk-form ex-try" method="post" action="${hrefOf(model)}/try">
${problem ? kit.notice({ kind: 'error', text: problem }) : ''}${paused ? kit.notice({ kind: 'info', text: FREE_PAUSED }) : ''}
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
    const privacy = answerPrivacy(result);
    const facts = [
        ['Offer', result.provider ? (INTERNAL.test(String(result.provider)) ? 'OpenVibe' : result.provider) : '–'],
        ['Privacy', privacy ? `${privacy.label}${privacy.facts ? ` · ${privacy.facts}` : ''}` : '–'],
        ['Cost', result.cost_usd == null ? '–' : `$${Number(result.cost_usd).toFixed(6)}`],
        ['Latency', result.latency_ms == null ? '–' : ms(result.latency_ms)],
        ['Tokens', `${count(result.tokens_in)} in · ${count(result.tokens_out)} out`],
        ...(result.cached_input_percent == null ? [] : [['Cached input', `${result.cached_input_percent}% (${count(result.tokens_cached)} tokens)`]]),
        ['Run', result.run_id || '–'],
    ];
    return kit.receipt({
        title: result.model ? `${result.model} answered` : 'The answer',
        body: `<div class="ex-answer">${esc(result.content || '(no text)')}</div>`,
        facts,
    });
}

// ── API ────────────────────────────────────────────────────
function apiPage({ catalog, usage, viewer = null, keyPrivacy = null }) {
    const models = chatModels(catalog).filter((m) => !m.uncensored).slice(0, 12);
    const rows = models.map((m) => ({ model: `<code>${esc(m.slug)}</code>`, context: m.context || null }));
    const byDay = (usage.by_day || []).slice(-14).reverse();
    const usageRows = byDay.map((d) => ({ day: d.day, requests: count(d.requests), tokens: shortCount((d.tokens_in || 0) + (d.tokens_out || 0)), cost: d.cost_usd == null ? '–' : `$${Number(d.cost_usd) < 0.1 ? Number(d.cost_usd).toFixed(4) : Number(d.cost_usd).toFixed(2)}` }));
    const signedIn = viewer && viewer.kind === 'user' && viewer.subject;
    const switchBox = !signedIn
        ? `<p class="ex-prose">Sign in to set strict privacy on your keys.</p>`
        : (keyPrivacy && keyPrivacy.available === false
            ? `<p class="ex-prose">The strict-privacy switch is not available right now. Requests can still name <code>model: "@preset/private"</code>.</p>`
            : `<form class="ovk-form ex-switch" method="post" action="/privacy/keys">
<input type="hidden" name="next" value="/api">
${keyPrivacy && keyPrivacy.error ? kit.notice({ kind: 'error', text: keyPrivacy.error }) : ''}
<label class="ex-check ovk-check"><input type="checkbox" name="strict" value="1"${keyPrivacy && keyPrivacy.on ? ' checked' : ''}> <span>Strict privacy on my keys</span></label>
${keyPrivacy && keyPrivacy.note ? kit.notice({ kind: 'info', text: keyPrivacy.note }) : ''}
<p class="ex-prose">Every request one of your keys makes that names no preset then uses the private preset: only an offer that keeps nothing and trains on nothing, or OpenVibe’s own deployment, may answer. When none can, the router refuses with a plain message rather than falling back to an offer that keeps or trains on the prompt. The switch is your account’s and your own projects’ <code>default</code> preset in OpenVibe.AI, so their keys use it too.</p>
<p>${kit.button({ label: 'Save the switch', type: 'submit', kind: 'quiet' })}</p>
</form>`);
    return `<div class="ex-wrap ex-page">
${kit.head({ title: 'The API', sub: 'One endpoint. OpenAI and Anthropic compatible.', actions: [kit.button({ href: CHAT, label: 'Chat', icon: 'chat', kind: 'quiet' })] })}
${panel({ title: 'Batches, at half price', body: `<p class="ex-prose">Half price. Answered within your deadline when spare low-cost capacity is free; if none comes free in time, the prompt expires and you pay nothing.</p>` })}
${panel({ title: 'Compute prices', id: 'compute', body: `
<p class="ex-prose"><code>GET /api/compute/prices</code> is the reviewed compute tariff behind <a href="/compute">Compute prices</a>, as JSON. It needs no key and no session: the answer is public and carries <code>Access-Control-Allow-Origin: *</code>, so another origin can read it in a browser. It is cached for 60 seconds (<code>Cache-Control: public, max-age=60</code>). The prices are provider tariffs, not quotes: each row keeps the date it was checked (<code>checked_at</code>) and the date it must be reviewed again (<code>expires_at</code>).</p>
<p class="ex-prose">Shape: <code>{ checked_at, prices: [{ id, provider, region?, kind: "cpu" | "gpu", cpu?, ram_mb?, gpu?, gpu_mb?, currency, hourly, per_second, billing_seconds, promotion?, promotion_expires?, interruptible?, expires_at, source }] }</code>. <code>hourly</code> and <code>per_second</code> are USD; <code>expires_at</code> is epoch milliseconds; <code>source</code> is the provider's own price page. Storage, network and plan fees are not included.</p>
<p class="ex-prose">The same list is filtered, sorted and compared on <a href="https://openvibe.compare/compute">OpenVibe.Compare</a>, which serves the comparison at <code>https://openvibe.compare/api/v1/compute</code>.</p>` })}
${panel({ title: 'One endpoint', body: `
<p class="ex-prose"><code>${ENDPOINT}</code> speaks OpenAI's Chat Completions; <code>https://api.openvibe.exchange/v1/messages</code> speaks Anthropic's Messages API, so Claude Code works by pointing <code>ANTHROPIC_BASE_URL</code> at it.</p>
<p class="ex-prose">Coming from OpenRouter or a provider's own API? <a href="/docs/migrate">Move your application to Exchange</a>: the first request, the gateway settings, routing checks and limited keys, step by step.</p>
${kit.snippet({ code: `curl ${ENDPOINT} \\\n  -H "Authorization: Bearer $OPENVIBE_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"openvibe/auto","messages":[{"role":"user","content":"Hello"}]}'`, id: 'api-curl' })}
<h3 class="ex-h3">Keys</h3>
<p class="ex-prose">Keys are OpenVibe.Network developer keys: make one, name its scope, and revoke it any time. They are shown once and never stored here. Manage your own provider API keys and browser session cookies on <a href="/privacy/keys">Your keys and accounts</a>; saved values stay sealed on OpenVibe.AI and are never shown again.</p>
<p>${kit.button({ href: 'https://openvibe.network/developers', label: 'Make a key on Network' })} ${kit.button({ href: '/privacy/keys', label: 'Your keys and accounts', kind: 'quiet' })}</p>
<h3 class="ex-h3" id="strict">Strict privacy</h3>
${switchBox}
<h3 class="ex-h3">Routing and fallbacks</h3>
<p class="ex-prose">Chat completions and Messages accept <code>provider.order</code>, <code>only</code>, <code>ignore</code>, <code>allow_fallbacks</code>, <code>sort</code>, <code>max_price</code>, <code>data_collection</code> and <code>zdr</code>. Put model fallbacks in <code>models: ["maker/first", "maker/backup"]</code>. All attempts share one request hold; an <code>Idempotency-Key</code> replay does not charge again.</p>
<p class="ex-prose">Sort by <code>price</code>, <code>throughput</code>, <code>latency</code>, <code>quality</code> or <code>value</code>. Quality uses the Bench board rating shown by Report; value is rating per dollar. Offers without the required evidence are excluded. Ratings arrive through the existing Bench event feed; provisional ratings are excluded. Speed uses observed decode throughput or time to first token.</p>
<p class="ex-prose"><code>max_price: {"prompt": 1, "completion": 2}</code> caps dollars per million tokens. <code>data_collection: "deny"</code> requires no training; <code>zdr: true</code> requires no retention. Unknown facts cannot satisfy a hard limit. Append <code>:free</code>, <code>:floor</code> or <code>:nitro</code> to require zero prices, prefer the lowest price, or prefer measured throughput. Explicit provider credentials and only-my-keys mode cannot currently combine with these routing controls.</p>
<h3 class="ex-h3" id="tiers">Service tier and data policy</h3>
<p class="ex-prose">Send <code>service_tier: "flex"</code> on Chat Completions or Messages to ask for the provider's slower, cheaper Flex tier: the request runs in the background class, and the answer says which tier really ran. Send <code>data_policy: "private"</code> to keep the prompt off every provider that trains on or retains it (the router refuses rather than fall back to one); <code>"anonymized"</code> marks work that is not sensitive, and <code>"community"</code> allows a person's machine.</p>
<h3 class="ex-h3">Request accounting</h3>
<p class="ex-prose"><code>usage: {"include": true}</code> adds cost in dollars, latency in milliseconds and provider to token usage. Look up your own request with <code>GET /v1/generation?id=&lt;response-id&gt;</code>. A different owner receives 404.</p>
<h3 class="ex-h3">Saved request presets</h3>
<p class="ex-prose">Save model, fallbacks, system prompt, provider routing and sampling under a name using <code>POST /v1/presets/import</code>, then request <code>@preset/name</code>. Use your person token to list or save at <code>/api/v1/exchange/presets</code>, or delete at <code>/api/v1/exchange/presets/:name</code>. Inference keys do not authorize provisioning. The import preview remains write-free.</p>
<h3 class="ex-h3">Other compatible endpoints</h3>
<ul class="ex-prose"><li><code>POST /v1/completions</code>: one string prompt, with streaming.</li><li><code>POST /v1/embeddings</code>: strings or string arrays, float vectors.</li><li><code>GET /v1/models</code>: catalogue entries with per-token pricing, context and provider limits.</li><li><code>POST /v1/images/generations</code>: the existing image adapter on configured non-metered capacity; paid image accounting is not yet supported.</li></ul>
<h3 class="ex-h3">Model ids</h3>
<p class="ex-prose"><code>openvibe/auto</code> lets the router pick by your floor, ceiling and policy, and the answer says which model ran and why. An exact id pins one artifact. Bring your own provider key and those requests pay the provider directly, at no fee from us.</p>
${kit.table({ columns: [{ key: 'model', label: 'Model id', primary: true, html: true }, { key: 'context', label: 'Context', num: true }], rows, label: 'Model ids', stack: false })}
` })}
${panel({ title: 'Usage', note: 'Aggregate, from OpenVibe.AI: no prompt and no person.', id: 'usage', body: usage.unavailable ? kit.notice({ kind: 'info', text: 'Usage is not available right now.' }) : (usageRows.length ? kit.table({ columns: [{ key: 'day', label: 'Day', primary: true }, { key: 'requests', label: 'Requests' }, { key: 'tokens', label: 'Tokens' }, { key: 'cost', label: 'Cost' }], rows: usageRows, label: 'Usage by day', caption: 'The last 14 days, all products and people.', stack: false }) : kit.empty({ icon: 'spark', title: 'No requests yet', text: 'The first call through the endpoint will show here.' })) })}
${panel({ title: 'What it costs', body: '<p class="ex-prose">Every price is the offer\'s own, per million tokens, and the answer carries the exact cost of that run. A small free daily allowance comes with every account; it grows with account age and contribution. Paid use, when the owner turns money on, is at cost plus a margin and shown before the request.</p>' })}
</div>`;
}

/** 2832475 → "2.83M", 48210 → "48.2k": short enough that a four-column table fits a phone. */
function shortCount(n) {
    const v = Number(n) || 0;
    return v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(1)}k` : count(v);
}

/** A model id as people say it on the home: the dated snapshot suffix dropped, OpenAI's ids as OpenAI writes them
 *  ("gpt-5-nano-2025-08-07" → "GPT-5 nano"). The /ai page keeps the exact ids. */
function modelLabel(id) {
    const bare = String(id || '').replace(/-\d{4}-\d{2}-\d{2}$/, '');
    const known = { 'deepseek-chat': 'DeepSeek Chat', 'deepseek-reasoner': 'DeepSeek Reasoner', 'qwen2.5-1.5b-instruct': 'Qwen2.5 1.5B (local)' };
    return known[bare] || require('../ai').displayName(bare);
}

// ── Pooled machines ────────────────────────────────────────
// The pooled machines design (2026-11-06), part 4: "Pool your machines" under the single-machine card on /sell,
// and the pool's offer card. Exchange reads the person's machines, their pools, the link checks and the fit table
// from Network and AI; it never measures a link and never keeps a pool of its own. A number appears only when
// Node measured it; a model nobody measured says "not measured yet".
const NEAR_MS = 5;            // a pool needs under 5 ms round trip
const NEAR_MBPS = 300;        // 1 Gb/s for models over 30B; 300 Mb/s below
const gb = (mb) => (mb == null || !Number.isFinite(Number(mb)) ? '–' : `${(Number(mb) / 1024).toFixed(Number(mb) < 1024 ? 1 : 0)} GB`);
const poolLabel = (n) => `Community pool (${Number(n) || 0} machine${Number(n) === 1 ? '' : 's'})`;
const isPoolOffer = (o) => Boolean(o && (o.kind === 'pool' || (o.pool && Array.isArray(o.pool.machines)))) && Boolean(o.pool);

/** The public pool offers that serve a model: AI names the members only by pseudonym, so only the count is shown. */
function poolOffersFor(community, modelName) {
    return ((community && community.offers) || []).filter((o) => isPoolOffer(o) && (o.models || []).includes(modelName));
}

/** A link as Node measured it, in words: the number and the limit when it fails. Null when nobody measured it.
 *  Without an id, every link is read: the head answers over all of them, so its worst one is its own. */
function linkWords(links, id) {
    const mine = (links || []).filter((l) => l && (id == null || l.machine === id) && l.rtt_ms != null && l.mbps != null && Number.isFinite(Number(l.rtt_ms)) && Number.isFinite(Number(l.mbps)));
    if (!mine.length) return null;
    const slow = mine.find((l) => !(Number(l.rtt_ms) < NEAR_MS));
    if (slow) return { good: false, text: `${Math.round(Number(slow.rtt_ms))} ms; a pool needs under ${NEAR_MS} ms` };
    const thin = mine.find((l) => !(Number(l.mbps) >= NEAR_MBPS));
    if (thin) return { good: false, text: `${Math.round(Number(thin.mbps))} Mb/s; a pool needs ${NEAR_MBPS} Mb/s or more` };
    const best = mine.reduce((a, b) => (Number(a.rtt_ms) <= Number(b.rtt_ms) && Number(a.mbps) >= Number(b.mbps) ? a : b));
    return { good: true, text: `${Math.round(Number(best.rtt_ms))} ms, ${Math.round(Number(best.mbps))} Mb/s: good` };
}

/** The public card for a pool: the count and what it serves, never a machine's name. */
function communityPools(community) {
    const offers = ((community && community.offers) || []).filter(isPoolOffer);
    if (!offers.length) return '';
    const rows = offers.map((o) => ({
        pool: `${esc(poolLabel(o.pool.machines.length))}${o.free_only ? ` ${kit.badge('Free tier only', '')}` : ''}`,
        models: (o.models || []).map(String).join(', '),
        price: o.price ? `${money(o.price.in_per_million)} / ${money(o.price.out_per_million)} per million` : 'volunteer (free)',
        state: o.ready && o.open_now !== false ? 'offering now' : 'offline',
    }));
    return panel({
        title: 'Community pools', id: 'pools',
        note: 'One model served by several of a person’s machines on their own home network.',
        body: `${kit.table({ columns: [{ key: 'pool', label: 'Pool', primary: true, html: true }, { key: 'models', label: 'Serves' }, { key: 'price', label: 'Price' }, { key: 'state', label: 'State' }], rows, label: 'Community pools' })}
<p class="ex-prose">The pool’s head sees the prompt; the other machines see only numbers in transit. A new pool serves the free tier until the same canary checks as one machine pass.</p>`,
    });
}

/**
 * The pool's four steps (Opus's design, part 4). `pool` is what Network answered for this person:
 * { machines, candidates, pools, error }. A pool record may carry `links` and `fit`, Node's own measurements on
 * the head; when it does not, the page says "not measured yet" instead of inventing a number.
 */
function poolPanel({ pool, community }) {
    const active = (pool.pools || [])[0] || null;
    const machines = pool.machines || [];
    const byId = new Map(machines.map((m) => [m.id, m]));
    const nameOf = (id) => (byId.get(id) && byId.get(id).name) || 'your machine';
    const candidates = (pool.candidates || []).filter((c) => c && c.id);
    const links = (active && Array.isArray(active.links) ? active.links : pool.links) || [];

    const head = () => {
        if (active) return active.head;
        const same = candidates.filter((c) => c.network === mainKey);
        return ([...same].sort((a, b) => (Number(b.free_vram) || 0) - (Number(a.free_vram) || 0))[0] || {}).id || null;
    };
    // The network most of the machines are on: the one a pool would use. Another network is listed, greyed, with why.
    const groups = new Map();
    for (const c of candidates) {
        const k = String(c.network || 'unknown');
        groups.set(k, (groups.get(k) || []).concat([c]));
    }
    const mainKey = [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0] ? [...groups.entries()].sort((a, b) => b[1].length - a[1].length)[0][0] : null;
    const mainMachines = candidates.filter((c) => c.network === mainKey);
    const reference = [...mainMachines].sort((a, b) => (Number(b.free_vram) || 0) - (Number(a.free_vram) || 0))[0];
    const headId = head();
    const headMachine = candidates.find((c) => c.id === headId) || null;
    const headName = nameOf(headId);

    const row = (c, { selectable }) => {
        const sameNetwork = c.network === mainKey;
        // The head answers over every link, so its row reads the worst of them (all of them when it has no id of its own).
        const link = sameNetwork ? linkWords(links, c.id === headId ? null : c.id) : null;
        const detail = `${esc(c.hardware || 'hardware not reported')} · ${gb(c.free_vram)} free VRAM · ${gb(c.free_ram)} free RAM`;
        const linkLine = !sameNetwork
            ? `<p class="ex-pool-why">Not on the same network as ${esc(reference ? nameOf(reference.id) : 'your other machines')}: pools work on one home network, not across the internet</p>`
            : `<p class="ex-pool-link${link ? (link.good ? ' is-good' : ' is-bad') : ''}">${link ? esc(link.text) : 'link not measured yet'}</p>`;
        const pick = selectable && sameNetwork
            ? `<label class="ex-pool-pick"><input type="checkbox" name="machines" value="${esc(c.id)}" checked> <span><b>${esc(nameOf(c.id))}</b></span></label>`
            : `<div class="ex-pool-pick"><b>${esc(nameOf(c.id))}</b>${active && active.machines.some((m) => m.id === c.id && m.id === active.head) ? ' <span class="ex-kind">head</span>' : ''}</div>`;
        return `<li class="ex-pool-machine${sameNetwork ? '' : ' is-off'}">${pick}<p class="ex-pool-detail">${detail}</p>${linkLine}</li>`;
    };

    const steps = [];
    if (active) {
        // A pool is never edited: a change is a new pool with new approvals (Network's rule).
        const rows = active.machines.map((m) => {
            const c = candidates.find((x) => x.id === m.id);
            return c ? row(c, { selectable: false }) : `<li class="ex-pool-machine"><div class="ex-pool-pick"><b>${esc(nameOf(m.id))}</b></div><p class="ex-pool-detail">no longer announcing itself</p></li>`;
        }).join('');
        steps.push(`<article class="ex-pool-step"><h3 class="ex-pool-h">1. Choose the machines</h3>
<ul class="ex-pool-machines">${rows}</ul>
<p class="ex-pool-note">A pool is never edited: to change the head or the machines, stop it and pool again.</p>
<form method="post" action="/sell/pool/${encodeURIComponent(active.id)}/stop" class="ex-pool-stop">
<p class="ex-prose">The offer goes offline and each machine stops sharing its memory with the others.</p>
${kit.button({ label: 'Stop pooling', type: 'submit', kind: 'quiet' })}
</form></article>`);
    } else {
        const rows = candidates.map((c) => row(c, { selectable: true })).join('');
        const headOptions = mainMachines
            .sort((a, b) => (Number(b.free_vram) || 0) - (Number(a.free_vram) || 0))
            .map((c) => `<option value="${esc(c.id)}"${headMachine && c.id === headMachine.id ? ' selected' : ''}>${esc(nameOf(c.id))}${c.free_vram != null ? ` · ${gb(c.free_vram)} free VRAM` : ''}</option>`).join('');
        steps.push(`<article class="ex-pool-step"><h3 class="ex-pool-h">1. Choose the machines</h3>
<form method="post" action="/sell/pool" class="ex-pool-form">
<ul class="ex-pool-machines">${rows}</ul>
<label class="ex-field"><span>Head (the machine that answers)</span><select name="head">${headOptions}</select></label>
<p class="ex-pool-note">Each machine approves the pool on itself, in OpenVibe Link.</p>
${kit.button({ label: 'Pool these machines', type: 'submit' })}
</form></article>`);
    }

    // 2. What fits: only measured speeds; the head is the machine with the most free VRAM.
    const fit = (active && Array.isArray(active.fit) ? active.fit : []).filter((f) => f && f.model && f.fits !== false);
    const speedWords = (f) => (f.tokens_per_second != null && Number.isFinite(Number(f.tokens_per_second)) ? `about ${Math.round(Number(f.tokens_per_second))} tokens a second` : 'not measured yet');
    const fitBody = fit.length
        ? kit.table({ columns: [{ key: 'model', label: 'Model', primary: true }, { key: 'speed', label: 'Measured speed' }], rows: fit.map((f) => ({ model: String(f.model), speed: speedWords(f) })), label: 'What fits' })
        : '<p class="ex-prose">No model has been measured on these machines yet. Run the fit check on the head in OpenVibe Link; a model that has not been measured says so here.</p>';
    steps.push(`<article class="ex-pool-step"><h3 class="ex-pool-h">2. What fits</h3>
<p class="ex-pool-head">Head: <b>${esc(headName)}</b>, the machine with the most free VRAM.${active ? ' Change it on your machines page: a new head is a new pool, and every machine approves it.' : ''}</p>
${fitBody}</article>`);

    // 3. Approve on each machine.
    const members = active ? active.machines : [];
    const approval = members.length
        ? `<ul class="ex-pool-approvals">${members.map((m) => `<li class="ex-pool-approval"><span>${m.approved ? `<b>${esc(nameOf(m.id))}</b>` : `Waiting for approval on <b>${esc(nameOf(m.id))}</b>`}</span>${m.approved ? kit.badge('Approved', 'ok') : kit.badge('Waiting', '')}</li>`).join('')}</ul>
<p class="ex-pool-note">Approve in OpenVibe Link on that machine, or on its machine page on OpenVibe.Network.</p>`
        : '<p class="ex-prose">Approve on each machine, in OpenVibe Link or on its machine page on OpenVibe.Network. Each machine makes its own key there.</p>';
    steps.push(`<article class="ex-pool-step"><h3 class="ex-pool-h">3. Approve on each machine</h3>${approval}</article>`);

    // 4. Offer it: the same controls as a single machine, and nothing until every member approves.
    const allApproved = members.length >= 2 && members.every((m) => m.approved);
    const controls = `<dl class="ex-pool-controls">
<div><dt>Price</dt><dd>one price for the whole pool, set with the offer on the head in OpenVibe Link.</dd></div>
<div><dt>Who may use it</dt><dd>everyone, your followers or a group: the same audience as a single machine, applied to the pool.</dd></div>
<div><dt>Idle only</dt><dd>the whole pool pauses while any member is in use.</dd></div>
</dl>
<p class="ex-pool-note">Prompts reach your head machine (${esc(headName)}); the others only see numbers in transit.</p>`;
    steps.push(`<article class="ex-pool-step"><h3 class="ex-pool-h">4. Offer it</h3>${allApproved ? controls : '<p class="ex-prose">Nothing is offered until every member approves.</p>'}</article>`);

    return panel({
        title: 'Pool your machines', id: 'pool',
        body: `<p class="ex-prose">Machines on the same home network can run one bigger model together. OpenVibe checks the link between them first.</p>
<div class="ex-pool ex-pool-steps">${steps.join('')}</div>`,
    });
}

// ── Sell compute ───────────────────────────────────────────
const HOUSE_SERVER = /^local\d*$/;

function sellPage({ catalog, usage, pool = null, community = null, signedIn = false }) {
    // OpenVibe's own model servers on its hosts (`local`, `local2`) carry community trust so the router treats their
    // privacy conservatively, but nobody sells them: only machines people offer through Node are listed here.
    const offers = (catalog.models || []).flatMap((m) => m.offers.filter((o) => o.trust === 'community' && !HOUSE_SERVER.test(String(o.provider || ''))).map((o) => ({ model: m, offer: o })));
    const first = offers[0];
    const seller = first
        ? sellerCard({ machine: providerLabel(first.offer), model: first.model, offer: first.offer, example: false })
        : sellerCard({ machine: 'RTX 3090', model: { name: 'Qwen 32B', family: 'Qwen' }, offer: { speed: { p50_ms: 24 }, uptime: 0.994 }, example: true });
    const machineRows = offers.slice(0, 10).map(({ model, offer }) => ({
        model: `<a href="${hrefOf(model)}">${esc(model.name)}</a>`, provider: esc(providerLabel(offer)),
        price: offer.price ? `${money(offer.price.in)} / ${money(offer.price.out)}` : 'volunteer (free)',
        uptime: offer.uptime == null ? '–' : pct(offer.uptime),
    }));
    // The pool card sits under the single-machine one, only for a signed-in person. With fewer than two machines
    // it is one line and the install link (part 4 of the design).
    const poolSection = !signedIn || !pool ? '' : pool.error
        ? panel({ title: 'Pool your machines', id: 'pool', body: kit.notice({ kind: 'warn', text: esc(pool.error) }) })
        : (pool.candidates || []).length < 2
            ? panel({ title: 'Pool your machines', id: 'pool', body: `<p class="ex-prose">Pooling needs two or more of your machines on the same network. Add one with <a href="https://openvibe.link">OpenVibe Link</a>.</p>` })
            : poolPanel({ pool, community });
    return `<div class="ex-wrap ex-page">
${kit.head({ title: 'Sell your compute', sub: 'Turn a GPU or a spare machine into credits.', actions: [kit.button({ href: 'https://openvibe.link', label: 'Get Link', kind: 'quiet' })] })}
${panel({ title: 'A machine on the network', id: 'seller', body: `${seller}<p class="ex-prose">Every offer shows this card: the machine, what it runs, how fast it answers, its uptime, and whether it is verified.</p>` })}
${poolSection}
${panel({ title: 'Turn it on', body: `
<div class="ex-steps"><ol>
<li>Install <a href="https://openvibe.link">OpenVibe Link</a> on the machine and sign in.</li>
<li>Open the AI plugin, turn on <strong>Offer to the network</strong>, and pick the models it serves.</li>
<li>Set the hours, how many requests at once, a price (0 volunteers it), idle-only, and who may use it: everyone, your followers or a group.</li>
<li>Watch tokens served, credits and verification on this page.</li>
</ol></div>
<p>${kit.button({ href: 'https://openvibe.link', label: 'Install OpenVibe Link' })}</p>
<p class="ex-prose"><strong>Idle-only:</strong> it pauses while you game, stream or render, so the machine stays yours, and picks up again when you are done.</p>
<p class="ex-prose"><strong>Trust is earned:</strong> a new machine serves the free tier until it is verified by canary prompts with known answers, a fingerprint that proves the declared model and quantization, and spot re-runs (about 1% of requests) on a trusted machine. Uptime and latency build its reputation; verified tokens earn credits usable across OpenVibe.</p>
<p class="ex-prose"><strong>Privacy, said plainly:</strong> a community machine sees the prompt. Only requests that allow community capacity ever go there, and the answer is labelled Community.</p>
<p class="ex-prose"><strong>Kudos for volunteers:</strong> an offer at 0 earns kudos that never expire and buy queue priority and bigger free limits. Kudos are never cash.</p>` })}
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
    // No person's name: a seller card says what the machine is, never who owns it.
    const label = example ? `A spare ${machine}` : (/owner|volunteer|machine/i.test(String(machine)) ? 'A community machine' : `A community ${machine}`);
    return `<article class="ex-seller${example ? ' is-example' : ''}">
<span class="ex-mk ex-mk--machine" style="--ex-mk-size:36px" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 6h16v9H4zM8 19h8M12 15v4"/></svg></span>
<div><b>${esc(label)}</b>
<p>${esc(model.name)} · ${speed} · ${offer.uptime == null ? 'uptime not measured yet' : `${pct(offer.uptime)} uptime`}${example || offer.verified === true ? ' · verified' : ' · not verified yet'}</p></div>
${example ? '<span class="ex-badge-note">Example</span>' : ''}
</article>`;
}

// ── Uncensored ─────────────────────────────────────────────
function uncensoredPage({ catalog, adult, signedIn }) {
    const models = (catalog.models || []).filter((m) => m.uncensored);
    const gate = !signedIn
        ? kit.section({ title: 'Adults only', body: `<p class="ex-prose">The uncensored tier is for adults. Sign in first (the confirmation sits on your account), then confirm you are 18 or over.</p><p>${kit.button({ href: '/auth/login?next=%2Funcensored', label: 'Sign in with OpenVibe' })}</p>` })
        : !adult
            ? kit.section({ title: 'Confirm you are 18 or over', body: `<p class="ex-prose">Uncensored models are abliterated builds. They will answer what a filtered model refuses. The floor below applies to every request, and a breach ends the account.</p>${floorText()}<form method="post" action="/uncensored/confirm" class="ovk-form ex-confirm"><label class="ex-check ovk-check"><input type="checkbox" name="adult" value="yes" required> <span>I am 18 or over and I accept the floor.</span></label>${kit.button({ label: 'Confirm', type: 'submit' })}</form>` })
            : '';
    return `<div class="ex-wrap ex-page">
${kit.head({ title: 'Uncensored', sub: 'Abliterated models, for adults. The same floor, always.', actions: [kit.badge('18+', 'bad')] })}
${gate || ''}
${panel({ title: 'The floor on every offer, uncensored or not', id: 'floor', body: floorText(true) })}
${adult ? panel({ title: 'Uncensored models', id: 'models', body: modelList(models, { empty: 'No uncensored model is live right now. Featherless and Refuseless offers appear here when their keys are on.' }) }) : ''}
${panel({ title: 'How to use it', body: '<p class="ex-prose">Pick an uncensored model in <a href="https://openvibe.chat/vibe">chat</a>, or send its exact id to the API. Your 18+ confirmation sits on your account, so it follows you here; the floor applies to every request on this tier, and a breach ends the account.</p>' })}
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
/**
 * The model changelog: what the last two daily snapshots of the catalogue say. Three honest lists — arrived,
 * gone, repriced — each with the dates they were recorded. A single day recorded so far says so rather than
 * inventing a change.
 */
function changelogBody(changes) {
    if (!changes) return '<p class="ex-prose">The changelog could not be read right now.</p>';
    if (!changes.available) {
        return `<p class="ex-prose">${changes.from ? `The catalogue was first recorded on ${esc(changes.from)}.` : 'The catalogue has not been recorded yet.'} A model is listed as new, gone or repriced from the second day of snapshots.</p>`;
    }
    const block = (title, items, render) => (items.length
        ? `<h3 class="ex-h3">${esc(title)} <span class="ex-muted">${items.length}</span></h3><ul class="ex-changes">${items.map(render).join('')}</ul>`
        : '');
    const priceChange = (x) => `${x.was_in == null && x.was_out == null ? 'no price' : `${money(x.was_in)} in / ${money(x.was_out)} out`} → ${x.price_in == null && x.price_out == null ? 'free capacity' : `${money(x.price_in)} in / ${money(x.price_out)} out`}`;
    const where = (x) => (x.community ? 'a community machine' : (x.provider ? providerLabel({ provider: x.provider, provider_name: x.provider }) : ''));
    const added = block('New', changes.added, (x) => `<li><b>${esc(x.name)}</b>${x.family ? ` · <span class="ex-muted">${esc(x.family)}</span>` : ''}${where(x) ? ` on ${esc(where(x))}` : ''}${x.price_out == null ? '' : ` · ${money(x.price_out)} out per M`}</li>`);
    const repriced = block('Price changed', changes.repriced, (x) => `<li><b>${esc(x.name)}</b> · ${esc(priceChange(x))}</li>`);
    const gone = block('Gone', changes.gone, (x) => `<li><b>${esc(x.name)}</b>${where(x) ? ` <span class="ex-muted">on ${esc(where(x))}</span>` : ''}</li>`);
    const body = `${added}${repriced}${gone}` || '<p class="ex-prose">No model arrived, left or changed its price between the two recorded days.</p>';
    return `<p class="ex-muted">Between ${esc(changes.from)} and ${esc(changes.to)}, from the daily catalogue snapshot.</p>${body}`;
}

function statusPage({ catalog, usage, changes = null }) {
    const offers = chatModels(catalog).flatMap((m) => m.offers.map((o) => ({ m, o })));
    offers.sort((a, b) => (b.o.requests_7d || 0) - (a.o.requests_7d || 0));
    const rows = offers.slice(0, 40).map(({ m, o }) => ({
        model: `<a href="${hrefOf(m)}">${esc(m.name)}</a>`,
        provider: esc(providerLabel(o)),
        status: statusCell(o),
        uptime: o.uptime == null ? '<span class="ex-muted">no traffic</span>' : pct(o.uptime),
        traffic: count(o.requests_7d),
        speed: o.speed.p95_ms == null ? '–' : ms(o.speed.p95_ms),
        updated: o.updated_at ? String(o.updated_at).slice(0, 10) : '–',
    }));
    return `<div class="ex-wrap ex-page">
${kit.head({ title: 'Status', sub: 'Uptime per offer, the model changelog, and incidents.', actions: [kit.button({ href: '/models', label: 'Models', kind: 'quiet' })] })}
${unavailable(catalog, 'The status board')}
${panel({ title: 'Uptime per offer', note: 'Status is measured: down while an offer\'s circuit is open (with the plain reason), degraded when more than 5% of at least 10 requests in the last hour failed, up otherwise. Uptime is measured from real requests in the last seven days; an offer with no traffic has no uptime to show, and says so.', id: 'uptime', body: rows.length ? kit.table({ columns: [
        { key: 'model', label: 'Model', primary: true, html: true },
        { key: 'provider', label: 'Offer' },
        { key: 'status', label: 'Status', html: true },
        { key: 'uptime', label: 'Uptime', html: true },
        { key: 'traffic', label: 'Requests, 7 d' },
        { key: 'speed', label: 'p95' },
        { key: 'updated', label: 'Changed', hide: 'sm' },
    ], rows, label: 'Uptime per offer' }) : kit.empty({ icon: 'spark', title: 'No offers yet', text: 'Offers appear here when a provider key or a machine running Link is on.' }) })}
${panel({ title: 'Model changelog', note: 'Models that arrived, left or changed their price, from a daily snapshot of the catalogue. Never a guessed date.', id: 'changelog', body: changelogBody(changes) })}
${panel({ title: 'Incidents', id: 'incidents', body: catalog.unavailable || catalog.stale ? kit.notice({ kind: 'error', text: 'OpenVibe.AI is not answering right now, so these numbers are not live. Live prices and the catalog on the other pages say so too.' }) : '<p class="ex-prose">No incident recorded. When an offer goes down, a failover is used and the answer says so; here is where an outage is written down.</p>' })}
${panel({ title: 'Requests today', body: usage.unavailable ? '<p class="ex-prose">Usage is not reachable right now.</p>' : `<p class="ex-prose">${count(usage.today ? usage.today.requests : 0)} requests today, ${count(usage.today ? (usage.today.tokens_in || 0) + (usage.today.tokens_out || 0) : 0)} tokens.</p>` })}
</div>`;
}


// ── A person's default audience, on their product page (design rule 1) ──
const AUDIENCE_TEXT = { public: 'Everyone', link: 'Anyone with the link', people: 'Specific people', private: 'Only me' };
/**
 * "New chats: Only me ▾", with "Apply to all my existing chats". The Share sheet still changes one item; this is
 * only what the next one starts as.
 *   kind, label (plural noun), current, action, signedIn
 */
function audienceDefaults({ kind, label, current = 'private', action, signedIn = false }) {
    if (!signedIn) return '';
    const options = ['private', 'people', 'link', 'public']
        .map((a) => `<option value="${a}"${a === current ? ' selected' : ''}>${AUDIENCE_TEXT[a]}</option>`).join('');
    return `<form class="ex-share-defaults ovk-form" method="post" action="${esc(action)}">
<input type="hidden" name="kind" value="${esc(kind)}">
<label class="ex-label" for="share-default-${esc(kind)}">New ${esc(label)}</label>
<div class="ex-share-defaults-row">
<select id="share-default-${esc(kind)}" name="audience">${options}</select>
${kit.button({ label: 'Save', type: 'submit', kind: 'quiet' })}
<label class="ex-check ovk-check"><input type="checkbox" name="apply_all" value="1"> <span>Apply to all my existing ${esc(label)}</span></label>
</div>
<p class="ex-muted ex-small">The Share sheet on an item changes just that one. Only me until you choose otherwise.</p>
</form>`;
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

// ── Your own endpoint ──────────────────────────────────────
/**
 * The private GPU page. It shows what the endpoint is, the plain reason it is off when it is, and only
 * then the form. The live prices and models come from AI's public status; a person's endpoints come from
 * AI with their own Network token.
 */
function ownPage({ status = null, endpoints = [], quote = null, viewer = null, error = null, signedIn = false }) {
    const models = (status && status.models) || [];
    const off = !status || status.enabled !== true;
    const why = (status && (status.reason || (status.reasons || []).join(' '))) || 'The endpoint service is not reachable right now.';
    const modelOptions = models.map((m) => `<option value="${esc(m.key)}">${esc(m.display_name)}${m.vram_mb ? ` · ${Math.round(m.vram_mb / 1024)} GB` : ''}</option>`).join('');
    const statusWords = (e) => {
        const s = String(e.status || '');
        if (s === 'requested') return 'Starting: finding a GPU and taking the price for it.';
        if (s === 'starting') return 'Starting: the GPU is being set up.';
        if (s === 'running') return 'Running.';
        if (s === 'stopping') return 'Stopping.';
        if (s === 'stopped') return e.reason || 'Stopped.';
        if (s === 'refused') return e.reason || 'It could not start.';
        if (s === 'error') return e.reason || 'It stopped because the GPU did.';
        return s;
    };
    const row = (e) => {
        const perHour = e.price_per_hour == null ? 'the price is shown once a GPU is picked' : `$${Number(e.price_per_hour).toFixed(2)} an hour`;
        const charged = e.charged_nano && e.charged_nano !== '0' ? `$${(Number(e.charged_nano) / 1e9).toFixed(4)}` : null;
        const url = e.status === 'running' && e.url ? `<p class="ex-small ex-muted">Your endpoint: <code>${esc(e.url)}</code></p><p class="ex-small ex-muted">Only your own OpenVibe sign-in reaches it. The model id is <code>${esc(e.id)}</code>.</p>` : '';
        const stop = ['requested', 'starting', 'running', 'stopping'].includes(e.status)
            ? `<form method="post" action="/own/${encodeURIComponent(e.id)}/stop" class="ovk-form">${kit.button({ label: 'Stop', type: 'submit', kind: 'quiet' })}</form>` : '';
        return `<article class="ex-seller"><div><b>${esc(e.display_name)}</b>
<p>${esc(statusWords(e))} · ${esc(perHour)} · ${Number(e.idle_minutes)} idle minutes</p>${url}${charged ? `<p class="ex-small ex-muted">Paid from your Balance: ${esc(charged)}</p>` : ''}</div>${stop}</article>`;
    };
    const list = endpoints.length
        ? endpoints.map(row).join('')
        : kit.empty({ icon: 'spark', title: 'No endpoint yet', text: 'Pick a model below, or bring your own weights, and your private endpoint starts when a GPU is free.' });
    return `<div class="ex-wrap ex-page">
${kit.head({ title: 'Your own endpoint', sub: 'A private GPU for one model, or your own weights. It scales to zero when you stop using it.' })}
${error ? kit.notice({ kind: 'warn', text: esc(error) }) : ''}
${panel({ title: 'Compare before renting', id: 'quote', body: `<p class="ex-prose">A quote does not start a GPU or charge your Balance. Prices and availability can change before launch.</p>
<form method="get" action="/own/quote" class="ovk-form"><label for="quote-model">Model</label><select id="quote-model" name="model">${modelOptions}</select>
<label for="quote-strategy">Placement</label><select id="quote-strategy" name="strategy"><option value="cheapest">Cheapest</option><option value="fastest">Fastest</option><option value="automatic">Automatic across marketplaces</option><option value="private">Most private</option><option value="own">On my machine</option></select>${kit.button({ label: 'Get a quote', type: 'submit' })}</form>
${quote ? `<div role="status"><p>${quote.selected ? `${esc(quote.selected.marketplace)} · ${esc(quote.selected.gpu_name)} · ${esc(quote.selected.region)} · $${esc(quote.selected.price_per_hour)} per hour` : 'No eligible marketplace GPU.'}</p><p>${esc((quote.reasons || []).join(' · '))}</p><p>Base GPU price; storage and network charges may add to it. Quote only. Nothing was rented.</p></div>` : ''}
<p class="ex-small">Most private and On my machine require your Link machine or OpenVibe capacity; a private endpoint on a third-party GPU does not meet those placement rules. <a href="https://openvibe.link">Connect your machine</a>.</p>` })}

${off ? `<div class="ex-card"><div class="ex-sec-body">${kit.notice({ kind: 'warn', text: esc(why) })}<p class="ex-prose">It turns on when the owner adds a GPU provider key and a monthly cap in the admin panel, and turns Balance billing on. Nothing is rented before then.</p></div></div>` : ''}
${!off && !signedIn ? `${kit.notice({ kind: 'info', text: 'Sign in to start a private endpoint.' })}<p>${kit.button({ href: '/auth/login?next=%2Fown', label: 'Sign in' })}</p>` : ''}
${!off ? `${panel({ title: 'Pick a model', id: 'model', body: models.length ? `<p class="ex-prose">The GPU is yours alone: only your own sign-in can call it, and it is never listed as an offer. The price is the cheapest GPU that fits, per hour; you pay your Balance for the seconds it runs.</p>
<form method="post" action="/own" class="ovk-form">
<label class="ex-label" for="own-model">Model</label>
<select id="own-model" name="model">${modelOptions}</select>
<label for="own-strategy">Placement</label><select id="own-strategy" name="strategy"><option value="cheapest">Cheapest</option><option value="automatic">Automatic across marketplaces</option><option value="fastest">Fastest</option></select>
<label class="ex-label" for="own-idle">Stop after this many idle minutes</label>
<input id="own-idle" name="idle_minutes" type="number" min="1" max="${Number(status.max_idle_minutes || 120)}" value="${Number(status.idle_minutes || 10)}">
<p class="ex-small ex-muted">How long it stays up after your last request. Lower costs less; higher avoids a cold start.</p>
${signedIn ? kit.button({ label: 'Start my endpoint', type: 'submit' }) : ''}
</form>` : kit.empty({ icon: 'robot', title: 'No GPU model is listed', text: 'The owner has not made a model available for a private endpoint yet.' }) })}
${panel({ title: 'Or bring your own weights', id: 'weights', body: `<p class="ex-prose">A Hugging Face <code>.gguf</code> file and, if you use one, a LoRA. Only files from huggingface.co: the command is built for you and shown to the owner before the first launch.</p>
<form method="post" action="/own" class="ovk-form">
<label class="ex-label" for="own-repo">Weights repository</label>
<input id="own-repo" name="weights_repo" placeholder="user/model-GGUF" autocapitalize="off" spellcheck="false">
<label class="ex-label" for="own-file">Weights file</label>
<input id="own-file" name="weights_file" placeholder="model-Q4_K_M.gguf" autocapitalize="off" spellcheck="false">
<label class="ex-label" for="own-lora-repo">LoRA repository (optional)</label>
<input id="own-lora-repo" name="lora_repo" placeholder="user/my-lora-GGUF" autocapitalize="off" spellcheck="false">
<label class="ex-label" for="own-lora-file">LoRA file (optional)</label>
<input id="own-lora-file" name="lora_file" placeholder="adapter.gguf" autocapitalize="off" spellcheck="false">
<label class="ex-label" for="own-name">Name (optional)</label>
<input id="own-name" name="display_name" placeholder="My fine-tune">
${signedIn ? kit.button({ label: 'Start with my weights', type: 'submit' }) : ''}
</form>` })}
${panel({ title: 'How it works', id: 'how', body: `<ul class="ex-list">
<li><strong>Private.</strong> The GPU is never registered as an offer; only your own OpenVibe sign-in reaches it, through <code>${esc((status && status.public_base) || 'https://ai.openvibe.services/api/v1/own-endpoints')}/&lt;id&gt;/v1</code>.</li>
<li><strong>Scale to zero.</strong> After your idle minutes it is given back, and the price stops with it.</li>
<li><strong>Your Balance pays.</strong> Billing holds the worst case before the GPU is rented and charges only the seconds it ran. The owner's monthly GPU cap is checked first: at the cap, no new endpoint starts.</li>
</ul>` })}
${panel({ title: 'Your endpoints', id: 'mine', body: signedIn ? list : kit.empty({ icon: 'lock', title: 'Sign in to see your endpoints', text: 'They belong to your account.' }) })}` : ''}
</div>`;
}

// ── Start building, why this model, and the questions (moved from ai.openvibe.services) ──
/**
 * The AI site's start-building guide, on Exchange: one endpoint and a key, the SDKs people already use, the
 * four steps, and the OpenVibe.AI developer-app path that stays on ai.openvibe.services for the six operations.
 * Every URL and limit here is one the products serve; nothing is invented.
 */
function startPage({ catalog = null } = {}) {
    const models = chatModels(catalog || {});
    const python = [
        '# pip install openai',
        'import os',
        'from openai import OpenAI',
        '',
        "client = OpenAI(base_url='https://api.openvibe.exchange/v1',",
        "                api_key=os.environ['OPENVIBE_KEY'])",
        'reply = client.chat.completions.create(',
        "    model='openvibe/auto',          # the router picks; reply.model names the one that ran",
        "    messages=[{'role': 'user', 'content': 'Name three uses for a paperclip.'}],",
        ')',
        'print(reply.model, reply.choices[0].message.content)',
    ].join('\n');
    const node = [
        '// npm i openai',
        "import OpenAI from 'openai';",
        '',
        "const client = new OpenAI({ baseURL: 'https://api.openvibe.exchange/v1', apiKey: process.env.OPENVIBE_KEY });",
        'const stream = await client.chat.completions.create({',
        "    model: 'openvibe/auto', stream: true,",
        "    messages: [{ role: 'user', content: 'Name three uses for a paperclip.' }],",
        '});',
        "for await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta?.content ?? '');",
    ].join('\n');
    const anthropic = [
        'export ANTHROPIC_BASE_URL=https://api.openvibe.exchange',
        'export ANTHROPIC_AUTH_TOKEN=$OPENVIBE_KEY',
        '# Claude Code, or any Anthropic client, now speaks to /v1/messages',
    ].join('\n');
    const token = [
        'TOKEN=$(curl -s -X POST https://openvibe.network/oauth/token \\',
        '  -d grant_type=client_credentials -d client_id=$APP -d client_secret=$SECRET \\',
        '  -d audience=openvibe.ai | jq -r .access_token)',
        '# a five-minute token for an app (app_<ULID>), scoped to its project',
    ].join('\n');
    const chat = [
        'curl -s -X POST https://ai.openvibe.services/api/v1/chat \\',
        '  -H "Authorization: Bearer $TOKEN" -H \'Content-Type: application/json\' \\',
        '  -d \'{ "messages": [ { "role": "user", "content": "Name three uses for a paperclip." } ] }\'',
        '# → { "run": { "id": "run_…", "status": "succeeded", "output": …, "provenance": …, "explain": … } }',
    ].join('\n');
    return `<div class="ex-wrap ex-page">
${kit.head({ title: 'Start building', sub: 'One endpoint, a key, and every answer says which model ran and why.', actions: [kit.button({ href: '/api', label: 'Keys and the API', kind: 'quiet' })] })}
${panel({ title: 'The endpoint', id: 'endpoint', body: `<p class="ex-prose"><code>${ENDPOINT}</code> speaks OpenAI's Chat Completions, and <code>https://api.openvibe.exchange/v1/messages</code> speaks Anthropic's Messages API. Point an OpenAI client at <code>https://api.openvibe.exchange/v1</code>; the model's page has its own curl and SDK sample.</p>
${kit.snippet({ code: `curl ${ENDPOINT} \\\n  -H "Authorization: Bearer $OPENVIBE_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"openvibe/auto","messages":[{"role":"user","content":"Hello"}]}'`, id: 'start-curl' })}
<p class="ex-prose">A key is an OpenVibe.Network developer key: make one, name its scope, revoke it any time. It is shown once and never stored here.</p>
<p>${kit.button({ href: 'https://openvibe.network/developers', label: 'Make a key on Network' })} ${kit.button({ href: '/own', label: 'Your own endpoint', kind: 'quiet' })}</p>` })}
${panel({ title: 'Four steps', id: 'steps', body: `<ol class="ex-list">
<li><strong>Make a key</strong> at <a href="https://openvibe.network/developers">openvibe.network/developers</a>. It is a developer key for your project, and it is shown once.</li>
<li><strong>Point a client at the endpoint</strong>: <code>https://api.openvibe.exchange/v1</code> for OpenAI, or <code>https://api.openvibe.exchange</code> for Anthropic's <code>/v1/messages</code>.</li>
<li><strong>Send one request</strong> with <code>model: "openvibe/auto"</code>, or an exact model id from <a href="/models">Models</a> to pin one artifact.</li>
<li><strong>Read the receipt</strong>: every answer names the model that ran, its tokens, its exact cost, and why the router chose it. <a href="/why">Why this model</a> shows how to read it; a run's own page is <code>https://ai.openvibe.services/runs/&lt;id&gt;</code> after you sign in with OpenVibe.</li>
</ol>` })}
${panel({ title: 'Use the OpenAI SDK you already have', id: 'sdk', body: `<p class="ex-prose">The same request in Python, in Node with streaming, or from an Anthropic client. The answer's <code>model</code> names the model that ran.</p>
${kit.snippet({ code: python, id: 'start-python' })}
${kit.snippet({ code: node, id: 'start-node' })}
${kit.snippet({ code: anthropic, id: 'start-anthropic' })}` })}
${panel({ title: 'The six operations, for OpenVibe.AI apps', id: 'ai-apps', body: `<p class="ex-prose">OpenVibe.AI's own operations stay at <code>https://ai.openvibe.services</code> for developer apps: chat, generate, summarize, classify, extract and embed, with JSON output on a schema. They authenticate with an app token from OpenVibe.Network for the audience <code>openvibe.ai</code>.</p>
${kit.snippet({ code: token, id: 'start-token' })}
${kit.snippet({ code: chat, id: 'start-chat' })}
<p class="ex-prose">The same router answers both: Exchange's endpoint and AI's six operations use one catalog, one set of offers and one explanation. <a href="https://openvibe.services/projects">Create a project and an app</a> · <a href="https://openvibe.services/docs/api">API reference</a> · <a href="https://github.com/OpenVibers/OpenVibe.AI#developer-apps">Developer guide</a>.</p>` })}
${panel({ title: 'Sandbox and production', id: 'sandbox', body: `<p class="ex-prose">OpenVibe.AI developer apps run in one of two environments; the token says which one an app is in.</p>
${kit.table({ columns: [{ key: 'limit', label: 'Limit', primary: true }, { key: 'sandbox', label: 'Sandbox' }, { key: 'production', label: 'Production' }], rows: [
        { limit: 'Access to ai.app.run', sandbox: 'Every sandbox app, without asking', production: 'Once OpenVibe staff add it to the project' },
        { limit: 'Models', sandbox: 'Free and local capacity only', production: 'Free and local capacity; metered models open with project budgets' },
        { limit: 'Your project’s own provider', sandbox: 'On /v1/chat/completions, keyed by a project secret granted to ai', production: 'The same' },
        { limit: 'Free allowance', sandbox: 'Per project, per provider', production: 'Per project, per provider' },
        { limit: 'Who can read a run', sandbox: 'The project that made it', production: 'The project that made it' },
        { limit: 'A person’s own provider key', sandbox: 'Never used', production: 'Never used' },
    ], label: 'Sandbox and production', stack: true })}` })}
${panel({ title: 'Keys, endpoints and questions', id: 'more', body: `<p class="ex-prose">Part of <a href="https://openvibe.services/">OpenVibe Services</a>: the building blocks every OpenVibe product runs on, with one console, one account and one SDK.${models.length ? ` ${models.length} model${models.length === 1 ? '' : 's'} are on sale here right now.` : ''}</p>
<p>${kit.button({ href: '/api', label: 'Keys and the API' })} ${kit.button({ href: '/own', label: 'Your own endpoint', kind: 'quiet' })} ${kit.button({ href: '/privacy/keys', label: 'Your keys and accounts', kind: 'quiet' })} ${kit.button({ href: '/faq', label: 'Questions', kind: 'quiet' })}</p>` })}
</div>`;
}

const EXPLAIN_WHY = [
    'The router starts from the offers that can do the job and are healthy right now.',
    'It ranks them by the objective you asked for: cheapest, fastest, balanced, or private.',
    'Your floor, price ceiling and privacy policy remove the offers that do not fit; a hard cap refuses instead of spending over it.',
    'A provider that is down, out of balance or too slow is skipped and written down; a fallback that answers is named on the run.',
];

/** One run's full explain, as AI recorded it: objective, reasons, the answer, and every candidate with its reason. */
function explainPanel(result) {
    const x = (result && result.explain) || {};
    const candidates = Array.isArray(x.candidates) ? x.candidates : [];
    const reasons = Array.isArray(x.reasons) ? x.reasons : [];
    const selected = x.selected || (result && result.provider ? `${result.provider}${result.model ? `/${result.model}` : ''}` : null);
    const rows = candidates.map((c) => ({
        offer: `<code>${esc(c.provider || '—')}${c.model ? `/${esc(c.model)}` : ''}</code>`,
        eligible: c.eligible === false ? kit.badge('not used', 'bad') : kit.badge('candidate', 'ok'),
        cost: c.cost == null ? '—' : `$${Number(c.cost) < 0.01 ? Number(c.cost).toFixed(6) : Number(c.cost).toFixed(4)}`,
        latency: c.latency == null ? '—' : ms(c.latency),
        why: c.eligible === false ? esc(c.excluded_reason || 'excluded by the route') : '—',
    }));
    return `<article class="ex-why-answer">
<header class="ex-answer-head"><b>${esc(result.model || selected || 'The answer')}</b><span class="ex-answer-cost">${result.cost_usd == null ? '—' : Number(result.cost_usd) === 0 ? 'free' : `$${Number(result.cost_usd).toFixed(6)}`}${result.latency_ms == null ? '' : ` · ${ms(result.latency_ms)}`}</span></header>
${result.content ? `<div class="ex-answer-body"><p class="ex-answer-text">${esc(result.content)}</p></div>` : ''}
<dl class="ex-why-facts">
<dt>Chosen</dt><dd>${esc(selected || '—')}${result.provider ? ` · ${esc(providerLabel({ provider: result.provider, provider_name: result.provider }))}` : ''}</dd>
<dt>Objective</dt><dd>${esc(x.objective || 'balanced')}</dd>
<dt>Tokens</dt><dd>${count(result.tokens_in)} in · ${count(result.tokens_out)} out</dd>
${result.cached_input_percent == null ? '' : `<dt>Cached input</dt><dd>${result.cached_input_percent}% (${count(result.tokens_cached)} tokens)</dd>`}
<dt>Privacy</dt><dd>${esc(result.privacy || '—')}</dd>
</dl>
${reasons.length ? `<h3 class="ex-h3">Why</h3><ul class="ex-list">${reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
${rows.length ? `<h3 class="ex-h3">Every candidate</h3>${kit.table({ columns: [{ key: 'offer', label: 'Offer', primary: true, html: true }, { key: 'eligible', label: 'State', html: true }, { key: 'cost', label: 'Estimated cost' }, { key: 'latency', label: 'Estimated latency' }, { key: 'why', label: 'Why not', html: true }], rows, label: 'Every candidate the router considered', stack: true })}` : ''}
<p class="ex-small ex-muted">${result.run_id ? `Run <code>${esc(result.run_id)}</code> · ` : ''}The full receipt is on OpenVibe.AI after you sign in with OpenVibe: <a href="https://ai.openvibe.services/runs/${esc(result.run_id || '')}">ai.openvibe.services/runs/${esc(result.run_id || '<id>')}</a>.</p>
</article>`;
}

/**
 * /why: the "why this model" explainer. Signed out, it explains the rule and shows the live offers. A signed-in
 * person can ask one question; the answer is a real AI run, and the page prints the run's own explain. It never
 * invents a reason: every line is from the run or from the catalog.
 */
function whyPage({ catalog = null, viewer = null, result = null, problem = null, text = '' }) {
    const signedIn = viewer && viewer.kind === 'user' && viewer.subject;
    const offers = (catalog && catalog.models ? chatModels(catalog) : []).flatMap((m) => (m.offers || []).map((o) => ({ m, o })));
    const sample = offers.filter((x) => x.o.price).sort((a, b) => blended(a.o.price) - blended(b.o.price)).slice(0, 6);
    const sampleRows = sample.map(({ m, o }) => ({
        model: `<a href="${hrefOf(m)}">${esc(m.name)}</a>`,
        offer: esc(providerLabel(o)),
        price: `${money(o.price.in)} in / ${money(o.price.out)} out`,
        speed: `${ms(o.speed.p50_ms)} p50 · ${ms(o.speed.p95_ms)} p95`,
        uptime: o.uptime == null ? '—' : pct(o.uptime),
    }));
    const form = signedIn
        ? `<form method="post" action="/why" class="ovk-form ex-why-form">
<label class="ex-label" for="why-text">One question</label>
<textarea id="why-text" name="text" rows="3" maxlength="2000" placeholder="Ask anything…">${esc(text)}</textarea>
<p class="ex-small ex-muted">One run on your free allowance, or your Balance when it is spent. The router chooses the offer; the page shows its receipt.</p>
${kit.button({ label: 'Ask and see why', type: 'submit' })}</form>`
        : `<div class="ex-why-gate">${kit.empty({ icon: 'key', title: 'Sign in to ask one question', text: 'The demo is one real run on your own allowance. Signed out, the rule and the live offers are below.', action: { href: '/auth/login?next=%2Fwhy', label: 'Sign in with OpenVibe' } })}</div>`;
    return `<div class="ex-wrap ex-page">
${kit.head({ title: 'Why this model', sub: 'Every answer carries its receipt: what the router optimised, who answered, and why the others did not.', actions: [kit.button({ href: '/models', label: 'Models', kind: 'quiet' })] })}
${panel({ title: 'The rule', id: 'rule', body: `<ol class="ex-list">${EXPLAIN_WHY.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>
<p class="ex-prose">It is the same router behind every Chat answer, every model page and every call to the endpoint; the receipt on a run is the router's own explanation, not a copy written for the page.</p>` })}
${problem ? kit.notice({ kind: 'warn', text: esc(problem) }) : ''}
${result ? explainPanel(result) : ''}
${panel({ title: result ? 'Ask another' : 'Try it', id: 'try', body: form })}
${panel({ title: 'The live offers it is choosing between', id: 'offers', note: 'The cheapest priced offers in the catalog right now, with their measured speed and uptime.', body: sampleRows.length ? kit.table({ columns: [{ key: 'model', label: 'Model', primary: true, html: true }, { key: 'offer', label: 'Offer' }, { key: 'price', label: 'In / out per M' }, { key: 'speed', label: 'Speed' }, { key: 'uptime', label: 'Uptime' }], rows: sampleRows, label: 'Live offers', stack: true }) : kit.empty({ icon: 'spark', title: 'No priced offer right now', text: 'When an offer is live, it appears here with its price, speed and uptime.' }) })}
${panel({ title: 'Read it in the API', id: 'api', body: `<p class="ex-prose">Every run response carries <code>explain</code>: the objective, the selected offer, the reasons, and every candidate with its estimated cost, latency and excluded reason. <code>GET /api/v1/runs/:id</code> on OpenVibe.AI returns the same object for a run you own.</p>
${kit.snippet({ code: `curl -s https://ai.openvibe.services/api/v1/runs/$RUN \\\n  -H "Authorization: Bearer $TOKEN" | jq .run.explain`, id: 'why-curl' })}
<p class="ex-more">Keys and the endpoint: <a href="/api">the API</a> · Start building: <a href="/start">four steps</a>.</p>` })}
</div>`;
}

// The questions developers ask, merged: OpenVibe.AI's own six (word for word where the fact is unchanged) and the
// questions this Exchange gets. Every answer is a fact the code keeps; a change here changes the FAQPage JSON-LD too.
const FAQ = [
    { q: 'What is OpenVibe.Exchange for?', a: 'Every AI model, one account: the live price, speed and uptime of every offer, chat with one model or three side by side, and one OpenAI- and Anthropic-compatible endpoint. The public pages of OpenVibe.AI live here now; its API stays at ai.openvibe.services.' },
    { q: 'Can I use the OpenAI SDK?', a: 'Yes. Set the client’s base URL to https://api.openvibe.exchange/v1 and pass your OpenVibe.Network developer key as the API key. Chat Completions with tools and streaming work, and each answer names the model that ran.' },
    { q: 'Can I use Claude Code or Anthropic’s SDK?', a: 'Yes. Point ANTHROPIC_BASE_URL at https://api.openvibe.exchange and use the same key as ANTHROPIC_AUTH_TOKEN; the host speaks Anthropic’s Messages API at /v1/messages.' },
    { q: 'Which models can my app use?', a: 'Every model on the Models page. openvibe/auto lets the router pick by your floor, ceiling and policy; an exact id pins one artifact; a preset name such as @preset/private fixes the rule. Every answer says which offer ran and why.' },
    { q: 'How is AI paid for?', a: 'Each offer’s own price per million tokens, and every answer carries the exact cost of that run. A small free daily allowance comes with every account. Bring your own provider key and those requests pay the provider directly, at no fee from us; paid use, when the owner turns money on, is at cost plus a margin and shown before the request.' },
    { q: 'Does it keep my prompts?', a: 'That depends on the offer. Each offer shows the provider’s data policy (training, retention, region) and a privacy label. Turn on strict privacy and only an offer that keeps nothing and trains on nothing may answer; when none can, the router refuses instead of falling back to one that keeps or trains on the prompt.' },
    { q: 'Who can read a run?', a: 'Only the account that made it. A run’s receipt is on OpenVibe.AI at /runs/<id> after an OpenVibe sign-in, and only the person the run was made for can read it. Exchange keeps a chat and the 18+ confirmation; it does not store prompts or answers for the public pages.' },
    { q: 'Where are my keys?', a: 'Keys are OpenVibe.Network developer keys: make one, name its scope, and revoke it any time at openvibe.network/developers. They are shown once and never stored here.' },
    { q: 'Can I sell compute?', a: 'Yes, through OpenVibe Link: offer a GPU or a spare machine to the network for credits. Machines and pools are what is sold; personal subscription plans and personal API keys are not. Every offer is labelled on the answer.' },
    { q: 'What is the uncensored tier?', a: 'Abliterated models for adults. The 18+ confirmation sits on your account, and the same floor applies to every request on the tier: no minors, no non-consensual content, no help with mass harm. A breach ends the account.' },
    { q: 'Is ai.openvibe.services still a site of its own?', a: 'No. Its public pages redirect here, and its page list, price page, update log and operator console are on OpenVibe.Exchange. The API stays there for OpenVibe’s services and developer apps.' },
    { q: 'Where did AI’s prices and latency page go?', a: 'The live numbers are on Models and each model’s page: price in, out and cached per million tokens, measured p50 and p95 speed, uptime and the free allowance. The status page keeps the per-offer uptime and the model changelog.' },
];

function faqPage() {
    return `<div class="ex-wrap ex-page">
${kit.head({ title: 'Questions', sub: 'The answers developers and people ask, with where the fact lives.', actions: [kit.button({ href: '/start', label: 'Start building', kind: 'quiet' })] })}
${panel({ title: 'Questions developers ask', id: 'faq', body: `<div class="ex-faq">${FAQ.map((p) => kit.fold({ title: p.q, body: `<p class="ex-prose">${esc(p.a)}</p>` })).join('')}</div>` })}
${panel({ title: 'Still building', id: 'next', body: `<p>${kit.button({ href: '/start', label: 'Start building' })} ${kit.button({ href: '/api', label: 'Keys and the API', kind: 'quiet' })} ${kit.button({ href: 'https://openvibe.help/tickets/new', label: 'Get help', kind: 'quiet' })}</p>` })}
</div>`;
}

module.exports = { audienceDefaults, home, modelsPage, modelPage, apiPage, startPage, whyPage, faqPage, FAQ, sellPage, uncensoredPage, aiPage, ownPage, statusPage, retired, sealedChat, privacyOf, answerPrivacy, providerLabel, familyLabel, chatModels, ENDPOINT };
