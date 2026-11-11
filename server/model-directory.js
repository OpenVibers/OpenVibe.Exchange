'use strict';
const { esc } = require('./render/html');

const href = id => `/models/${encodeURIComponent(id)}`;
const allowedStatus = new Set(['available', 'preview', 'spotted', 'retired']);
function select(models, query = {}) {
    const q = String(query.q || '').toLowerCase().slice(0, 120);
    const status = String(query.status || '').toLowerCase();
    const provider = String(query.provider || '').toLowerCase().slice(0, 80);
    return models.filter(m => (!q || `${m.name} ${m.id} ${m.family || ''}`.toLowerCase().includes(q))
        && (!allowedStatus.has(status) || m.status === status) && (!provider || m.provider.toLowerCase() === provider));
}
const usd = value => value == null || !Number.isFinite(Number(value)) ? 'Price not listed' : `$${Number(value)} per million tokens`;
function directoryList(models, query, activeSlugs = []) {
    const active = new Set(activeSlugs);
    const rows = select(models, query).filter(m => !active.has(m.id));
    return `<section class="ex-wrap" aria-labelledby="directory-more"><h2 id="directory-more">More models in the registry</h2>
<p>Provider-listed models stay here when routing is off or a provider retires them. Prices and availability are dated at their sources.</p>
<nav aria-label="Model status">${['all', 'available', 'preview', 'spotted', 'retired'].map(s => `<a class="ovk-btn ovk-btn--quiet" href="/models${s === 'all' ? '' : `?status=${s}`}">${esc(s)}</a>`).join(' ')}</nav>
${rows.length ? `<ul>${rows.map(m => `<li><a href="${href(m.id)}">${esc(m.name)}</a> · ${esc(m.provider_name || m.provider)} · ${esc(m.status)} · ${esc(m.context_window == null ? 'Context not listed' : `${m.context_window} tokens`)} · ${esc(usd(m.price?.output_per_million))}</li>`).join('')}</ul>` : '<p>No additional models match this filter.</p>'}</section>`;
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
${m.retired_at ? `<dt>Retired</dt><dd>${esc(m.retired_at)}</dd>` : ''}</dl></div>`;
}
module.exports = { href, select, directoryList, directoryDetail };
