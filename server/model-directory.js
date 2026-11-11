'use strict';
const { esc } = require('./render/html');

const href = id => `/models/${encodeURIComponent(id)}`;
const allowedStatus = new Set(['available', 'preview', 'spotted', 'retired']);
function withLiveCatalog(directoryModels = [], catalogModels = []) {
    const live = new Map(catalogModels.map(m => [m.slug, m]));
    const rows = directoryModels.map(m => ({ ...m, slug: m.id, offers: live.get(m.id)?.offers || [] }));
    const seen = new Set(rows.map(m => m.id));
    for (const m of catalogModels) {
        if (!m.slug || seen.has(m.slug)) continue;
        const offers = Array.isArray(m.offers) ? m.offers : [];
        const priced = offers.filter(o => o.price && Number.isFinite(Number(o.price.out)));
        priced.sort((a, b) => Number(a.price.out) - Number(b.price.out));
        const cheapest = priced[0];
        const [provider, ...modelParts] = m.slug.split('/');
        rows.push({
            id: m.slug, slug: m.slug, provider, model: modelParts.join('/'), name: m.name || m.slug,
            family: m.family || null, status: 'available', routing_enabled: offers.length > 0,
            context_window: m.context ?? null, max_output: m.max_output ?? null, modalities: m.modalities || [],
            price: { input_per_million: cheapest?.price?.in ?? null, output_per_million: cheapest?.price?.out ?? null,
                cached_per_million: cheapest?.price?.cached ?? null, checked_at: cheapest?.updated_at || null,
                source: null },
            source: null, offers,
        });
        seen.add(m.slug);
    }
    return rows;
}
function select(models, query = {}) {
    const q = String(query.q || '').toLowerCase().slice(0, 120);
    const status = String(query.status || '').toLowerCase();
    const provider = String(query.provider || '').toLowerCase().slice(0, 80);
    return models.filter(m => (!q || `${m.name} ${m.id} ${m.family || ''}`.toLowerCase().includes(q))
        && (!allowedStatus.has(status) || m.status === status) && (!provider || m.provider.toLowerCase() === provider));
}
const usd = value => value == null || !Number.isFinite(Number(value)) ? 'Price not listed' : `$${Number(value)} per million tokens`;
/** "128K" / "1M": a context window the way people say it (binary sizes in K of 1,024, as providers name them). */
const tokens = (n) => {
    const v = Number(n);
    if (n == null || !Number.isFinite(v) || v <= 0) return null;
    if (v >= 1e6) return `${Number((v % 1048576 === 0 ? v / 1048576 : v / 1e6).toFixed(1))}M`;
    if (v >= 1000) return `${Math.round(v % 1024 === 0 ? v / 1024 : v / 1000)}K`;
    return String(v);
};
/** "$3/M out": the output price per million tokens, short. */
const perMOut = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v) === 0 ? 'Free' : `$${Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 })}/M out`);
// Raw provider ids some registry rows carry instead of a name.
const PROVIDER_NAMES = { gemini: 'Google Gemini', google: 'Google', huggingface: 'Hugging Face', openai: 'OpenAI', anthropic: 'Anthropic',
    openrouter: 'OpenRouter', deepseek: 'DeepSeek', mistral: 'Mistral', xai: 'xAI', meta: 'Meta', arena: 'LMArena' };
/** A provider's name and its note: "OpenRouter (the last fallback)" → OpenRouter + "the last fallback". */
function providerOf(m) {
    const raw = String(m.provider_name || PROVIDER_NAMES[String(m.provider || '').toLowerCase()] || m.provider || 'Other');
    const hit = raw.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    return hit ? { name: hit[1], note: hit[2] } : { name: raw, note: '' };
}
const STATUSES = ['available', 'preview', 'spotted', 'retired'];
const STATUS_LABEL = { all: 'All', available: 'Available', preview: 'Preview', spotted: 'Spotted', retired: 'Retired' };
/**
 * The registry under /models (Opus, 2026-11-11): every provider-listed model, grouped by provider in folds that say
 * how many and from what price, so 900+ rows read as one screen of providers. Every row stays in the HTML (crawlers
 * and find-in-page see them all); a search, a status or a provider opens the folds. The status switch keeps the
 * search and says how many each status holds.
 */
