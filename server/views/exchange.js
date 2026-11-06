'use strict';

/**
 * The Exchange pages, built from openvibe-shared/kit: the home with live numbers, the model list and a
 * model's page (every offer, the try box, curl and the SDK), the API page, selling compute, the
 * uncensored tier and "AI in OpenVibe". Every number comes from the AI read API (server/ai.js); when
 * that read is unavailable the page says so and shows no invented figure.
 */
const kit = require('openvibe-shared/kit');
const { esc, raw } = require('../render/html');

const ENDPOINT = 'https://api.openvibe.exchange/v1/chat/completions';
const SDK = '@openvibe/sdk';

const money = (n, free = false) => (free ? 'free' : n == null ? '–' : n === 0 ? '$0' : `$${Number(n) < 0.1 ? Number(n).toPrecision(2) : Number(n).toFixed(2)}`);
const inOut = (price) => (price ? `${money(price.in)} in · ${money(price.out)} out` : 'no per-token price');
const ms = (n) => (n == null ? '–' : n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`);
const pct = (n) => (n == null ? '–' : `${(n * 100).toFixed(1)}%`);
const count = (n) => (n == null ? '–' : Number(n).toLocaleString('en-US'));
const blended = (price) => (price ? (Number(price.in) + Number(price.out)) / 2 : Number.POSITIVE_INFINITY);
const cheapest = (m) => (m.offers || []).filter((o) => o.price).sort((a, b) => blended(a.price) - blended(b.price))[0] || null;
const hrefOf = (m) => `/m/${String(m.slug).split('/').map(encodeURIComponent).join('/')}`;
const providerCount = (catalog) => new Set((catalog.models || []).flatMap((m) => m.offers.map((o) => o.provider))).size;
const offerCount = (catalog) => (catalog.models || []).reduce((n, m) => n + m.offers.length, 0);

function unavailable(catalog, what = 'The live catalog') {
    if (!catalog.unavailable && !catalog.stale) return '';
    return kit.notice({ kind: 'warn', text: `${what} is not reachable right now. Prices and speeds are read live from OpenVibe.AI; reload in a moment.` });
}

function modelRow(m, { showRequests = true } = {}) {
    const best = cheapest(m);
    const badges = [
        m.uncensored ? kit.badge('18+', 'bad') : '',
        m.community ? kit.badge('community', 'accent') : '',
        m.capabilities && m.capabilities.vision ? kit.badge('vision') : '',
        m.capabilities && m.capabilities.tools ? kit.badge('tools') : '',
    ].join('');
    const sub = best
        ? `${best.provider_name} · ${inOut(best.price)}`
        : `${m.offers[0] ? m.offers[0].provider_name : 'OpenVibe'} · ${m.offers[0] && m.offers[0].free ? 'free capacity' : 'no listed price'}`;
    const trail = showRequests
        ? `<span class="ex-trail"><b>${m.requests_7d ? count(m.requests_7d) : '0'}</b><small>7d</small></span>`
        : '';
    return kit.row({
        href: hrefOf(m), mark: kit.mark({ name: m.name }), title: m.name, badge: badges,
        sub, trail,
    });
}

function modelList(models, { empty = 'No model matches yet.', showRequests = true } = {}) {
    if (!models.length) return kit.empty({ icon: 'spark', title: 'Nothing here yet', text: empty });
    return kit.list(models.map((m) => modelRow(m, { showRequests })));
}

// ── Home ───────────────────────────────────────────────────
function home({ catalog, usage, viewer, q = '' }) {
    const models = catalog.models || [];
    const paid = models
        .map((m) => ({ m, o: cheapest(m) }))
        .filter((x) => x.o)
        .sort((a, b) => blended(a.o.price) - blended(b.o.price));
    const popular = [...models].sort((a, b) => (b.requests_7d || 0) - (a.requests_7d || 0)).slice(0, 6);
    const cheap = paid.slice(0, 6);
    const uncensored = models.filter((m) => m.uncensored).slice(0, 6);
    const community = models.filter((m) => m.community).slice(0, 6);
    const bestPrice = paid[0] && paid[0].o;
    const today = usage.today || null;

    const stats = [];
    if (today) stats.push([today.requests, 'requests today']);
    if (models.length) stats.push([models.length, 'models, one account']);
    if (offerCount(catalog)) stats.push([offerCount(catalog), `offers from ${providerCount(catalog)} providers`]);
    if (bestPrice) stats.push([`$${Number(bestPrice.price.in).toFixed(2)}`, `cheapest in, per million`]);

    return `<section class="ex-hero">
<p class="ex-kicker">OpenVibe.Exchange</p>
<h1>Every AI model, one account.</h1>
<p class="ex-lead">DeepSeek, Qwen, Kimi, GLM, MiniMax, Llama and the uncensored builds: the live price, speed and uptime of every offer, one OpenAI-compatible endpoint, and a chat that puts two or three models side by side.</p>
${kit.find({ action: '/models', name: 'q', placeholder: 'Find a model: DeepSeek, Qwen, Kimi, GLM…', value: q, icon: 'search' })}
<p class="ex-hero-actions">${kit.button({ href: '/models', label: 'All models' })} ${kit.button({ href: '/chat', label: 'Open chat', kind: 'quiet' })} ${kit.button({ href: '/api', label: 'The API', kind: 'ghost' })}</p>
</section>
${unavailable(catalog)}
${stats.length ? `<div class="ex-wrap">${kit.stats(stats)}</div>` : ''}
<div class="ex-grid">
${kit.section({ title: 'Popular now', note: 'By real requests in the last seven days.', id: 'popular', body: modelList(popular, { empty: 'No requests yet. The first one will show up here.' }) })}
${kit.section({ title: 'Cheapest per million tokens', note: 'The lowest input and output price among live offers.', id: 'cheapest', body: modelList(cheap.map((x) => x.m), { empty: 'No priced offer is live yet.' }) })}
${kit.section({ title: 'Uncensored', note: 'Abliterated models, adults only. The hard floor holds on every offer.', id: 'uncensored', body: `${modelList(uncensored, { empty: 'No uncensored model is live right now.' })}<p class="ex-more"><a href="/uncensored">How the 18+ tier and the floor work →</a></p>` })}
${kit.section({ title: 'Run on people’s machines', note: 'Community GPUs through OpenVibe Node. Labelled on every answer.', id: 'community', body: `${modelList(community, { empty: 'No community machine is offering capacity yet. <a href="/sell">Offer yours</a>.' })}<p class="ex-more"><a href="/sell">Turn a GPU into credits →</a></p>` })}
</div>
${kit.section({ title: 'Use it from code', note: 'One endpoint, compatible with OpenAI and with Anthropic.', id: 'code', body: `
<p class="ex-prose">Point an OpenAI client at <code>https://api.openvibe.exchange/v1</code>, or Claude Code at its <code>/v1/messages</code>. Model ids are <code>deepseek/deepseek-chat</code>, or <code>openvibe/auto</code> to let the router pick by your floor, ceiling and policy.</p>
${kit.snippet({ code: `curl ${ENDPOINT} \\\n  -H "Authorization: Bearer $OPENVIBE_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"deepseek/deepseek-chat","messages":[{"role":"user","content":"Hello"}]}'`, id: 'home-curl' })}
<p class="ex-more"><a href="/api">Keys, usage and the full reference →</a></p>` })}
${kit.section({ title: 'AI in OpenVibe', note: 'Which products run which models, and what each costs a day.', id: 'products', body: productsSummary(usage) })}
`;
}

function productsSummary(usage) {
    const products = usage.by_product || [];
    if (usage.unavailable) return kit.notice({ kind: 'info', text: 'Product usage is read from OpenVibe.AI and is not available right now.' });
    if (!products.length) return kit.empty({ icon: 'code', title: 'No product has run a model yet', text: 'When one does, its models and daily cost show here and on <a href="/ai">AI in OpenVibe</a>.' });
    const rows = products.slice(0, 5).map((p) => {
        const top = (p.models || []).slice(0, 2).map((m) => m.model || m.provider).filter(Boolean).join(', ');
        return kit.row({
            href: '/ai', mark: kit.mark({ name: p.product }), title: p.product,
            sub: top ? `runs ${top}` : 'runs models through OpenVibe.AI',
            trail: `<span class="ex-trail"><b>${count(p.requests)}</b><small>requests</small></span>`,
        });
    });
    return kit.list(rows);
}

// ── Models ─────────────────────────────────────────────────
function modelsPage({ catalog, q = '', family = '', sort = '' }) {
    let models = catalog.models || [];
    const families = (catalog.families || []).map((f) => f.name);
    if (family) models = models.filter((m) => m.family === family);
    if (q) {
        const needle = String(q).toLowerCase();
        models = models.filter((m) => `${m.name} ${m.family} ${m.slug} ${m.offers.map((o) => o.provider_name).join(' ')}`.toLowerCase().includes(needle));
    }
    if (sort === 'cheap') models = [...models].sort((a, b) => blended((cheapest(a) || { price: null }).price) - blended((cheapest(b) || { price: null }).price));
    else if (sort === 'fast') models = [...models].sort((a, b) => (cheapest(a) ? cheapest(a).speed.p50_ms || 1e9 : 1e9) - (cheapest(b) ? cheapest(b).speed.p50_ms || 1e9 : 1e9));
    else models = [...models].sort((a, b) => (b.requests_7d || 0) - (a.requests_7d || 0));

    const links = [['All', '/models'], ['Cheapest', '/models?sort=cheap'], ['Fastest', '/models?sort=fast']].map(([label, href]) => `<a class="ex-chip${(sort === 'cheap' && href.includes('cheap')) || (sort === 'fast' && href.includes('fast')) || (!sort && href === '/models') ? ' is-on' : ''}" href="${href}">${label}</a>`).join('');
    const familyLinks = families.slice(0, 10).map((f) => `<a class="ex-chip${f === family ? ' is-on' : ''}" href="/models?family=${encodeURIComponent(f)}">${esc(f)}</a>`).join('');

    return `${kit.head({ title: 'Models', sub: `${models.length} model${models.length === 1 ? '' : 's'} · ${offerCount(catalog)} offers, live`, actions: [kit.button({ href: '/chat', label: 'Chat', icon: 'chat', kind: 'quiet' })] })}
<div class="ex-wrap">
${kit.find({ action: '/models', name: 'q', placeholder: 'Find a model or a provider', value: q, icon: 'search' })}
<div class="ex-chips" role="group" aria-label="Sort">${links}</div>
${families.length ? `<div class="ex-chips" role="group" aria-label="Family">${familyLinks}</div>` : ''}
${unavailable(catalog)}
${modelList(models, { empty: 'No model matches that search. Try a family (DeepSeek, Qwen, Kimi, GLM) or a provider.' })}
</div>`;
}

// ── One model ──────────────────────────────────────────────
function modelPage({ model, viewer, result = null, problem = null, text = '', adult = false }) {
    const offers = model.offers || [];
    const best = cheapest(model);
    const badges = [
        model.uncensored ? kit.badge('18+', 'bad') : '',
        model.community ? kit.badge('community', 'accent') : '',
    ].join('');
    const stats = [
        best ? [money(best.price.in), 'cheapest in, per M'] : ['–', 'price'],
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
        { key: 'policy', label: 'Data policy', html: true },
        { key: 'try', label: 'Try', html: true },
    ];
    const rows = offers.map((o) => ({
        provider: `<a class="ex-offer-name" href="#try">${esc(o.provider_name)}</a>${o.trust === 'community' ? ` ${kit.badge('community', 'accent')}` : ''}${o.access && o.access !== 'UNVERIFIED' && o.access !== 'OWN_DEPLOYMENT' ? ` ${kit.badge(o.access.toLowerCase().replace(/_/g, ' '))}` : ''}`,
        price: o.price ? `<b>${money(o.price.in)}</b> / ${money(o.price.out)}` : '<span class="ex-muted">free capacity</span>',
        speed: `${ms(o.speed.p50_ms)} <small>p50</small> · ${ms(o.speed.p95_ms)} <small>p95</small>`,
        uptime: o.uptime == null ? '–' : pct(o.uptime),
        policy: policyText(o.data_policy),
        try: `<a class="ex-mini" href="#try">Try it</a>`,
    }));

    const canTry = viewer && viewer.kind === 'user' && viewer.subject;
    const blocked = model.uncensored && !adult;
    const tryBox = blocked
        ? kit.card({ tone: 'wait', icon: 'shield', title: 'This is an uncensored model', text: 'Adults only, with the floor. Confirm you are 18 or over to use it.', html: `<p><a class="ovk-btn ovk-btn--primary" href="/uncensored">Read the floor and confirm</a></p>` })
        : canTry
            ? `<form class="ovk-form ex-try" method="post" action="${hrefOf(model)}/try">
${problem ? kit.notice({ kind: 'error', text: problem }) : ''}
<label class="ex-label" for="try-text">Try ${esc(model.name)}</label>
<textarea id="try-text" name="text" rows="4" maxlength="4000" required placeholder="Ask it anything. The answer is one run on your own allowance.${model.uncensored ? ' The floor applies.' : ''}">${esc(text)}</textarea>
<div class="ex-try-row">${kit.button({ label: 'Send', type: 'submit' })}<span class="ex-muted">Free daily allowance; the run's cost is shown with the answer.</span></div>
</form>
${result ? resultCard(result) : ''}`
            : `<div class="ex-signin">${kit.button({ href: `/auth/login?next=${encodeURIComponent(hrefOf(model))}`, label: 'Sign in to try it' })}<span class="ex-muted">Free daily allowance, no card.</span></div>`;

    const modelId = (best && best.id) || `${model.canonical}`;
    const code = `curl ${ENDPOINT} \\\n  -H "Authorization: Bearer $OPENVIBE_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"${modelId}","messages":[{"role":"user","content":"Hello"}]}'`;
    const sdk = `import OpenAI from 'openai';\nconst ai = new OpenAI({ baseURL: 'https://api.openvibe.exchange/v1', apiKey: process.env.OPENVIBE_KEY });\nconst r = await ai.chat.completions.create({ model: '${modelId}', messages: [{ role: 'user', content: 'Hello' }] });`;

    return `${kit.head({ title: model.name, sub: `${model.family}${model.variant ? ` · ${model.variant}` : ''} · ${offers.length} offer${offers.length === 1 ? '' : 's'}`, back: { href: '/models', label: 'Models' }, actions: badges ? [badges] : [] })}
<div class="ex-wrap">
${stats.length ? `<div class="ex-wrap">${kit.stats(stats)}</div>` : ''}
${model.description ? `<p class="ex-prose">${esc(model.description)}</p>` : ''}
${kit.section({ title: 'Every offer that serves it', note: 'Price in, out and cached per million tokens; speed and uptime from the last seven days of real requests; the provider’s data policy.', id: 'offers', body: kit.table({ columns, rows, label: `Offers for ${model.name}`, empty: 'No live offer serves this model right now.' }) })}
${kit.section({ title: 'Try it', id: 'try', body: tryBox })}
${kit.section({ title: 'Use it from code', id: 'code', body: `${kit.snippet({ code, id: 'model-curl' })}
${kit.snippet({ code: sdk, id: 'model-sdk' })}
<p class="ex-more">The endpoint, keys and usage: <a href="/api">the API</a>.</p>` })}
</div>`;
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
    return kit.receipt({
        title: result.model ? `${result.model} answered` : 'The answer',
        body: `<div class="ex-answer">${esc(result.content || '(no text)')}</div>`,
        facts: [
            ['Provider', result.provider || '–'],
            ['Cost', result.cost_usd == null ? '–' : `$${Number(result.cost_usd).toFixed(6)}`],
            ['Run', result.run_id || '–'],
        ],
    });
}

// ── API ────────────────────────────────────────────────────
function apiPage({ catalog, usage }) {
    const models = (catalog.models || []).filter((m) => !m.uncensored).slice(0, 12);
    const rows = models.map((m) => ({ model: `<code>${esc(m.slug)}</code>`, family: esc(m.family), context: m.context || null }));
    const byDay = (usage.by_day || []).slice(-14).reverse();
    const usageRows = byDay.map((d) => ({ day: d.day, requests: count(d.requests), tokens: count((d.tokens_in || 0) + (d.tokens_out || 0)), cost: d.cost_usd == null ? '–' : `$${Number(d.cost_usd).toFixed(4)}` }));
    return `${kit.head({ title: 'The API', sub: 'One endpoint. OpenAI and Anthropic compatible.', actions: [kit.button({ href: '/chat', label: 'Chat', icon: 'chat', kind: 'quiet' })] })}
<div class="ex-wrap">
${kit.section({ title: 'One endpoint', body: `
<p class="ex-prose"><code>${ENDPOINT}</code> speaks OpenAI's Chat Completions; <code>https://api.openvibe.exchange/v1/messages</code> speaks Anthropic's Messages API, so Claude Code works by pointing <code>ANTHROPIC_BASE_URL</code> at it.</p>
${kit.snippet({ code: `curl ${ENDPOINT} \\\n  -H "Authorization: Bearer $OPENVIBE_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"openvibe/auto","messages":[{"role":"user","content":"Hello"}]}'`, id: 'api-curl' })}
<h3 class="ex-h3">Keys</h3>
<p class="ex-prose">Keys are OpenVibe.Network developer keys: make one, name its scope, and revoke it any time. They are shown once and never stored here.</p>
<p>${kit.button({ href: 'https://openvibe.network/developers', label: 'Make a key on Network' })}</p>
<h3 class="ex-h3">Model ids</h3>
<p class="ex-prose"><code>openvibe/auto</code> lets the router pick by your floor, ceiling and policy, and the answer says which model ran and why. An exact id pins one artifact. Bring your own provider key and those requests pay the provider directly.</p>
${kit.table({ columns: [{ key: 'model', label: 'Model', primary: true, html: true }, { key: 'family', label: 'Family' }, { key: 'context', label: 'Context', num: true }], rows, label: 'Model ids' })}
` })}
${kit.section({ title: 'Usage', note: 'Aggregate, from OpenVibe.AI: no prompt and no person.', id: 'usage', body: usage.unavailable ? kit.notice({ kind: 'info', text: 'Usage is not available right now.' }) : (usageRows.length ? kit.table({ columns: [{ key: 'day', label: 'Day', primary: true }, { key: 'requests', label: 'Requests' }, { key: 'tokens', label: 'Tokens' }, { key: 'cost', label: 'Cost' }], rows: usageRows, label: 'Usage by day', caption: 'The last 14 days, all products and people.' }) : kit.empty({ icon: 'spark', title: 'No requests yet', text: 'The first call through the endpoint will show here.' })) })}
${kit.section({ title: 'What it costs', body: `<p class="ex-prose">Every price is the offer's own, per million tokens, and the answer carries the exact cost of that run. A small free daily allowance comes with every account; it grows with account age and contribution. Paid use, when the owner turns money on, is at cost plus a margin and shown before the request.</p>` })}
</div>`;
}

// ── Sell compute ───────────────────────────────────────────
function sellPage({ catalog, usage }) {
    const offers = (catalog.models || []).flatMap((m) => m.offers.filter((o) => o.trust === 'community').map((o) => ({ model: m, offer: o })));
    const communityRows = offers.slice(0, 10).map(({ model, offer }) => ({
        model: `<a href="${hrefOf(model)}">${esc(model.name)}</a>`, provider: esc(offer.provider_name),
        price: offer.price ? `${money(offer.price.in)} / ${money(offer.price.out)}` : 'volunteer (free)',
        uptime: offer.uptime == null ? '–' : pct(offer.uptime),
    }));
    return `${kit.head({ title: 'Sell your compute', sub: 'Turn a GPU or a spare machine into credits.', actions: [kit.button({ href: 'https://openvibe.node', label: 'Get Node', kind: 'quiet' })] })}
<div class="ex-wrap">
${kit.section({ title: 'Turn it on', body: `
<p class="ex-prose">Install <a href="https://openvibe.node">OpenVibe Node</a> on the machine, open the AI plugin, and turn on <strong>Offer to the network</strong>. Choose the models it serves, the hours, how many requests at once, a price (0 to volunteer), and who may use it: everyone, your followers, or a group.</p>
<p class="ex-prose">A new machine serves the free tier until it is trusted: canary prompts with known answers, a model fingerprint that proves the declared model and quantization, and spot re-runs (about 1% of requests) compared on a trusted machine. Uptime and latency build your reputation score. Verified tokens earn credits, usable across OpenVibe.</p>
<div class="ex-steps"><ol><li>Install Node and sign in.</li><li>Open the AI plugin and pick the models it can serve.</li><li>Set hours, concurrency, price and who may use it.</li><li>Watch tokens served, earnings and verification on this page.</li></ol></div>
<p>${kit.button({ href: 'https://openvibe.node', label: 'Install OpenVibe Node' })}</p>` })}
${kit.section({ title: 'Your dashboard', id: 'dashboard', body: kit.empty({ icon: 'spark', title: 'No machine offered yet', text: 'When Node is offering capacity, its tokens served, credits, uptime, verification and reputation show here.' }) })}
${kit.section({ title: 'What is not sold here', note: 'Said plainly, because it gets accounts banned elsewhere.', id: 'not-sold', body: `
<ul class="ex-list">
<li><strong>Personal subscription plans</strong> (Codex, ChatGPT, Claude, MiniMax and others). Their terms make them personal, and pooled accounts get banned. A plan works for its owner on their own machine, through <a href="https://openvibe.codes">OpenVibe.Codes</a>.</li>
<li><strong>Personal API keys.</strong> A key serves its owner only, never a pool.</li>
<li><strong>What is sold:</strong> compute people own, and capacity OpenVibe buys under terms that allow resale.</li>
</ul>
<p class="ex-prose">A contributor's offer obeys the same content floor as every offer here. An offer that breaks it is removed, and so is the account.</p>` })}
${kit.section({ title: 'Machines on the network now', id: 'community', body: communityRows.length ? kit.table({ columns: [{ key: 'model', label: 'Model', primary: true, html: true }, { key: 'provider', label: 'Machine' }, { key: 'price', label: 'In / out per M' }, { key: 'uptime', label: 'Uptime' }], rows: communityRows, label: 'Community offers', empty: 'No community machine is offering capacity yet.' }) : kit.empty({ icon: 'robot', title: 'No community capacity yet', text: 'Be the first: the owner’s own machine is off by default, and volunteers set the free tier.' }) })}
</div>`;
}

// ── Uncensored ─────────────────────────────────────────────
function uncensoredPage({ catalog, adult, signedIn }) {
    const models = (catalog.models || []).filter((m) => m.uncensored);
    const gate = !signedIn
        ? kit.section({ title: 'Adults only', body: `<p class="ex-prose">The uncensored tier is for adults. Sign in first (the confirmation sits on your account), then confirm you are 18 or over.</p><p>${kit.button({ href: '/auth/login?next=%2Funcensored', label: 'Sign in with OpenVibe' })}</p>` })
        : !adult
            ? kit.section({ title: 'Confirm you are 18 or over', body: `<p class="ex-prose">Uncensored models are abliterated builds. They will answer what a filtered model refuses. The floor below applies to every request, and a breach ends the account.</p>${floorText()}<form method="post" action="/uncensored/confirm" class="ovk-form ex-confirm"><label class="ex-check"><input type="checkbox" name="adult" value="yes" required> <span>I am 18 or over and I accept the floor.</span></label>${kit.button({ label: 'Confirm', type: 'submit' })}</form>` })
            : '';
    return `${kit.head({ title: 'Uncensored', sub: 'Abliterated models, for adults. The same floor, always.', actions: [kit.badge('18+', 'bad')] })}
<div class="ex-wrap">
${gate}
${kit.section({ title: 'The floor on every offer, uncensored or not', id: 'floor', body: floorText(true) })}
${adult || !signedIn ? kit.section({ title: 'Uncensored models', id: 'models', body: modelList(models, { empty: 'No uncensored model is live right now. Featherless and Refuseless offers appear here when their keys are on.' }) }) : ''}
${kit.section({ title: 'How to use it', body: `<p class="ex-prose">Pick an uncensored model in <a href="/chat">chat</a>, or send its exact id to the API. Your 18+ confirmation sits on your account, so it follows you here; the floor applies to every request on this tier, and a breach ends the account.</p>` })}
</div>`;
}

function floorText(listOnly = false) {
    const body = `<ul class="ex-list ex-floor">
<li>No sexual content involving minors.</li>
<li>No non-consensual sexual content of real people.</li>
<li>No help with weapons of mass harm or attacks on others.</li>
</ul><p class="ex-prose">A breach ends the account. This is not a suggestion a model may talk its way past; it is the condition of being here.</p>`;
    return listOnly ? `<div class="ex-floor-box">${body}</div>` : `<div class="ex-floor-box">${body}</div>`;
}

// ── AI in OpenVibe ─────────────────────────────────────────
function aiPage({ catalog, usage }) {
    const products = usage.by_product || [];
    const rows = products.map((p) => ({
        product: esc(p.product),
        models: (p.models || []).slice(0, 4).map((m) => `<code>${esc(m.model || m.provider)}</code>`).join(' ') || '–',
        requests: count(p.requests),
        tokens: count((p.tokens_in || 0) + (p.tokens_out || 0)),
        cost: p.cost_usd == null ? '–' : `$${Number(p.cost_usd).toFixed(4)}`,
    }));
    const days = usage.days ? Math.max(1, usage.days) : 30;
    const perDay = (n) => (n == null ? '–' : `$${(Number(n) / days).toFixed(4)}`);
    return `${kit.head({ title: 'AI in OpenVibe', sub: 'One layer for every product: the same router, offers, failover and prices.', actions: [kit.button({ href: '/models', label: 'Models', kind: 'quiet' })] })}
<div class="ex-wrap">
${usage.unavailable ? kit.notice({ kind: 'info', text: 'Usage is not reachable right now.' }) : ''}
${kit.section({ title: 'Who runs what', note: `Requests in the last ${days} days, from OpenVibe.AI.`, id: 'products', body: rows.length ? kit.table({ columns: [
        { key: 'product', label: 'Product', primary: true },
        { key: 'models', label: 'Models', html: true },
        { key: 'requests', label: 'Requests' },
        { key: 'tokens', label: 'Tokens', hide: 'sm' },
        { key: 'cost', label: 'Cost, 30 d' },
    ], rows, label: 'Product usage', caption: 'A product names its quality floor, price ceiling and policy; the router does the rest.' }) : kit.empty({ icon: 'spark', title: 'No product has run a model yet', text: 'Products appear here the first time they call the router.' }) })}
${kit.section({ title: 'What each product gets', body: `
<ul class="ex-list">
<li>the same offers and failover as this site;</li>
<li>its own quality floor, price ceiling and content policy;</li>
<li>usage and cost, per product, per day;</li>
<li>no product keeps its own provider keys or its own model list.</li>
</ul>
<p class="ex-prose">Watch, Actor, Codes, Live, Blog, News, Wiki, Vision, Bench, Space, Help, Food and Trade call the same router with their service token. The numbers above are read from AI's daily rollup, never from a prompt or a person.</p>` })}
${kit.section({ title: 'The cost, per day', body: usage.totals ? `<p class="ex-prose">${count(usage.totals.requests)} requests and ${count((usage.totals.tokens_in || 0) + (usage.totals.tokens_out || 0))} tokens over ${days} days, at about ${perDay(usage.totals.cost_usd)} a day across the network.</p>` : '<p class="ex-prose">Cost is not available right now.</p>' })}
</div>`;
}

// ── Retired v1 ─────────────────────────────────────────────
function retired(pathName) {
    return `<div class="ex-wrap ex-narrow">
${kit.empty({
        icon: 'spark', title: 'This part of Exchange is retired',
        text: `“${pathName}” was Exchange v1: free and swap listings for agents, templates, themes and game assets. Exchange is now the network's AI: every model, one account.`,
    })}
${kit.section({ title: 'Where those things live now', body: `<ul class="ex-list">
<li>Agents and MCP tools: <a href="https://openvibe.codes">OpenVibe.Codes</a> and <a href="https://openvibe.network">Connect</a>.</li>
<li>Templates: <a href="https://openvibe.space">OpenVibe.Space</a> and <a href="https://openvibe.report">OpenVibe.Report</a>.</li>
<li>Themes: <a href="https://openvibe.design">OpenVibe.Design</a>.</li>
<li>Every AI model, with live prices and chat: <a href="/">the new Exchange</a>.</li>
</ul><p class="ex-prose">v1's tables are kept read-only for their owners; nothing new is written to them.</p>` })}
</div>`;
}

module.exports = { home, modelsPage, modelPage, apiPage, sellPage, uncensoredPage, aiPage, retired, ENDPOINT };
