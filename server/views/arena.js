'use strict';

/**
 * The Arena and the rankings, built from openvibe-shared/kit in the site's one container.
 *
 *   /arena          one prompt, two models, blind: ask, vote, then both names and their receipts
 *   /arena/:id      the pair the person asked, their vote, and what it was counted as
 *   /rankings       Bench's board by task category beside AI's price, speed and uptime, and the value column
 *
 * The same rule as the rest of Exchange: a number is shown only when a read gave it. A missing price stays a
 * dash; an unavailable board says so, and no figure is invented.
 */
const kit = require('openvibe-shared/kit');
const { esc } = require('../render/html');
const { mark, product, productMark } = require('./marks');
const { providerLabel, familyLabel } = require('./exchange');

const money = (n) => (n == null ? '–' : Number(n) === 0 ? 'free' : `$${Number(n) < 0.1 ? Number(n).toPrecision(2) : Number(n).toFixed(2)}`);
const ms = (n) => (n == null ? '–' : n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`);
const pct = (n) => (n == null ? '–' : `${(n * 100).toFixed(1)}%`);
const count = (n) => (n == null ? '–' : Number(n).toLocaleString('en-US'));
const blended = (price) => (price ? (Number(price.in) + Number(price.out)) / 2 : Number.POSITIVE_INFINITY);
const cheapest = (m) => (m.offers || []).filter((o) => o.price).sort((a, b) => blended(a.price) - blended(b.price))[0] || null;

const CATEGORY_LABELS = {
    all: 'All', code: 'Code', writing: 'Writing', chat: 'Chat', reasoning: 'Reasoning',
    translation: 'Translation', analysis: 'Analysis',
};
const labelOf = (c) => CATEGORY_LABELS[c] || (c ? c.charAt(0).toUpperCase() + c.slice(1) : 'Chat');

function unavailable(what) {
    return kit.notice({ kind: 'warn', text: `${what} is not reachable right now. Reload in a moment.` });
}

function panel({ title, note = '', id, body, cls = '' }) {
    return kit.section({ title, note, id, cls: `ex-card${cls ? ` ${cls}` : ''}`, body: `<div class="ex-sec-body">${body}</div>` });
}

// ── The Arena ──────────────────────────────────────────────
function arenaHome({ viewer, catalog, rounds = [], problem = null, config, defaults = '' }) {
    const signedIn = viewer && viewer.kind === 'user' && viewer.subject;
    const models = (catalog.models || []).filter((m) => !m.uncensored);
    const ask = signedIn
        ? `<form class="ovk-form ex-arena-form" method="post" action="/arena/ask">
${problem ? kit.notice({ kind: 'error', text: problem }) : ''}
<label class="ex-label" for="arena-prompt">Your prompt</label>
<textarea id="arena-prompt" name="prompt" rows="4" maxlength="${config.arena.maxChars}" required placeholder="Ask anything: explain a concept, write something, debug a snippet, compare two options…"></textarea>
<div class="ex-arena-form-row">${kit.button({ label: 'Send to two models', type: 'submit' })}<span class="ex-muted">Two runs on your own free allowance. ${config.arena.perDay} arena prompts a day.</span></div>
</form>`
        : `<div class="ex-signin">${kit.button({ href: `/auth/login?next=${encodeURIComponent('/arena')}`, label: 'Sign in to ask' })}<span class="ex-muted">Two models answer blind; your vote is yours.</span></div>`;

    const recent = rounds.length
        ? `<ul class="ex-arena-recent">${rounds.map((r) => `<li><a href="/arena/${esc(r.id)}"><span>${esc(r.prompt.length > 90 ? `${r.prompt.slice(0, 90)}…` : r.prompt)}</span><small>${esc(labelOf(r.category))} · ${esc(String(r.created_at).slice(0, 10))}</small></a></li>`).join('')}</ul>`
        : '';

    return `<div class="ex-wrap ex-page">
${kit.head({ title: 'The Arena', sub: 'One prompt, two models, side by side and unnamed. You pick. Then both names and their receipts.', actions: [kit.button({ href: '/rankings', label: 'Rankings', kind: 'quiet', icon: 'trophy' })] })}
${catalog.unavailable ? unavailable('The live model catalogue') : ''}
${panel({ title: 'Ask one question', note: 'The router picks two models from the free tier or the live catalogue. You never see which is which until you vote.', id: 'ask', body: ask })}
${panel({ title: 'How it works', id: 'how', body: `<ol class="ex-list ex-arena-steps">
<li><strong>Two answers, no names.</strong> The same prompt runs on two models and you see only the words, side by side.</li>
<li><strong>You vote once.</strong> Left, right, a tie, or both bad. One vote per person per round, and a second is refused.</li>
<li><strong>Then the reveal.</strong> Both names, the offer that answered, the price of the run, its speed and the router's reason.</li>
<li><strong>It counts.</strong> Your vote is an OpenVibe.Bench human_pairwise judgement, filed under the kind of work your prompt asked for: code, writing, chat, reasoning, translation or analysis.</li>
</ol><p class="ex-prose">The rankings put those ratings beside the price per million tokens, the measured speed and the uptime, so “worth it” is visible. One vote is one sample: the board marks a model provisional until it has enough games.</p>
<p class="ex-prose"><strong>It is public.</strong> An arena prompt and both answers are recorded in Bench's open arena dataset, without your name, so anyone can check a vote. Do not paste anything private.</p>` })}
${recent ? panel({ title: 'Your last rounds', id: 'recent', body: recent }) : ''}
${defaults}
${models.length ? `<p class="ex-muted ex-arena-count">${models.length} models in the catalogue; two are chosen for each prompt.</p>` : ''}
</div>`;
}

function answerColumn({ side, answer, model, revealed }) {
    const letter = side === 'left' ? 'A' : 'B';
    const head = revealed && model
        ? `<header class="ex-arena-head">${mark(familyLabel(model), { size: 22, label: false })}<b>${esc(model.name)}</b>${model.answered_model && model.answered_model !== model.model_id ? `<span class="ex-muted">${esc(model.answered_model)}</span>` : ''}</header>`
        : `<header class="ex-arena-head"><span class="ex-arena-letter">${letter}</span><b>Model ${letter}</b></header>`;
    const receipt = revealed && model
        ? `<details class="ex-receipt ex-arena-receipt"><summary>Receipt</summary><dl>
<dt>Offer</dt><dd>${esc(providerLabel({ provider: model.provider, provider_name: model.provider_name }))}</dd>
<dt>Price</dt><dd>${model.cost_usd == null ? '–' : Number(model.cost_usd) === 0 ? 'free' : `$${Number(model.cost_usd).toFixed(6)}`}${model.price ? ` · ${money(model.price.in)} in / ${money(model.price.out)} out per M` : ''}</dd>
<dt>Tokens</dt><dd>${count(model.tokens_in)} in · ${count(model.tokens_out)} out</dd>
<dt>Latency</dt><dd>${ms(model.latency_ms)}</dd>
<dt>Why this offer</dt><dd>${Array.isArray(model.why) && model.why.length ? esc(model.why.join(' · ')) : 'The router picked the healthiest offer for the person’s floor and ceiling.'}</dd>
</dl></details>`
        : '';
    return `<article class="ex-arena-answer" data-side="${esc(side)}"${revealed ? ` data-model="${esc(model ? model.slug : '')}"` : ''}>
${head}
<div class="ex-arena-text">${esc(answer || '(no text)').replace(/\n/g, '<br>')}</div>
${receipt}
</article>`;
}

function arenaRound({ round, vote = null, revealed = false, problem = null, config, shared = false, action = '' }) {
    const [left, right] = round.models || [];
    const voted = Boolean(vote);
    const outcome = vote ? vote.outcome : null;
    const voteForm = shared
        ? `<p class="ex-muted">This round was shared with you${
            round.shared_by ? ` by <strong>${esc(round.shared_by)}</strong>` : ''}. Its owner voted; only their vote counts.</p>`
        : voted
        ? `<p class="ex-arena-voted">${kit.badge(outcome === 'left' ? 'You chose A' : outcome === 'right' ? 'You chose B' : outcome === 'tie' ? 'You called it a tie' : 'You said both were bad', 'ok')} It is counted. ${kit.button({ href: '/arena', label: 'Ask another', kind: 'quiet' })}</p>`
        : `<form class="ex-arena-vote" method="post" action="/arena/${esc(round.id)}/vote">
${problem ? kit.notice({ kind: 'error', text: problem }) : ''}
<fieldset><legend>Which answer is better?</legend>
<div class="ex-arena-vote-row">
<button type="submit" name="outcome" value="left" class="ovk-btn ovk-btn--primary">A is better</button>
<button type="submit" name="outcome" value="right" class="ovk-btn ovk-btn--primary">B is better</button>
<button type="submit" name="outcome" value="tie" class="ovk-btn ovk-btn--quiet">It’s a tie</button>
<button type="submit" name="outcome" value="both_bad" class="ovk-btn ovk-btn--ghost">Both bad</button>
</div></fieldset>
<p class="ex-muted">One vote per person. It becomes a Bench judgement under “${esc(labelOf(round.category))}”, and the names are revealed right after.</p>
</form>`;

    return `<div class="ex-wrap ex-page">
${kit.head({ title: shared ? 'A shared Arena round' : voted ? 'Your vote, revealed' : 'Which one is better?', sub: shared ? `Filed under ${labelOf(round.category)}. One prompt, two answers, both names and receipts.` : `Filed under ${labelOf(round.category)}. One prompt, two answers, no names until you vote.`, back: { href: '/arena', label: 'Arena' }, actions: action ? [action] : [] })}
${panel({ title: 'Your prompt', id: 'prompt', body: `<p class="ex-arena-prompt">${esc(round.prompt).replace(/\n/g, '<br>')}</p><p class="ex-muted">${kit.badge(labelOf(round.category))} ${voted ? '' : 'The models are unnamed until you vote.'}</p>` })}
${panel({ title: 'Two answers', id: 'pair', body: `<div class="ex-arena-grid" data-count="2">
${answerColumn({ side: 'left', answer: left && left.answer, model: left, revealed, index: 0 })}
${answerColumn({ side: 'right', answer: right && right.answer, model: right, revealed, index: 1 })}
</div>${voteForm}` })}
${voted && !shared ? panel({ title: 'What it counted as', id: 'counted', body: `<p class="ex-prose">This vote is a <strong>Bench human_pairwise judgement</strong> for your account, in the <strong>${esc(labelOf(round.category))}</strong> category. It moves both models' Elo on <a href="/rankings?category=${encodeURIComponent(round.category)}">the rankings</a>, beside their price per million and their measured speed and uptime.</p>` }) : ''}
</div>`;
}

// ── Rankings ───────────────────────────────────────────────
function indexModels(models) {
    const map = new Map();
    const add = (key, model) => { if (key && !map.has(key)) map.set(key, model); };
    for (const m of models) {
        add(m.slug, m);
        add(m.canonical, m);
        for (const o of m.offers || []) add(o.id, m);
    }
    return map;
}

function rankingsPage({ catalog, usage, board, category, sort, categories }) {
    const models = (catalog.models || []).filter((m) => !m.uncensored);
    const byKey = indexModels(models);
    const rowsFor = (board.rows || []).filter((r) => r.games > 0).map((r) => {
        const model = byKey.get(r.subject) || null;
        const offer = model ? cheapest(model) : null;
        const priceOut = offer && offer.price ? Number(offer.price.out) : null;
        const priceIn = offer && offer.price ? Number(offer.price.in) : null;
        const value = priceOut && priceOut > 0 ? Math.max(0, Number(r.elo) - 1000) / priceOut : null;
        return {
            subject: r.subject, model, elo: Number(r.elo), games: Number(r.games), winRate: Number(r.win_rate),
            provisional: Boolean(r.provisional), priceIn, priceOut,
            speed: offer && offer.speed ? offer.speed.p50_ms : null,
            uptime: offer ? offer.uptime : null,
            value,
            name: model ? model.name : r.subject,
            family: model ? familyLabel(model) : 'Other',
            href: model ? `/m/${model.slug.split('/').map(encodeURIComponent).join('/')}` : null,
        };
    }).sort((a, b) => (sort === 'value'
        ? (b.value == null ? -1 : b.value) - (a.value == null ? -1 : a.value)
        : b.elo - a.elo || a.name.localeCompare(b.name)));

    const tabs = categories.map((c) => `<a class="ex-chip${c === category ? ' is-on' : ''}" href="/rankings?category=${encodeURIComponent(c)}">${esc(labelOf(c))}</a>`).join('');
    const sortLinks = [['Best rating', ''], ['Best value', 'value']].map(([label, s]) => `<a class="ex-chip${(sort || '') === s ? ' is-on' : ''}" href="/rankings?category=${encodeURIComponent(category)}${s ? `&sort=${s}` : ''}">${label}</a>`).join('');

    const tableRows = rowsFor.map((r) => ({
        model: r.href ? `<a href="${r.href}">${mark(r.family)}<b>${esc(r.name)}</b></a>` : `<b>${esc(r.name)}</b>`,
        elo: `<b>${Math.round(r.elo)}</b>${r.provisional ? ' <small class="ex-muted">provisional</small>' : ''}`,
        games: `${count(r.games)} game${r.games === 1 ? '' : 's'} · ${pct(r.winRate)} won`,
        price: r.priceOut == null ? '<span class="ex-muted">free capacity</span>' : `<b>${money(r.priceOut)}</b> out · ${money(r.priceIn)} in`,
        speed: ms(r.speed),
        uptime: pct(r.uptime),
        value: r.value == null ? '–' : `${Math.round(r.value).toLocaleString('en-US')}`,
    }));

    const boardNote = board.unavailable
        ? 'The Bench board is not reachable right now.'
        : board.rows && board.rows.length
            ? `Elo from ${count(Math.round((board.rows || []).reduce((n, r) => n + (Number(r.games) || 0), 0) / 2))} votes.`
            : 'No votes in this category yet.';

    const products = (usage.by_product || []).slice(0, 12);
    const productRows = products.map((p) => {
        // AI folds every developer app into one row ("apps", with how many); a single app is never named publicly.
        const isApp = p.type === 'apps' || p.type === 'app';
        const prod = isApp ? { name: p.type === 'apps' ? `Developer apps (${count(p.apps || 0)})` : 'Developer apps' } : product(p.product);
        const modelsUsed = (p.models || []).slice(0, 3).map((m) => m.model || m.provider).filter(Boolean).join(', ');
        const who = isApp
            ? `${kit.badge('App', 'accent')}<b>${esc(prod.name)}</b>`
            : `${productMark(p.product, { size: 28 })}<b>${esc(prod.name)}</b>`;
        return {
            product: `<span class="ex-product-cell">${who}</span>`,
            models: modelsUsed ? `<span class="ex-muted">${esc(modelsUsed)}</span>` : '–',
            requests: count(p.requests),
            tokens: count((p.tokens_in || 0) + (p.tokens_out || 0)),
        };
    });

    return `<div class="ex-wrap ex-page">
${kit.head({ title: 'Rankings', sub: 'What people prefer, by the kind of work asked, beside what each model costs and how fast it answers.', actions: [kit.button({ href: '/arena', label: 'Enter the Arena', kind: 'quiet', icon: 'spark' })] })}
${catalog.unavailable ? unavailable('The live catalogue') : ''}
${board.unavailable ? unavailable('The Bench board') : ''}
<div class="ex-chips" role="group" aria-label="Task category">${tabs}</div>
<div class="ex-chips" role="group" aria-label="Sort">${sortLinks}</div>
${panel({ title: labelOf(category), note: boardNote, id: 'board', body: tableRows.length ? kit.table({
        columns: [
            { key: 'model', label: 'Model', primary: true, html: true },
            { key: 'elo', label: 'Rating', html: true },
            { key: 'games', label: 'Record' },
            { key: 'price', label: 'Per million, out / in', html: true },
            { key: 'speed', label: 'p50', hide: 'sm' },
            { key: 'uptime', label: 'Uptime', hide: 'sm' },
            { key: 'value', label: 'Elo per $/M out', num: true },
        ],
        rows: tableRows, label: `Rankings for ${labelOf(category)}`,
    }) : kit.empty({ icon: 'spark', title: 'No votes here yet', text: category === 'all' ? 'The first Arena vote will open this board.' : `No one has voted on a ${labelOf(category).toLowerCase()} prompt yet. <a href="/arena">Ask one</a>.` }) })}
${panel({ title: 'Products and apps', note: 'Which models OpenVibe’s products and developers’ apps run (apps as one row, never named), from AI’s own aggregate usage. No prompt and no person.', id: 'products', body: usage.unavailable ? '<p class="ex-prose">Usage is not reachable right now.</p>' : (productRows.length ? kit.table({
        columns: [{ key: 'product', label: 'Requester', primary: true, html: true }, { key: 'models', label: 'Models', html: true }, { key: 'requests', label: 'Requests' }, { key: 'tokens', label: 'Tokens', hide: 'sm' }],
        rows: productRows, label: 'Models by requester', caption: `The last ${usage.days || 30} days`,
    }) : kit.empty({ icon: 'code', title: 'No product has called the router yet', text: 'When one does, its models and requests show here.' })) })}
${panel({ title: 'How to read it', id: 'how', body: `<ul class="ex-list">
<li><strong>Rating</strong> is Bench Elo from blind Arena votes. 1000 is where a model starts; a model with fewer than 10 games is provisional.</li>
<li><strong>Price</strong> is the cheapest live offer’s price per million tokens, in and out, from OpenVibe.AI’s catalogue.</li>
<li><strong>Speed and uptime</strong> are measured from real requests over the last seven days; an offer with no traffic shows a dash.</li>
<li><strong>Value</strong> is rating points above 1000 per dollar of output. It rewards a model that wins and costs little; it never turns a dear model into a bargain. A model whose price is not published shows a dash.</li>
<li><strong>Categories</strong> come from the prompt’s classification in the Arena: code, writing, chat, reasoning, translation and analysis.</li>
</ul>` })}
</div>`;
}

module.exports = { arenaHome, arenaRound, rankingsPage, labelOf, CATEGORY_LABELS };
