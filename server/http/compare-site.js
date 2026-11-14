'use strict';

/**
 * openvibe.compare — the comparison site itself (plan 297), served by Exchange behind its own name.
 *
 * The pages are plain kit markup and complete without JavaScript. They are a read of the API in
 * server/http/compare.js; the only write is a reader's remark, which becomes a pending benchmark case for review
 * and is never run or published before a person accepts it.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const kit = require('openvibe-shared/kit');
const seo = require('openvibe-shared/seo');
const { asyncRouter } = require('./router');
const { send } = require('../render/layout');
const { esc, raw } = require('../render/html');

const SITE = Object.freeze({
    name: 'OpenVibe.Compare',
    tagline: 'Compare anything, starting with AI models.',
    service: 'exchange',
    home: '/',
    icon: 'exchange',
    nav: [
        { label: 'Compare', href: '/', icon: 'scale' },
        { label: 'Side by side', href: '/compare', icon: 'columns' },
        { label: 'Versions', href: '/versions', icon: 'branch' },
        { label: 'How it measures', href: '/method', icon: 'gauge' },
        { label: 'Exchange', href: 'https://openvibe.exchange', icon: 'open' },
    ],
});

const money = (n) => (n == null ? '–' : Number(n) === 0 ? '$0' : `$${Number(n) < 0.1 ? Number(n).toPrecision(2) : Number(n).toFixed(2)}`);
const ms = (n) => (n == null ? '–' : n < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`);
const pct = (n) => (n == null ? '–' : `${(n * 100).toFixed(1)}%`);
const count = (n) => (n == null ? '–' : Number(n).toLocaleString('en-US'));
const day = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
const monthYear = (v) => {
    const d = v ? new Date(v) : new Date();
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const modelHref = (slug) => `/models/${String(slug).split('/').map(encodeURIComponent).join('/')}`;
const modelOf = (href) => String(href || '').split('/models/')[1] || '';

function qualityText(q) {
    if (!q || !q.available) return 'not measured';
    return `${q.score}${q.games ? ` · ${count(q.games)} games` : ''}`;
}

function privacyText(p) {
    if (!p || !p.label) return '<span class="ovk-muted">not stated</span>';
    return esc(p.label);
}

function policyText(p) {
    if (!p) return '<span class="ovk-muted">not stated</span>';
    const bits = [];
    bits.push(p.trains === false ? 'no training' : p.trains === true ? 'may train' : 'training not stated');
    if (p.retention_days != null) bits.push(p.retention_days === 0 ? 'no retention' : `kept ${p.retention_days} d`);
    return esc(bits.join(' · '));
}

function badgeFor(text, tone = '') {
    return kit.badge(text, tone);
}

function changeLine(c) {
    if (!c || !c.available) return '<span class="ovk-muted">not measured</span>';
    const arrow = c.delta === 0 ? 'same' : `${c.delta > 0 ? '+' : ''}${c.delta}${c.unit === 'ms' ? ' ms' : c.unit === 'USD' ? ` $${Math.abs(c.delta).toFixed(4)}` : c.unit === 'Elo' ? ' Elo' : ''}`;
    return `${esc(c.label)}: <b>${esc(arrow)}</b>${c.pct == null ? '' : ` (${c.pct > 0 ? '+' : ''}${c.pct}%)`}${c.direction === 'better' ? ' — better' : c.direction === 'worse' ? ' — worse' : ''}`;
}

function sourceList(sources) {
    const rows = (sources || []).map((s) => ({
        name: `<a href="${esc(s.url)}" rel="noreferrer">${esc(s.name)}</a>`,
        fields: (s.fields || []).join(', '),
        read: day(s.read_at) || '–',
        state: s.unavailable ? 'unavailable when read' : 'read',
    }));
    return kit.table({
        columns: [
            { key: 'name', label: 'Source', primary: true, html: true },
            { key: 'fields', label: 'Fields' },
            { key: 'read', label: 'Read' },
            { key: 'state', label: 'State' },
        ],
        rows,
        label: 'Sources',
    });
}

function remarkForm({ models = [], comparison = null, field = null }) {
    const hidden = models.map((m) => `<input type="hidden" name="models" value="${esc(m)}">`).join('');
    const options = [
        ['', 'the whole comparison'], ['price', 'the price'], ['speed', 'the speed or latency'],
        ['quality', 'the quality score'], ['privacy', 'privacy or data policy'], ['context', 'the context length'], ['other', 'something else'],
    ].map(([v, l]) => `<option value="${v}"${field === v ? ' selected' : ''}>${esc(l)}</option>`).join('');
    return `<form class="ovk-form" method="post" action="/remarks">
${hidden}${comparison ? `<input type="hidden" name="comparison" value="${esc(comparison)}">` : ''}
<div class="ovk-sr" aria-hidden="true"><label>Leave this empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<label for="remark-text">What did you notice?</label>
<textarea id="remark-text" name="remark" rows="4" minlength="10" maxlength="2000" required placeholder="For example: on a long refactor the newer mini kept the whole file in view where the other dropped the last function."></textarea>
<label for="remark-field">Which number is it about?</label>
<select id="remark-field" name="field">${options}</select>
<label for="remark-source">A link that shows it (optional)</label>
<input id="remark-source" type="url" name="source_url" maxlength="500" placeholder="https://…">
<div class="ovk-form-actions">${kit.button({ label: 'Send it for review', type: 'submit' })}<span class="ovk-muted">A person reads it before anything is run or published.</span></div>
</form>`;
}

function picker(models, { action = '/compare', selected = [] } = {}) {
    const rows = models.map((m) => ({
        pick: `<input type="checkbox" name="models" value="${esc(m.slug)}" aria-label="Choose ${esc(m.name)}"${selected.includes(m.slug) ? ' checked' : ''}>`,
        model: `<a href="${modelHref(m.slug)}">${esc(m.name)}</a>${m.uncensored ? ` ${badgeFor('18+', 'bad')}` : ''}${m.open_weights ? ` ${badgeFor('open weights')}` : ''}<br><span class="ovk-muted">${esc(m.family || '')}${m.providers.length ? ` · ${esc(m.providers.join(', '))}` : ''}</span>`,
        price: m.price && m.price.in != null ? `<b>${money(m.price.in)}</b> in · ${money(m.price.out)} out` : '<span class="ovk-muted">no price</span>',
        speed: m.speed && m.speed.p50_ms != null ? `${ms(m.speed.p50_ms)} <small>p50</small> · ${ms(m.speed.p95_ms)} <small>p95</small>` : '<span class="ovk-muted">not measured</span>',
        quality: m.quality && m.quality.available ? `${m.quality.score} <small>Elo · ${count(m.quality.games)} games</small>` : `<span class="ovk-muted">${esc((m.quality && m.quality.reason) || 'not measured')}</span>`,
        privacy: privacyText(m.privacy),
        offers: count(m.offers_count),
    }));
    const body = rows.length ? `<form method="get" action="${esc(action)}">
${kit.table({
        columns: [
            { key: 'pick', label: 'Compare', html: true },
            { key: 'model', label: 'Model', primary: true, html: true },
            { key: 'price', label: 'Cheapest price, per 1M', html: true },
            { key: 'speed', label: 'Speed', html: true },
            { key: 'quality', label: 'Bench quality', html: true },
            { key: 'privacy', label: 'Privacy', html: true },
            { key: 'offers', label: 'Offers', num: true },
        ],
        rows, label: 'Models',
    })}
<p class="ovk-note">Choose two to four, then compare them side by side. Nothing is estimated: a missing number says why it is missing.</p>
<div class="ovk-form-actions">${kit.button({ label: 'Compare selected', type: 'submit' })}</div>
</form>` : kit.empty({ title: 'No model matches', text: 'Try another search, or browse every model.', icon: 'search' });
    return body;
}

function createCompareSite(ctx) {
    const { config, ai, compare } = ctx;
    const site = { ...SITE, baseUrl: config.compare.baseUrl };
    const isCompare = (req) => {
        const host = String(req.hostname || '').toLowerCase();
        return host === config.compare.host || host === `www.${config.compare.host}`;
    };
    const r = asyncRouter();
    r.use((req, _res, next) => (isCompare(req) ? next() : next('router')));
    r.use(express.urlencoded({ extended: false, limit: '32kb' }));

    const problemPage = (res, status, title, text) => send(res, status, {
        config, site, path: '/', viewer: res.req && res.req.viewer,
        title, description: text, index: false,
        body: raw(kit.page({ head: kit.head({ title, sub: text }), body: kit.empty({ title, text, icon: 'alert', action: { href: '/', label: 'All models' } }) })),
    });

    const page = (req, res, { title, description, path, body, jsonLd = [], index = true, status = 200, canonical = null }) => send(res, status, {
        config, site, viewer: req.viewer, path, canonical, title, description, jsonLd, index,
        body: raw(kit.page({ head: '', body })),
    });

    // ── Home ───────────────────────────────────────────────
    r.get('/', async (req, res) => {
        try {
            const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 120) : '';
            const family = typeof req.query.family === 'string' ? req.query.family.slice(0, 80) : '';
            const sort = ['requests', 'cheap', 'fast', 'quality', 'name'].includes(req.query.sort) ? req.query.sort : 'requests';
            const [list, versions] = await Promise.all([
                compare.methods.models({ q, family, sort, limit: 200 }),
                compare.methods.versions(),
            ]);
            const families = list.facets.families.map((f) => `<a class="ovk-chip" href="/?family=${encodeURIComponent(f)}">${esc(f)}</a>`).join('');
            const familyNote = family ? `<p class="ovk-note">Showing ${esc(family)}. <a href="/">All families</a></p>` : '';
            const versionRows = versions.lineages.map((l) => ({
                line: `<a href="/versions/${encodeURIComponent(l.key)}">${esc(l.label)}</a>`,
                count: l.models.length,
                latest: esc(l.latest.name),
                quality: l.latest.quality && l.latest.quality.available ? String(l.latest.quality.score) : 'not measured',
            }));
            const body = `
${kit.head({ title: 'Compare AI models', sub: 'Price from every provider that serves a model, measured speed and latency, Bench quality, privacy and tier — each with its date and source.', actions: [kit.button({ href: '/method', label: 'How it measures', kind: 'quiet', icon: 'ruler' })] })}
${list.unavailable ? kit.notice({ kind: 'warn', text: 'The model catalog is not reachable right now. These pages will fill in when it is; nothing is shown as live when it is not.' }) : ''}
${kit.find({ action: '/', name: 'q', placeholder: 'Find a model, a family or a provider', value: q })}
${families ? `<div class="ovk-chips" role="group" aria-label="Families">${families}</div>` : ''}
${familyNote}
${kit.section({ title: 'Every model, with its numbers', count: list.total, note: 'The cheapest live offer’s price; the fastest measured offer’s p50 and p95; Bench Elo from public judged games. A row with no quality says why.', body: picker(list.models) })}
${versions.lineages.length ? kit.section({ title: 'Versions compared properly', note: 'The same model line, each version against the one before it: price, speed, context and Bench Elo. An Elo move whose intervals overlap is not called a change.', body: kit.table({
        columns: [
            { key: 'line', label: 'Model line', primary: true, html: true },
            { key: 'count', label: 'Versions', num: true },
            { key: 'latest', label: 'Latest' },
            { key: 'quality', label: 'Latest Bench Elo' },
        ],
        rows: versionRows, label: 'Model lines with versions',
    }) }) : ''}
${kit.section({ title: 'What a comparison is', body: `<p class="ovk-prose">A comparison is data: the things (models), the criteria (price, speed, quality, privacy, tier), the sources, the method, and the results with the date each was read. The API is at <a href="/api/v1/compare">/api/v1/compare</a>; the pages and the compare builder are next.</p>` })}
${kit.section({ title: 'Sources', body: sourceList(list.sources) })}
`;
            return page(req, res, {
                title: 'Compare AI models: price, speed, quality and privacy',
                description: 'Compare AI models by the cheapest price per provider, measured speed and latency, OpenVibe.Bench quality, privacy and tier. Every number dated and sourced; no invented scores.',
                path: '/',
                jsonLd: [seo.jsonLd.webPage({ name: 'OpenVibe.Compare', url: `${site.baseUrl}/`, description: 'Compare AI models by price, speed, Bench quality, privacy and tier.', siteUrl: site.baseUrl })],
                body,
            });
        } catch (err) {
            ctx.log.warn('[openvibe.compare] home failed:', String((err && err.message) || err).slice(0, 200));
            return problemPage(res, 503, 'The comparison is not available', 'AI or Bench could not be read. Try again in a moment.');
        }
    });

    // ── One model ──────────────────────────────────────────
    r.get('/models/:org/:model', async (req, res) => {
        try {
            const slug = `${req.params.org}/${req.params.model}`;
            const out = await compare.methods.model(slug);
            if (!out) return problemPage(res, 404, 'No such model', `Nothing here serves ${slug}.`);
            const m = out.model;
            const offers = out.offers.map((o) => ({
                offer: `<b>${esc(o.provider_name)}</b>${o.tier ? ` ${badgeFor(o.tier, o.tier === 'community' ? 'accent' : '')}` : ''}${o.free_now ? ` ${badgeFor('free now', 'ok')}` : o.free ? ` ${badgeFor('free')}` : ''}<br><span class="ovk-muted">${esc(o.model || '')}</span>`,
                price: o.price ? `<b>${money(o.price.in)}</b> in · ${money(o.price.out)} out${o.price.cached != null ? `<br><span class="ovk-muted">cached ${money(o.price.cached)}</span>` : ''}` : '<span class="ovk-muted">no per-token price</span>',
                speed: o.speed.p50_ms == null && o.speed.p95_ms == null ? '<span class="ovk-muted">not measured</span>' : `${ms(o.speed.p50_ms)} <small>p50</small> · ${ms(o.speed.p95_ms)} <small>p95</small>`,
                uptime: o.uptime == null ? '–' : pct(o.uptime),
                privacy: `${privacyText(o.privacy)}<br><span class="ovk-muted">${policyText(o.data_policy)}</span>`,
                measured: day(o.measured_at) || '–',
            }));
            const qualityRows = (m.quality.by_benchmark || []).map((b) => ({
                board: esc(b.name),
                elo: b.elo == null ? '–' : String(b.elo),
                games: count(b.games),
                interval: b.ci_lower == null || b.ci_upper == null ? '–' : `${b.ci_lower}–${b.ci_upper}`,
                state: b.provisional ? badgeFor('provisional', 'warn') : badgeFor('judged', 'ok'),
            }));
            const versionRows = (out.versions ? out.versions.models : []).map((v, i) => ({
                version: `<a href="${modelHref(v.slug)}">${esc(v.name)}</a>${i === out.versions.models.length - 1 ? ` ${badgeFor('latest', 'accent')}` : ''}`,
                price: v.price && v.price.in != null ? `${money(v.price.in)} / ${money(v.price.out)}` : '–',
                speed: v.speed && v.speed.p50_ms != null ? ms(v.speed.p50_ms) : '–',
                quality: v.quality && v.quality.available ? String(v.quality.score) : 'not measured',
                changed: v.changes ? esc(v.changes.summary) : 'first version in the line',
            }));
            const alternatives = out.alternatives.map((a) => `<li><a href="${modelHref(a.slug)}">${esc(a.name)}</a> — ${a.price && a.price.in != null ? `${money(a.price.in)} in · ${money(a.price.out)} out` : 'no price'}${a.quality && a.quality.available ? ` · ${a.quality.score} Elo` : ''}</li>`).join('');
            const body = `
${kit.head({ title: m.name, sub: `${m.family || ''}${m.line.version_label ? ` · version ${m.line.version_label}` : ''} · ${m.kind}`, back: { href: '/', label: 'All models' }, actions: [kit.button({ href: `/compare?models=${encodeURIComponent(m.slug)}`, label: 'Compare it', kind: 'quiet', icon: 'columns' })] })}
${kit.stats([
                [money(m.price && m.price.in), 'cheapest in, per 1M'],
                [money(m.price && m.price.out), 'cheapest out, per 1M'],
                [ms(m.speed && m.speed.p50_ms), 'typical p50'],
                [qualityText(m.quality).split(' · ')[0], 'Bench Elo'],
                [count(m.offers_count), 'live offers'],
            ])}
${m.quality.available ? '' : kit.notice({ kind: 'info', text: m.quality.reason || 'No quality score yet.' })}
${kit.section({ title: 'Every offer that serves it', count: offers.length, note: 'The price book: each provider’s own price, speed, uptime, privacy and tier. “Not stated” is not a guess.', body: kit.table({
                columns: [
                    { key: 'offer', label: 'Provider', primary: true, html: true },
                    { key: 'price', label: 'In / out per 1M', html: true },
                    { key: 'speed', label: 'Speed', html: true },
                    { key: 'uptime', label: 'Uptime' },
                    { key: 'privacy', label: 'Privacy and data policy', html: true },
                    { key: 'measured', label: 'Price read' },
                ],
                rows: offers, label: `Offers for ${m.name}`,
            }) })}
${kit.section({ title: 'Bench quality', note: `Read from OpenVibe.Bench on ${day(m.quality.read_at) || '–'}. Elo is shown with its own interval per board; a pooled score is not a new interval.`, body: qualityRows.length ? kit.table({
                columns: [
                    { key: 'board', label: 'Board', primary: true },
                    { key: 'elo', label: 'Elo', num: true },
                    { key: 'games', label: 'Games', num: true },
                    { key: 'interval', label: 'Interval' },
                    { key: 'state', label: 'State', html: true },
                ],
                rows: qualityRows, label: 'Bench quality',
            }) : kit.notice({ kind: 'info', text: m.quality.reason || 'No public Bench rounds for this model yet.' }) })}
${out.versions ? kit.section({ title: `Versions of the ${out.versions.label} line`, note: 'Each row is compared with the one before it on price, speed, context and Bench Elo.', body: kit.table({
                columns: [
                    { key: 'version', label: 'Version', primary: true, html: true },
                    { key: 'price', label: 'In / out' },
                    { key: 'speed', label: 'p50' },
                    { key: 'quality', label: 'Bench Elo' },
                    { key: 'changed', label: 'What changed' },
                ],
                rows: versionRows, label: 'Versions',
            }) }) : ''}
${alternatives ? kit.section({ title: 'Close alternatives', body: `<ul class="ovk-list">${alternatives}</ul>` }) : ''}
${kit.section({ title: 'Teach the benchmarks', note: 'A remark on this comparison becomes a pending benchmark case. It is reviewed before anything runs or is published.', body: remarkForm({ models: [m.slug], comparison: m.slug }) })}
${kit.section({ title: 'Sources', body: sourceList(out.sources) })}
`;
            return page(req, res, {
                title: `${m.name} benchmarks, price and speed (${monthYear(m.measured_at)})`,
                description: `${m.name}: ${m.offers_count} live offers, from ${money(m.price && m.price.in)} in and ${money(m.price && m.price.out)} out per 1M, ${ms(m.speed && m.speed.p50_ms)} p50, ${m.quality.available ? `${m.quality.score} Bench Elo` : 'no Bench score yet'}. Measured ${day(m.measured_at) || 'date unknown'}.`,
                path: modelHref(m.slug),
                jsonLd: [seo.jsonLd.softwareApp({ name: m.name, url: `${site.baseUrl}${modelHref(m.slug)}`, description: `${m.name}: price, speed and Bench quality.` }), seo.jsonLd.breadcrumbs([{ name: 'Compare', url: `${site.baseUrl}/` }, { name: m.name, url: `${site.baseUrl}${modelHref(m.slug)}` }])],
                body,
            });
        } catch (err) {
            ctx.log.warn('[openvibe.compare] model failed:', String((err && err.message) || err).slice(0, 200));
            return problemPage(res, 503, 'The model is not available', 'AI or Bench could not be read. Try again in a moment.');
        }
    });

    // ── Side by side ───────────────────────────────────────
    r.get('/compare', async (req, res) => {
        const refs = [...new Set([].concat(req.query.models || []).flatMap((x) => String(x || '').split(',')).map((x) => x.trim()).filter(Boolean))];
        try {
            if (refs.length < 2 || refs.length > 4) {
                const list = await compare.methods.models({ limit: 200 });
                const body = `
${kit.head({ title: 'Compare side by side', sub: 'Choose two to four models. Each criterion has its own winner; there is no invented overall score.', back: { href: '/', label: 'All models' } })}
${refs.length ? kit.notice({ kind: 'info', text: 'Choose between two and four models.' }) : ''}
${kit.section({ title: 'Choose the models', body: picker(list.models, { selected: refs }) })}
`;
                return page(req, res, { title: 'Compare two models side by side', description: 'Pick two to four AI models and compare their price, speed, Bench quality, context, privacy and tier.', path: '/compare', body, index: refs.length === 0 });
            }
            const out = await compare.methods.compare(refs);
            if (out.error) {
                const list = await compare.methods.models({ limit: 200 });
                const body = `${kit.head({ title: 'Compare side by side', sub: out.message })}
${kit.notice({ kind: 'warn', text: out.message })}
${kit.section({ title: 'Choose the models', body: picker(list.models, { selected: refs }) })}`;
                return page(req, res, { title: 'Compare AI models side by side', description: out.message, path: '/compare', body, index: false, status: out.status || 400 });
            }
            const models = out.models;
            const columns = [
                { key: 'criterion', label: 'Criterion', primary: true, html: true },
                ...models.map((m) => ({ key: m.slug, label: m.name, html: true })),
            ];
            const rows = out.criteria.map((c) => {
                const row = { criterion: `<b>${esc(c.label)}</b>${c.better ? `<br><span class="ovk-muted">${c.better === 'lower' ? 'lower is better' : 'higher is better'}</span>` : ''}` };
                for (const v of c.values) {
                    const isWinner = c.winner && c.winner === v.slug;
                    row[v.slug] = v.available
                        ? `${v.value == null ? '–' : c.unit === 'USD' ? money(v.value) : c.unit === 'ms' ? ms(v.value) : c.unit === 'share' ? pct(v.value) : count(v.value)}${isWinner ? ` ${badgeFor('best', 'ok')}` : ''}`
                        : `<span class="ovk-muted">${esc(v.reason || 'not measured')}</span>`;
                }
                return row;
            });
            const body = `
${kit.head({ title: models.map((m) => m.name).join(' vs '), sub: `${models.length} models, ${out.criteria.length} criteria, every number with its source and date`, back: { href: '/', label: 'All models' }, actions: [kit.button({ href: `/compare?models=${encodeURIComponent(models.map((m) => m.slug).join(','))}`, label: 'This comparison', kind: 'quiet', icon: 'link' })] })}
${kit.notice({ kind: 'info', text: out.verdict.headline })}
${out.price_spread ? `<p class="ovk-prose"><b>Price spread:</b> ${esc(out.price_spread.cheapest.name)} at ${money(out.price_spread.cheapest.price.out)} out is ${out.price_spread.percent == null ? '' : `${Math.abs(out.price_spread.percent).toFixed(0)}% cheaper`} than ${esc(out.price_spread.dearest.name)} at ${money(out.price_spread.dearest.price.out)}.</p>` : ''}
${kit.section({ title: 'Side by side', note: out.verdict.caveat, body: kit.table({ columns, rows, label: 'Comparison', stack: true }) })}
${out.verdict.quality_note ? kit.notice({ kind: 'info', text: out.verdict.quality_note }) : ''}
${kit.section({ title: 'What each model is', body: `<ul class="ovk-list">${models.map((m) => `<li><a href="${modelHref(m.slug)}">${esc(m.name)}</a> — ${m.offers_count} offers; ${m.price && m.price.in != null ? `${money(m.price.in)} in · ${money(m.price.out)} out` : 'no price'}; ${m.quality.available ? `${m.quality.score} Bench Elo` : 'no Bench score yet'}</li>`).join('')}</ul>` })}
${kit.section({ title: 'Teach the benchmarks', note: 'A remark on this comparison becomes a pending benchmark case for review.', body: remarkForm({ models: models.map((m) => m.slug), comparison: models.map((m) => m.slug).join('-vs-') }) })}
${kit.section({ title: 'Sources', body: sourceList(out.sources) })}
`;
            return page(req, res, {
                title: `${models.map((m) => m.name).join(' vs ')}: price, speed and Bench quality`,
                description: `Compare ${models.map((m) => m.name).join(' and ')} on price per provider, measured speed, Bench Elo, context, privacy and tier. ${out.verdict.headline}`,
                path: '/compare',
                canonical: `${site.baseUrl}/compare?models=${encodeURIComponent(models.map((m) => m.slug).join(','))}`,
                jsonLd: [seo.jsonLd.article({ headline: `${models.map((m) => m.name).join(' vs ')}: price, speed and quality`, url: `${site.baseUrl}/compare?models=${encodeURIComponent(models.map((m) => m.slug).join(','))}`, description: out.verdict.headline, datePublished: null, dateModified: day(out.generated_at) })],
                body,
            });
        } catch (err) {
            ctx.log.warn('[openvibe.compare] compare failed:', String((err && err.message) || err).slice(0, 200));
            return problemPage(res, 503, 'The comparison is not available', 'AI or Bench could not be read. Try again in a moment.');
        }
    });

    // ── Versions ───────────────────────────────────────────
    r.get('/versions', async (req, res) => {
        try {
            const out = await compare.methods.versions();
            const rows = out.lineages.map((l) => ({
                line: `<a href="/versions/${encodeURIComponent(l.key)}">${esc(l.label)}</a>`,
                family: esc(l.family || ''),
                versions: l.models.length,
                latest: esc(l.latest.name),
                changed: l.latest.changes ? esc(l.latest.changes.summary) : '',
                read: day(l.measured_at) || '–',
            }));
            const body = `${kit.head({ title: 'Versions compared properly', sub: 'The same model line, each version against the one before it: price, speed, context and Bench Elo. An Elo move whose intervals overlap is not called a change.' })}
${kit.section({ title: 'Model lines with two or more versions', count: rows.length, body: kit.table({
                columns: [
                    { key: 'line', label: 'Line', primary: true, html: true },
                    { key: 'family', label: 'Family' },
                    { key: 'versions', label: 'Versions', num: true },
                    { key: 'latest', label: 'Latest' },
                    { key: 'changed', label: 'Latest change' },
                    { key: 'read', label: 'Read' },
                ],
                rows, label: 'Model lines',
                empty: 'No model line has two versions in the catalog yet. When one does, its versions appear here.',
            }) })}
${kit.section({ title: 'How versions are read', body: `<p class="ovk-prose">${esc(compare.method.versions)}</p>` })}
${kit.section({ title: 'Sources', body: sourceList(out.sources) })}`;
            return page(req, res, { title: 'AI model versions compared: what changed', description: 'The same model line’s versions in one table: price, speed, context and Bench Elo, with an interval-aware “what changed”.', path: '/versions', body });
        } catch (err) {
            ctx.log.warn('[openvibe.compare] versions failed:', String((err && err.message) || err).slice(0, 200));
            return problemPage(res, 503, 'Versions are not available', 'AI or Bench could not be read. Try again in a moment.');
        }
    });

    r.get('/versions/:key', async (req, res) => {
        try {
            const out = await compare.methods.versions(req.params.key);
            if (!out.lineages.length) return problemPage(res, 404, 'No such model line', `No line with versions is called ${req.params.key}.`);
            const l = out.lineages[0];
            const rows = l.models.map((m, i) => ({
                version: `<a href="${modelHref(m.slug)}">${esc(m.name)}</a>${i === l.models.length - 1 ? ` ${badgeFor('latest', 'accent')}` : ''}`,
                price: m.price && m.price.in != null ? `${money(m.price.in)} / ${money(m.price.out)}` : '–',
                speed: m.speed && m.speed.p50_ms != null ? ms(m.speed.p50_ms) : '–',
                quality: m.quality && m.quality.available ? `${m.quality.score}` : 'not measured',
                context: m.context == null ? '–' : count(m.context),
                changed: m.changes ? `<b>${esc(m.changes.summary)}</b><br>${m.changes.changes.filter((c) => c.available && c.direction !== 'same').map(changeLine).join('<br>') || '<span class="ovk-muted">No measured criterion changed.</span>'}${m.changes.quality && !m.changes.quality.meaningful ? `<br><span class="ovk-muted">${esc(m.changes.quality.reason)}</span>` : ''}` : 'first version in the line',
            }));
            const body = `${kit.head({ title: `${l.label}: versions compared`, sub: `${l.models.length} versions · ${l.family || 'family'} · read ${day(l.measured_at) || '–'}`, back: { href: '/versions', label: 'Versions' } })}
${kit.section({ title: 'What changed, version by version', note: 'Price in/out per 1M, p50 speed, context and Bench Elo. A quality move inside its interval is not called a change.', body: kit.table({
                columns: [
                    { key: 'version', label: 'Version', primary: true, html: true },
                    { key: 'price', label: 'In / out' },
                    { key: 'speed', label: 'p50' },
                    { key: 'quality', label: 'Bench Elo' },
                    { key: 'context', label: 'Context' },
                    { key: 'changed', label: 'What changed', html: true },
                ],
                rows, label: `${l.label} versions`,
            }) })}
${l.latest.quality && l.latest.quality.available ? kit.section({ title: 'The latest version’s boards', body: kit.table({
                columns: [
                    { key: 'board', label: 'Board', primary: true },
                    { key: 'elo', label: 'Elo', num: true },
                    { key: 'games', label: 'Games', num: true },
                    { key: 'interval', label: 'Interval' },
                ],
                rows: l.latest.quality.by_benchmark.map((b) => ({ board: esc(b.name), elo: b.elo == null ? '–' : String(b.elo), games: count(b.games), interval: b.ci_lower == null ? '–' : `${b.ci_lower}–${b.ci_upper}` })),
                label: 'Boards',
            }) }) : ''}
${kit.section({ title: 'How versions are read', body: `<p class="ovk-prose">${esc(compare.method.versions)}</p>` })}
${kit.section({ title: 'Sources', body: sourceList(out.sources) })}`;
            return page(req, res, { title: `${l.label} versions: what changed`, description: `${l.models.length} versions of ${l.label} compared on price, speed, context and Bench Elo, each against the one before it.`, path: `/versions/${encodeURIComponent(l.key)}`, body });
        } catch (err) {
            ctx.log.warn('[openvibe.compare] version line failed:', String((err && err.message) || err).slice(0, 200));
            return problemPage(res, 503, 'The line is not available', 'AI or Bench could not be read. Try again in a moment.');
        }
    });

    // ── Method ─────────────────────────────────────────────
    r.get('/method', async (_req, res) => {
        const out = await compare.methods.models({ limit: 1 }).catch(() => null);
        const body = `${kit.head({ title: 'How OpenVibe.Compare measures', sub: 'A comparison is data: things, criteria, sources, a method, results with dates. Nothing here is estimated.' })}
${kit.section({ title: 'Price', body: `<p class="ovk-prose">${esc(compare.method.price)}</p>` })}
${kit.section({ title: 'Speed and latency', body: `<p class="ovk-prose">${esc(compare.method.speed)}</p>` })}
${kit.section({ title: 'Quality', body: `<p class="ovk-prose">${esc(compare.method.quality)}</p>` })}
${kit.section({ title: 'Privacy and tier', body: `<p class="ovk-prose">${esc(compare.method.privacy)}</p><p class="ovk-prose">${esc(compare.method.tier)}</p>` })}
${kit.section({ title: 'Versions', body: `<p class="ovk-prose">${esc(compare.method.versions)}</p>` })}
${kit.section({ title: 'When a source cannot be read', body: `<p class="ovk-prose">${esc(compare.method.unavailable)}</p>` })}
${kit.section({ title: 'A reader’s remark', body: `<p class="ovk-prose">Any remark on a comparison can become a pending benchmark case. It is stored with the models it names, the criterion it questions and an optional link. The owner reads the queue; only an accepted case is turned into a Bench task. A remark is never a result and never runs by itself.</p>` })}
${out ? kit.section({ title: 'Sources', body: sourceList(out.sources) }) : ''}`;
        return page(_req, res, { title: 'How OpenVibe.Compare measures price, speed, quality and privacy', description: 'The method behind every comparison: dated price from AI’s catalog, measured speed, Bench Elo with intervals, privacy and tier, and version deltas that respect uncertainty.', path: '/method', body });
    });

    // ── The remark ─────────────────────────────────────────
    r.post('/remarks', rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false }), async (req, res) => {
        const b = req.body && typeof req.body === 'object' ? req.body : {};
        if (b.website) return res.redirect(303, '/remarks/thanks');
        const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
        const refs = [...new Set([].concat(b.models || []).flatMap((x) => String(x || '').split(',')).map((x) => clean(x, 160)).filter(Boolean))].slice(0, 4);
        const remark = clean(b.remark, 2000);
        const field = ['price', 'speed', 'quality', 'privacy', 'context', 'other'].includes(String(b.field)) ? String(b.field) : null;
        if (!refs.length || remark.length < 10) {
            return send(res, 400, {
                config, site, viewer: req.viewer, path: '/remarks', index: false,
                title: 'That remark needs a model and a little more detail',
                description: 'A remark needs at least one model and ten characters.',
                body: raw(kit.page({ head: kit.head({ title: 'That remark needs a model and a little more detail', sub: 'Go back and add at least one model and ten characters.' }), body: kit.empty({ title: 'Not sent', text: 'A remark needs at least one model and ten characters.', icon: 'alert', action: { href: '/', label: 'All models' } }) })),
            });
        }
        try {
            const catalog = await ai.catalog();
            const bySlug = new Map((catalog.models || []).map((m) => [String(m.slug).toLowerCase(), m]));
            const known = refs.filter((x) => bySlug.has(x.toLowerCase()));
            if (!known.length) throw Object.assign(new Error('No such model'), { status: 400 });
            let sourceUrl = null;
            if (b.source_url) {
                const u = new URL(String(b.source_url));
                if (['http:', 'https:'].includes(u.protocol)) sourceUrl = u.toString().slice(0, 500);
            }
            await compare.methods.remarks.create({
                models: known.map((x) => bySlug.get(x.toLowerCase()).slug),
                comparison: clean(b.comparison, 200) || null,
                field, remark, proposedPrompt: clean(`Test ${known.map((x) => bySlug.get(x.toLowerCase()).name).join(', ')}: ${remark}`, 4000),
                sourceUrl,
                subject: req.viewer && req.viewer.kind === 'user' ? req.viewer.subject : null,
            });
            return res.redirect(303, '/remarks/thanks');
        } catch (err) {
            ctx.log.warn('[openvibe.compare] remark failed:', String((err && err.message) || err).slice(0, 200));
            return send(res, 503, {
                config, site, viewer: req.viewer, path: '/remarks', index: false,
                title: 'The remark could not be stored',
                description: 'Try again in a moment.',
                body: raw(kit.page({ head: kit.head({ title: 'The remark could not be stored', sub: 'Try again in a moment.' }), body: kit.empty({ title: 'Not sent', text: 'The catalog or the store could not be read. Nothing was saved.', icon: 'alert', action: { href: '/', label: 'All models' } }) })),
            });
        }
    });

    r.get('/remarks/thanks', (req, res) => send(res, 200, {
        config, site, viewer: req.viewer, path: '/remarks/thanks', index: false,
        title: 'Thank you — a person will read it',
        description: 'Your remark became a pending benchmark case.',
        body: raw(kit.page({ head: kit.head({ title: 'Thank you — a person will read it', sub: 'Your remark is a pending benchmark case now, not a result.' }), body: `${kit.notice({ kind: 'ok', text: 'Nothing runs and nothing is published until the owner accepts the case.' })}<p class="ovk-prose"><a href="/">Back to the models</a></p>` })),
    }));

    // ── Robots, sitemap and llms.txt ───────────────────────
    r.get('/robots.txt', (_req, res) => {
        res.type('text/plain').send(seo.robotsTxt({ sitemaps: [`${site.baseUrl}/sitemap.xml`], disallow: ['/api/', '/auth/', '/remarks/'] }));
    });

    r.get('/sitemap.xml', async (_req, res) => {
        try {
            const [list, versions] = await Promise.all([compare.methods.models({ limit: 250 }), compare.methods.versions()]);
            const urls = [
                { loc: `${site.baseUrl}/`, lastmod: day(list.catalog_generated_at), changefreq: 'daily', priority: 1 },
                { loc: `${site.baseUrl}/versions`, lastmod: day(versions.generated_at), changefreq: 'daily', priority: 0.8 },
                { loc: `${site.baseUrl}/method`, changefreq: 'monthly', priority: 0.4 },
                ...list.models.map((m) => ({ loc: `${site.baseUrl}${modelHref(m.slug)}`, lastmod: day(m.measured_at), changefreq: 'daily', priority: 0.7 })),
                ...versions.lineages.map((l) => ({ loc: `${site.baseUrl}/versions/${encodeURIComponent(l.key)}`, lastmod: day(l.measured_at), changefreq: 'weekly', priority: 0.6 })),
            ];
            res.type('application/xml').send(seo.sitemapXml(urls));
        } catch (err) {
            ctx.log.warn('[openvibe.compare] sitemap failed:', String((err && err.message) || err).slice(0, 200));
            res.status(503).type('text/plain').send('The sitemap is not available right now.');
        }
    });

    r.get('/llms.txt', async (_req, res) => {
        const list = await compare.methods.models({ limit: 50 }).catch(() => null);
        res.type('text/plain').send(seo.llmsTxt({
            name: 'OpenVibe.Compare',
            summary: 'Compare anything, starting with AI models: price per provider, measured speed and latency, OpenVibe.Bench quality, privacy and tier. Every number is dated and sourced; no figure is estimated.',
            base: site.baseUrl,
            sections: [
                {
                    title: 'Compare', links: [
                        { title: 'Every model', url: `${site.baseUrl}/`, note: 'the price book, speed and Bench quality' },
                        { title: 'Side by side', url: `${site.baseUrl}/compare`, note: 'two to four models, one winner per criterion' },
                        { title: 'Versions', url: `${site.baseUrl}/versions`, note: 'the same model line, what changed' },
                        { title: 'How it measures', url: `${site.baseUrl}/method`, note: 'sources, dates and the interval rule' },
                        { title: 'JSON API', url: `${site.baseUrl}/api/v1/compare`, note: 'the same data as JSON' },
                    ],
                },
                ...(list ? [{
                    title: 'A few models', links: list.models.slice(0, 20).map((m) => ({ title: m.name, url: `${site.baseUrl}${modelHref(m.slug)}`, note: `${m.price && m.price.in != null ? `$${m.price.in}/$${m.price.out} per 1M` : 'no price'}${m.quality && m.quality.available ? `, ${m.quality.score} Elo` : ''}` })),
                }] : []),
            ],
        }));
    });

    r.use((_req, res) => problemPage(res, 404, 'Not found', 'That page is not part of openvibe.compare.'));
    return r;
}

module.exports = { createCompareSite, SITE };