function directoryList(models, query, activeSlugs = []) {
    const active = new Set(activeSlugs);
    const pool = select(models, { ...query, status: '' }).filter(m => !active.has(m.id));
    const status = STATUSES.includes(String(query.status || '').toLowerCase()) ? String(query.status).toLowerCase() : 'all';
    const rows = status === 'all' ? pool : pool.filter(m => m.status === status);
    const counts = { all: pool.length };
    for (const s of STATUSES) counts[s] = pool.filter(m => m.status === s).length;
    const keep = new URLSearchParams(Object.entries(query).filter(([k, v]) => k !== 'status' && typeof v === 'string' && v));
    const statusHref = (s) => { const p = new URLSearchParams(keep); if (s !== 'all') p.set('status', s); const qs = p.toString(); return `/models${qs ? `?${qs}` : ''}#directory-more`; };
    const tabs = ['all', ...STATUSES].map(s => counts[s] || s === status
        ? `<a class="xr-tab${s === status ? ' is-on' : ''}" href="${esc(statusHref(s))}"${s === status ? ' aria-current="true"' : ''}>${esc(STATUS_LABEL[s])}<span>${counts[s]}</span></a>`
        : `<span class="xr-tab is-empty" aria-disabled="true">${esc(STATUS_LABEL[s])}<span>0</span></span>`).join('');
    const groups = new Map();
    for (const m of rows) {
        const p = providerOf(m);
        const g = groups.get(p.name) || { name: p.name, note: p.note, rows: [] };
        if (!g.note && p.note) g.note = p.note;
        g.rows.push(m);
        groups.set(p.name, g);
    }
    const order = (m) => STATUSES.indexOf(m.status);
    const list = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
    const narrowed = Boolean(query.q || query.provider || status !== 'all') || rows.length <= 40;
    const row = (m) => {
        const ctx = tokens(m.context_window);
        const out = perMOut(m.price?.output_per_million);
        return `<li class="xr-row${m.status === 'retired' ? ' is-retired' : ''}"><a href="${href(m.id)}">${esc(m.name)}</a><span class="xr-meta">`
            + `${m.status !== 'available' ? `<span class="xr-status is-${esc(m.status)}">${esc(STATUS_LABEL[m.status] || m.status)}</span>` : ''}`
            + `${ctx ? `<span class="xr-ctx" title="${esc(`${Number(m.context_window).toLocaleString('en-US')} tokens of context`)}">${esc(ctx)} context</span>` : ''}`
            + `<span class="xr-price">${out ? esc(out) : '<i>Not priced</i>'}</span></span></li>`;
    };
    const fold = (g) => {
        const prices = g.rows.map(m => m.price?.output_per_million).filter(v => v != null && Number.isFinite(Number(v))).map(Number);
        const free = prices.filter(v => v === 0).length;
        const paid = prices.filter(v => v > 0);
        const from = paid.length ? Math.min(...paid) : null;
        const sorted = [...g.rows].sort((a, b) => order(a) - order(b) || String(a.name).localeCompare(String(b.name), 'en', { numeric: true, sensitivity: 'base' }));
        return `<details class="xr-group"${narrowed ? ' open' : ''}><summary><span class="xr-prov">${esc(g.name)}</span>`
            + `${g.note ? `<span class="xr-prov-note">${esc(g.note)}</span>` : ''}<span class="xr-sum">`
            + `<span class="xr-n">${g.rows.length} ${g.rows.length === 1 ? 'model' : 'models'}</span>`
            + `${free ? `<span class="xr-free">${free === g.rows.length ? 'free' : `${free} free`}</span>` : ''}`
            + `${from != null ? `<span class="xr-from">from ${esc(perMOut(from))}</span>` : ''}</span></summary>`
            + `<ul class="xr-list">${sorted.map(row).join('')}</ul></details>`;
    };
    return `<section class="ex-wrap xr" aria-labelledby="directory-more"><div class="xr-head"><h2 id="directory-more">More models in the registry</h2>
<p>Every model a provider lists, routed or not: ${counts.all.toLocaleString('en-US')} from ${new Set(pool.map(m => providerOf(m).name)).size} providers. Prices and availability are dated at their sources.</p></div>
<nav class="xr-tabs" aria-label="Model status">${tabs}</nav>
${list.length ? `<div class="xr-groups">${list.map(fold).join('')}</div>` : '<p class="xm-empty">No more models match this search.</p>'}</section>`;
}
function directoryDetail(m) {
    const price = m.price || {};
    const link = value => { try { const u = new URL(value); return u.protocol === 'https:' ? `<a href="${esc(u.href)}" rel="noopener noreferrer">${esc(u.host)}</a>` : '—'; } catch { return '—'; } };
    return `<div class="ex-wrap ex-narrow"><p><a href="/models">All models</a></p><h1>${esc(m.name)}</h1>
<p>${esc(m.provider_name || m.provider)} · ${esc(m.status)}${m.routing_enabled ? ' · Routing on' : ' · Routing off'}</p>
<dl><dt>Model ID</dt><dd><code>${esc(m.id)}</code></dd><dt>Version</dt><dd>${esc(m.version || 'Not listed')}</dd>
<dt>Context</dt><dd>${esc(m.context_window == null ? 'Not listed' : `${m.context_window} tokens`)}</dd>
<dt>Maximum output</dt><dd>${esc(m.max_output == null ? 'Not listed' : `${m.max_output} tokens`)}</dd>
<dt>Modalities</dt><dd>${esc((m.modalities || []).join(', ') || 'Not listed')}</dd>
<dt>Input price</dt><dd>${esc(usd(price.input_per_million))}</dd><dt>Output price</dt><dd>${esc(usd(price.output_per_million))}</dd>
<dt>Price checked</dt><dd>${esc(price.checked_at || 'Not listed')}</dd><dt>Price source</dt><dd>${link(price.source)}</dd>
<dt>Model source</dt><dd>${link(m.source)}</dd><dt>First seen</dt><dd>${esc(m.first_seen_at || 'Not listed')}</dd>
${m.retired_at ? `<dt>Retired</dt><dd>${esc(m.retired_at)}</dd>` : ''}</dl>
${m.sources?.length ? `<h2>Sources</h2><ul>${m.sources.map(s => `<li>${link(s.url)} · seen ${esc(s.observed_at || 'date not listed')}</li>`).join('')}</ul>` : ''}</div>`;
}
module.exports = { href, select, withLiveCatalog, directoryList, directoryDetail };
