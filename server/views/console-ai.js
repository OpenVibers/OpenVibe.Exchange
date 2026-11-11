'use strict';
/**
 * The owner console's AI supply sections, designed: Providers (who the Exchange routes to, in what order, at what
 * markup, with which keys), Models (each model's accepted price and the owner's override) and the Price book (what
 * providers' own pages say now, waiting for a yes). The data comes from AI's admin read models
 * (/api/v1/admin/console/:section); every form posts to the console routes in server/http/console.js.
 *
 * Keys are never shown: a provider says only whether one is stored. A number with no source says so in words.
 */
const { esc } = require('../render/html');
const marks = require('openvibe-shared/ai-marks');

const ACCESS = Object.freeze({
    OWN_DEPLOYMENT: ['Our own deployment', 'Runs on machines OpenVibe controls.'],
    AUTHORIZED_WHOLESALE: ['Resale agreed', 'An agreement allows selling it on.'],
    UNVERIFIED: ['Not verified', 'No resale agreement on file: people can use it with their own key only.'],
    RESTRICTED: ['Restricted', 'Its terms forbid resale.'],
});
const access = (v) => ACCESS[v] || [v ? String(v) : 'Not set', ''];
// A missing price is null, never $0 (the missing-is-not-zero rule); a real 0 reads "Free".
const price = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const money = (v) => { const n = price(v); return n == null ? null : n === 0 ? 'Free' : `$${n >= 0.1 ? n.toFixed(2) : String(Number(n.toPrecision(2)))}`; };
const host = (u) => { try { return new URL(String(u)).host; } catch { return ''; } };
const day = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10); };
const mark = (name, size = 36) => marks.mark(name, { size, label: false });
const tag = (text, tone = '') => `<span class="exc-tag${tone ? ` is-${tone}` : ''}">${esc(text)}</span>`;
const btn = (label, kind = 'quiet', type = 'submit') => `<button class="ovk-btn ovk-btn--${kind}" type="${type}">${esc(label)}</button>`;
const priceTriple = (c) => {
    if (!c) return '<span class="exc-quiet">No price yet</span>';
    const inp = money(c.in_per_mtok), out = money(c.out_per_mtok), cached = money(c.cached_per_mtok);
    if (!inp && !out) return '<span class="exc-quiet">No price yet</span>';
    return `<b>${esc(out || '–')}</b> out · ${esc(inp || '–')} in${cached ? ` · ${esc(cached)} cached` : ''}<small>per 1M tokens</small>`;
};
const healthWord = (h) => {
    const s = h && (h.state || h.status);
    if (!s) return null;
    if (/^(up|ok|healthy|closed)$/i.test(s)) return ['Healthy', 'ok'];
    if (/degrad|half/i.test(s)) return ['Degraded', 'warn'];
    if (/down|open|fail/i.test(s)) return ['Failing', 'bad'];
    return [String(s), ''];
};
// The route reasons the AI registry answers (server/exchange/offers.js), in the owner's words.
const ROUTE_WORDS = Object.freeze({
    no_provider: 'no provider', provider_off: 'provider off', no_key: 'no key', access_restricted: 'resale not allowed',
    model_off: 'model off', model_gone: 'gone from the provider list', kind_not_offered: 'kind not sold',
    price_unknown: 'no approved price',
});
const routeWords = (route) => (route && Array.isArray(route.reasons) ? route.reasons.map((r) => ROUTE_WORDS[r] || r).join(' · ') : '');

// ── Providers ──
function providerCard(p, models) {
    const key = encodeURIComponent(p.key || '');
    const on = p.status !== 'disabled';
    const [accessLabel, accessNote] = access(p.provider_access || (p.metadata && p.metadata.provider_access));
    const health = healthWord(p.health);
    const mine = models.filter((m) => m.provider === p.key);
    const tags = [
        tag(on ? 'On' : 'Off', on ? 'ok' : ''),
        tag(p.key_present ? 'Key stored' : 'No key', p.key_present ? '' : 'warn'),
        health ? tag(health[0], health[1]) : '',
        p.uncensored ? tag('18+', 'adult') : '',
        tag(accessLabel),
    ].join('');
    const settings = `<form class="exc-form" method="post" action="/console/providers/${key}/settings">
  <label><span>Status</span><select name="status"><option value="active"${on ? ' selected' : ''}>On</option><option value="disabled"${on ? '' : ' selected'}>Off</option></select></label>
  <label><span>Resale</span><select name="provider_access">${Object.entries(ACCESS).map(([v, [l]]) => `<option value="${v}"${(p.provider_access || '') === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
  <label><span>Order</span><input name="preference_order" type="number" min="0" max="1000" step="1" value="${esc(p.preference_order ?? p.priority ?? 50)}" inputmode="numeric"><small>Lower is tried first.</small></label>
  <label><span>Markup %</span><input name="markup_percent" type="number" min="0" max="500" step="0.5" value="${esc(p.markup_percent || 0)}" inputmode="decimal"><small>On top of the accepted price.</small></label>
  <label class="exc-check"><input type="checkbox" name="uncensored" value="1"${p.uncensored ? ' checked' : ''}><span>Uncensored models (18+ only)</span></label>
  <p class="exc-actions">${btn('Save settings', 'primary')}</p>
</form>`;
    const keyState = p.key_state || {};
    const check = p.last_check;
    const keyStatus = keyState.source === 'not_required' ? '<p>No key required.</p>'
        : keyState.hint ? `<p>Key ends in ${esc(keyState.hint)}${keyState.set_at ? ` · set on ${esc(keyState.set_at)}` : ''}.</p>` : '';
    const keyActions = `${keyStatus}
  ${check ? `<p>Check: ${check.ok ? 'OK' : esc(check.error || 'Failed')} · ${esc(check.latency_ms)} ms · ${esc(check.checked_at)}${check.ok && Number.isFinite(Number(check.models_count)) ? ` · ${esc(check.models_count)} models` : ''}</p>${Array.isArray(check.models) && check.models.length ? `<details><summary>Models this key can use</summary><ul>${check.models.map(id => `<li>${esc(id)}</li>`).join('')}</ul></details>` : ''}` : ''}
  <form method="post" action="/console/providers/${key}/check"><button class="ovk-btn ovk-btn--quiet" type="submit">Check provider</button></form>
  ${p.key_present || keyState.source === 'stored' ? `<form method="post" action="/console/providers/${key}/remove-key"><button class="ovk-btn ovk-btn--quiet" type="submit">Remove key and disable</button></form>` : ''}`;
    const keyForm = `${p.keys_url ? `<p><a href="${esc(p.keys_url)}" rel="noopener noreferrer" target="_blank">Create or find your API key</a>. Paste it below, save it, then Check provider to list the models it can use.</p>` : ''}<form class="exc-form exc-form--key" method="post" action="/console/providers/${key}/key">
  <label><span>${p.key_present ? 'Replace the key' : 'Add the key'}</span><input name="api_key" type="password" autocomplete="off" minlength="8" maxlength="400" required placeholder="Paste the provider's API key"><small>Stored sealed and bound to ${esc(host(p.base_url) || 'this provider')}; never shown again.</small></label>
  <p class="exc-actions"><button class="ovk-btn ovk-btn--quiet" type="submit" formaction="/console/providers/${key}/check">Check pasted key</button> ${btn(p.key_present ? 'Replace key' : 'Save key')}</p>
</form>`;
    const modelActions = p.metadata?.models_endpoint || ['openai', 'anthropic', 'responses', 'gemini'].includes(p.kind) ? `
  <p><a href="/console/providers/${key}/models">Models</a> · <a href="/console/sync">Sync log</a></p>
  <form method="post" action="/console/providers/${key}/sync"><button class="ovk-btn ovk-btn--quiet" type="submit">Sync models</button></form>
  <form method="post" action="/console/providers/${key}/model-settings">
    <label><input type="checkbox" name="auto_list_new_models" value="1"${p.metadata?.auto_list_new_models ? ' checked' : ''}>List new models automatically</label>
    <label>Sync schedule<select name="model_sync_interval_minutes">${[[0, 'Off'], [60, 'Hourly'], [360, 'Every six hours'], [1440, 'Daily']].map(([minutes, name]) => `<option value="${minutes}"${Number(p.metadata?.model_sync_interval_minutes || 0) === minutes ? ' selected' : ''}>${name}</option>`).join('')}</select></label>
    <button class="ovk-btn ovk-btn--quiet" type="submit">Save model settings</button>
  </form>` : '';
    return `<li class="exc-prov${on ? '' : ' is-off'}" id="p-${esc(p.key)}">
  <div class="exc-prov-head">${mark(p.key || p.display_name)}<div class="exc-prov-name"><b>${esc(p.display_name || p.key)}</b><small>${esc(host(p.base_url))}${mine.length ? ` · ${mine.length} ${mine.length === 1 ? 'model' : 'models'}` : ''} · order ${esc(p.preference_order ?? p.priority ?? '–')}${Number(p.markup_percent) ? ` · +${esc(p.markup_percent)}%` : ''}</small></div>
    <form method="post" action="/console/providers/${key}/status" class="exc-quick"><input type="hidden" name="status" value="${on ? 'disabled' : 'active'}">${btn(on ? 'Turn off' : 'Turn on')}</form></div>
  <p class="exc-tags">${tags}</p>
  ${accessNote ? `<p class="exc-note">${esc(accessNote)}</p>` : ''}
  <details class="exc-fold"><summary>Settings and key</summary><div class="exc-fold-body">${settings}${keyState.source === 'not_required' ? '' : keyForm}${keyActions}${modelActions}
    <form method="post" action="/console/providers/${key}/reset" class="exc-inline"><p class="exc-note">Reset clears its failure count and opens it to traffic again.</p>${btn('Reset health')}</form></div></details>
</li>`;
}

function cheapestOf(p) {
    const priced = (Array.isArray(p.models) ? p.models : []).filter((m) => m.cost && price(m.cost.out_per_mtok) != null);
    return priced.sort((a, b) => price(a.cost.out_per_mtok) - price(b.cost.out_per_mtok))[0] || null;
}
function presetCard(p) {
    const models = Array.isArray(p.models) ? p.models : [];
    const cheapest = cheapestOf(p);
    const [accessLabel] = access(p.provider_access);
    const first = p.default_model || (models[0] && models[0].model_key) || '';
    return `<li class="exc-preset">
  <div class="exc-prov-head">${mark(p.key || p.display_name, 32)}<div class="exc-prov-name"><b>${esc(p.display_name || p.key)}</b><small>${esc(host(p.base_url))} · ${models.length} ${models.length === 1 ? 'model' : 'models'}</small></div></div>
  <p class="exc-tags">${p.uncensored ? tag('18+', 'adult') : ''}${tag(accessLabel)}</p>
  ${cheapest ? `<p class="exc-price">${price(cheapest.cost.out_per_mtok) === 0 ? 'Has a <b>free</b> model' : `From <b>${esc(money(cheapest.cost.out_per_mtok))}</b> out per 1M`} · ${esc(cheapest.display_name || cheapest.model_key)}${cheapest.source ? ` · <a href="${esc(cheapest.source)}" rel="noopener noreferrer" target="_blank">their price page</a>` : ''}${cheapest.checked ? ` · checked ${esc(day(cheapest.checked))}` : ''}</p>` : '<p class="exc-note">No price confirmed on their own page yet.</p>'}
  <details class="exc-fold"><summary>Add with your key</summary><div class="exc-fold-body"><form class="exc-form" method="post" action="/console/providers">
    <input type="hidden" name="preset" value="custom"><input type="hidden" name="key" value="${esc(p.key)}"><input type="hidden" name="display_name" value="${esc(p.display_name || p.key)}"><input type="hidden" name="base_url" value="${esc(p.base_url || '')}"><input type="hidden" name="default_model" value="${esc(first)}">
    <label><span>API key</span><input name="api_key" type="password" autocomplete="off" minlength="8" maxlength="400" required placeholder="Paste the key from ${esc(host(p.base_url) || 'the provider')}"><small>Sealed and bound to ${esc(host(p.base_url) || 'its address')}. Its models arrive with the prices above; it starts on.</small></label>
    <p class="exc-actions">${btn('Add provider', 'primary')}</p></form></div></details>
</li>`;
}

function providersSection(data = {}) {
    const providers = Array.isArray(data.providers) ? data.providers : [];
    const models = Array.isArray(data.models) ? data.models : [];
    const added = new Set(providers.map((p) => p.key));
    const cost = (p) => { const c = cheapestOf(p); return c ? price(c.cost.out_per_mtok) : Infinity; };
    const presets = (Array.isArray(data.presets) ? data.presets : []).filter((p) => !added.has(p.key)).sort((a, b) => cost(a) - cost(b));
    const ordered = [...providers].sort((a, b) => (a.status === 'disabled') - (b.status === 'disabled') || (Number(a.preference_order ?? a.priority) - Number(b.preference_order ?? b.priority)));
    const on = providers.filter((p) => p.status !== 'disabled').length;
    const keyed = providers.filter((p) => p.key_present).length;
    const stats = [[on, 'on'], [keyed, keyed === 1 ? 'with a key' : 'with keys'], [presets.length, 'ready to add']].filter(([n]) => n);
    const custom = `<details class="exc-fold"><summary>Another OpenAI-compatible provider</summary><div class="exc-fold-body"><form class="exc-form" method="post" action="/console/providers">
  <label><span>Kind</span><select name="preset"><option value="custom">OpenAI-compatible</option><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option></select></label>
  <label><span>Name</span><input name="key" required pattern="[a-z0-9][a-z0-9._-]{1,40}" placeholder="lowercase, e.g. myprovider"></label>
  <label><span>Shown as</span><input name="display_name" placeholder="My Provider"></label>
  <label><span>Base URL</span><input name="base_url" type="url" placeholder="https://api.example.com/v1"></label>
  <label><span>Default model</span><input name="default_model" placeholder="model id"></label>
  <label><span>API key</span><input name="api_key" type="password" autocomplete="off" minlength="8" maxlength="400" required></label>
  <label class="exc-check"><input type="checkbox" name="vision" value="1"><span>Takes images</span></label>
  <p class="exc-actions">${btn('Add provider', 'primary')}</p></form></div></details>`;
    return `<div class="exc">
<header class="exc-head"><h2>Providers</h2><p>Who the Exchange routes to, in what order and at what markup. A key is stored sealed and never shown; "Not verified" providers serve people's own keys until a resale agreement is on file.</p>
${stats.length ? `<dl class="exc-stats">${stats.map(([n, l]) => `<div><dt>${esc(l)}</dt><dd>${esc(n)}</dd></div>`).join('')}</dl>` : ''}</header>
<section class="exc-sec"><h3>On the Exchange <span class="exc-n">${providers.length}</span></h3>${providers.length ? `<ul class="exc-list">${ordered.map((p) => providerCard(p, models)).join('')}</ul>` : '<p class="exc-note">No provider yet. Add one below.</p>'}</section>
${presets.length ? `<section class="exc-sec"><h3>Ready to add <span class="exc-n">${presets.length}</span></h3><p class="exc-note">Cheapest first, from each provider's own price page. Add one with its key and its models arrive with these prices.</p><ul class="exc-grid">${presets.map(presetCard).join('')}</ul></section>` : ''}
<section class="exc-sec">${custom}</section>
</div>`;
}

// ── Models ──
function modelsSection(data = {}) {
    const models = Array.isArray(data.models) ? data.models : [];
    const byProvider = new Map();
    for (const m of models) { if (!byProvider.has(m.provider)) byProvider.set(m.provider, []); byProvider.get(m.provider).push(m); }
    const row = (m) => {
        const id = m.model || m.model_key || m.id;
        const path = `/console/models/${encodeURIComponent(m.provider)}/${encodeURIComponent(id)}`;
        const o = m.owner_override;
        const accepted = m.accepted_price || m.cost;
        const route = m.route || null;
        const live = Boolean(route && route.live);
        const reasons = route && Array.isArray(route.reasons) ? route.reasons : [];
        const keyFirst = Boolean(route && !route.key_present);
        const priceFirst = reasons.includes('price_unknown') && !(route && route.pending_prices);
        const missing = Boolean(route && route.missing_since);
        const restricted = reasons.includes('access_restricted');
        const canOpen = Boolean(route && !keyFirst && !priceFirst && !missing && !restricted);
        const showOpen = Boolean(route && (!live || (route.pending_prices || 0) > 0));
        const submit = live ? 'Approve waiting prices' : 'Approve prices and open route';
        const open = showOpen ? `<form method="post" action="${path}/open" class="exc-inline">${canOpen
            ? `<button class="ovk-btn ${live ? 'ovk-btn--quiet' : 'ovk-btn--primary'}" type="submit">${esc(submit)}</button>`
            : `<button class="ovk-btn ovk-btn--quiet" type="submit" disabled>${keyFirst ? 'Add the provider key first' : priceFirst ? 'Approve a price first' : 'Resolve the gate first'}</button>`}</form>` : '';
        const routeLine = route ? `<p class="exc-route">${live ? tag('Live route', 'ok') : tag('Not routed', 'warn')}<small>${live
            ? 'The catalogue and the router list this offer.'
            : esc(routeWords(route) || 'not listed')}${route.pending_prices ? ` · ${esc(route.pending_prices)} waiting price${route.pending_prices === 1 ? '' : 's'}` : ''}</small></p>` : '';
        return `<li class="exc-model">
  <div class="exc-model-head"><b>${esc(m.display_name || id)}</b><small>${esc(id)}</small>
    <form method="post" action="${path}/status" class="exc-quick"><select name="status" aria-label="Status of ${esc(id)}">${['active', 'disabled'].map((s) => `<option value="${s}"${(m.status || 'active') === s ? ' selected' : ''}>${s === 'active' ? 'On' : 'Off'}</option>`).join('')}</select>${btn('Set')}</form></div>
  <div class="exc-model-prices"><span><em>Accepted</em>${priceTriple(accepted)}</span>${o ? `<span class="is-override"><em>Your price</em>${priceTriple(o.cost)}<small>${esc(o.reason || '')}</small></span>` : ''}</div>
  ${routeLine}
  ${open}
  ${m.metadata?.missing_since ? `<p>Gone from the provider list since ${esc(m.metadata.missing_since)}.</p>` : ''}
  ${accepted?.source ? `<p>Price source: <a href="${esc(accepted.source)}" rel="noopener noreferrer">${esc(accepted.source)}</a></p>` : ''}
  <form method="post" action="${path}/settings">
    <label>Display name<input name="display_name" required maxlength="200" value="${esc(m.display_name || id)}"></label>
    <label>Content tier<select name="content_tier"><option value="standard"${m.content_tier !== 'uncensored' ? ' selected' : ''}>Standard</option><option value="uncensored"${m.content_tier === 'uncensored' ? ' selected' : ''}>Uncensored (18+)</option></select></label>
    <button class="ovk-btn ovk-btn--quiet" type="submit">Save model settings</button>
  </form>
  <details class="exc-fold"><summary>${o ? 'Change your price' : 'Set your own price'}</summary><div class="exc-fold-body"><form class="exc-form exc-form--price" method="post" action="${path}/override">
    <label><span>In / 1M</span><input name="input_per_million" type="number" min="0" step="0.0001" inputmode="decimal" value="${esc(o && o.cost && o.cost.in_per_mtok != null ? o.cost.in_per_mtok : '')}"></label>
    <label><span>Cached / 1M</span><input name="cached_per_million" type="number" min="0" step="0.0001" inputmode="decimal" value="${esc(o && o.cost && o.cost.cached_per_mtok != null ? o.cost.cached_per_mtok : '')}"></label>
    <label><span>Out / 1M</span><input name="output_per_million" type="number" min="0" step="0.0001" inputmode="decimal" value="${esc(o && o.cost && o.cost.out_per_mtok != null ? o.cost.out_per_mtok : '')}"></label>
    <label class="exc-wide"><span>Why</span><input name="reason" required maxlength="500" placeholder="e.g. their promo price until Dec 1" value="${esc(o && o.reason || '')}"></label>
    <p class="exc-actions">${btn('Save price', 'primary')}</p></form>${o ? `<form method="post" action="${path}/override" class="exc-inline"><input type="hidden" name="clear" value="1">${btn('Use the accepted price')}</form>` : ''}</div></details>
</li>`;
    };
    return `<div class="exc">
<header class="exc-head"><h2>Models</h2><p>Every model by provider. The accepted price is what the price book confirmed on the provider's own page; your price, with its reason, replaces it until you clear it. The provider's markup applies on top.</p></header>
${models.length ? [...byProvider.entries()].map(([prov, list]) => `<section class="exc-sec"><h3>${mark(prov, 24)} ${esc(prov)} <span class="exc-n">${list.length}</span></h3><ul class="exc-list">${list.map(row).join('')}</ul></section>`).join('') : '<p class="exc-note">No models yet: add a provider and its models arrive.</p>'}
${Array.isArray(data.sync_log) ? syncSection(data) : ''}
</div>`;
}

function syncSection(data = {}) {
    const rows = Array.isArray(data.sync_log) ? data.sync_log : [];
    const lines = (r, key, label) => Array.isArray(r[key]) && r[key].length
        ? `<tr><td colspan="7"><details><summary>${esc(r.provider_key)} · ${r[key].length} ${label}</summary><ul>${r[key].map(model => `<li>${esc(label === 'new models' ? 'New model' : 'Retired model')}: <a href="/models/${encodeURIComponent(`${r.provider_key}/${model}`)}">${esc(model)}</a></li>`).join('')}</ul></details></td></tr>` : '';
    return `<table><caption>Model sync log</caption><thead><tr><th>Provider</th><th>Started</th><th>Status</th><th>Added</th><th>Updated</th><th>Gone</th><th>Error</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.provider_key)}</td><td>${esc(r.started_at)}</td><td>${esc(r.status)}</td><td>${esc(r.added)}</td><td>${esc(r.updated)}</td><td>${esc(r.missing)}</td><td>${esc(r.error_code || '')}</td></tr>${lines(r, 'added_models', 'new models')}${lines(r, 'missing_models', 'retired models')}`).join('')}</tbody></table>`;
}

// ── Price book ──
function pricebookSection(data = {}) {
    const pending = Array.isArray(data.pending) ? data.pending : [];
    const recent = Array.isArray(data.recent) ? data.recent : [];
    const confirmed = Array.isArray(data.confirmed) ? data.confirmed : [];
    const rep = data.report || null;
    // One change is one price of one model (price_changes: provider_key, model_key, field, old_price, new_price,
    // change_pct, source, checked_at).
    const FIELD = { in_per_mtok: 'input', cached_per_mtok: 'cached input', out_per_mtok: 'output' };
    const change = (c, open) => {
        const pct = c.change_pct == null || !Number.isFinite(Number(c.change_pct)) ? null : Number(c.change_pct) * (Math.abs(Number(c.change_pct)) <= 5 ? 100 : 1);
        const dir = c.old_price == null ? 'new' : Number(c.new_price) > Number(c.old_price) ? 'up' : 'down';
        return `<li class="exc-change">
  <div class="exc-model-head">${mark(c.provider_key, 24)}<b>${esc(c.model_key || '')}</b><small>${esc(c.provider_key || '')} · ${esc(FIELD[c.field] || c.field || '')} price per 1M${c.checked_at ? ` · read ${esc(day(c.checked_at))}` : ''}${c.source ? ` · <a href="${esc(c.source)}" rel="noopener noreferrer" target="_blank">their page</a>` : ''}</small></div>
  <p class="exc-delta is-${dir}"><span>${esc(money(c.old_price) || 'No price')}</span><span aria-hidden="true">→</span><b>${esc(money(c.new_price) || '–')}</b>${pct != null ? `<em>${pct > 0 ? '+' : ''}${esc(pct.toFixed(Math.abs(pct) < 10 ? 1 : 0))}%</em>` : ''}</p>
  ${open ? `<form method="post" action="/console/pricebook/changes/${encodeURIComponent(c.id)}" class="exc-inline exc-decide"><button class="ovk-btn ovk-btn--primary" name="decision" value="approve">Accept</button><button class="ovk-btn ovk-btn--quiet" name="decision" value="reject">Keep the current price</button></form>` : `<p class="exc-note">${esc(c.status === 'applied' ? 'Applied' : c.status || '')}${c.decided_at ? ` ${esc(day(c.decided_at))}` : ''}</p>`}
</li>`;
    };
    // Waiting changes, grouped the way the owner decides them: by provider, then one row per model with its input,
    // cached and output prices together. Accept for a model, for a provider, or for everything waiting (one form each,
    // carrying the change ids; /console/pricebook/decide applies them one by one through AI).
    const ids = (list) => list.map((c) => c.id).join(',');
    const decide = (list, accept, keep, kind = 'primary') => `<form method="post" action="/console/pricebook/decide" class="exc-inline exc-decide"><input type="hidden" name="ids" value="${esc(ids(list))}">${accept ? `<button class="ovk-btn ovk-btn--${kind}${kind === 'primary' ? '' : ' exc-pb-yes'}" name="decision" value="approve">${esc(accept)}</button>` : ''}${keep ? `<button class="ovk-btn ovk-btn--quiet" name="decision" value="reject">${esc(keep)}</button>` : ''}</form>`;
    const ORDER = ['in_per_mtok', 'cached_per_mtok', 'out_per_mtok'];
    const LABEL = { in_per_mtok: 'Input', cached_per_mtok: 'Cached', out_per_mtok: 'Output' };
    const providers = new Map();
    for (const c of pending) {
        const p = providers.get(c.provider_key) || new Map();
        const m = p.get(c.model_key) || [];
        m.push(c); p.set(c.model_key, m); providers.set(c.provider_key, p);
    }
    const isNew = (list) => list.every((c) => c.old_price == null);
    const fieldLine = (c) => {
        const pct = c.change_pct == null || !Number.isFinite(Number(c.change_pct)) ? null : Number(c.change_pct) * (Math.abs(Number(c.change_pct)) <= 5 ? 100 : 1);
        const dir = c.old_price == null ? 'new' : Number(c.new_price) > Number(c.old_price) ? 'up' : 'down';
        return `<span class="exc-pb-price is-${dir}"><em>${esc(LABEL[c.field] || FIELD[c.field] || c.field || '')}</em>${c.old_price != null ? `<s>${esc(money(c.old_price) || '')}</s>` : ''}<b>${esc(money(c.new_price) || '–')}</b>${pct != null && c.old_price != null ? `<i>${pct > 0 ? '+' : ''}${esc(pct.toFixed(Math.abs(pct) < 10 ? 1 : 0))}%</i>` : ''}</span>`;
    };
    const sourceOf = (list) => (list.find((c) => c.source) || {}).source || '';
    const modelRow = (model, list, { common, mixed }) => {
        const sorted = [...list].sort((a, b) => ORDER.indexOf(a.field) - ORDER.indexOf(b.field));
        const src = sourceOf(sorted);
        return `<li class="exc-pb-model">
  <div class="exc-pb-name"><b>${esc(model || '')}</b>${mixed && isNew(sorted) ? tag('New model', 'ok') : ''}${src && src !== common ? `<a href="${esc(src)}" rel="noopener noreferrer" target="_blank">${esc(host(src) || 'their page')}</a>` : ''}</div>
  <p class="exc-pb-prices">${sorted.map(fieldLine).join('')}</p>
  ${decide(sorted, 'Accept', 'Keep', 'quiet')}
</li>`;
    };
    const groups = [...providers.entries()].sort((a, b) => b[1].size - a[1].size || String(a[0]).localeCompare(String(b[0])));
    const fresh = [...providers.values()].reduce((n, models) => n + [...models.values()].filter(isNew).length, 0);
    const modelCount = [...providers.values()].reduce((n, models) => n + models.size, 0);
    const providerCard = ([provider, models]) => {
        const all = [...models.values()].flat();
        const read = all.map((c) => c.checked_at).filter(Boolean).sort().pop();
        const sources = [...models.values()].map(sourceOf).filter(Boolean);
        const common = sources.length && sources.every((x) => x === sources[0]) ? sources[0] : '';
        const newCount = [...models.values()].filter(isNew).length;
        const newWords = !newCount ? '' : newCount === models.size ? (models.size === 1 ? ', new' : ', all new') : `, ${newCount} new`;
        return `<li class="exc-pb-prov">
  <div class="exc-prov-head">${mark(provider, 32)}<span class="exc-prov-name"><b>${esc(provider || '')}</b><small>${models.size === 1 ? '1 model' : `${models.size} models`}${newWords} · ${all.length === 1 ? '1 price' : `${all.length} prices`}${read ? ` · read ${esc(day(read))}` : ''}${common ? ` · <a href="${esc(common)}" rel="noopener noreferrer" target="_blank">${esc(host(common) || 'their page')}</a>` : ''}</small></span>${models.size > 1 ? decide(all, `Accept all ${models.size}`, '', 'quiet') : ''}</div>
  <ul class="exc-pb-models">${[...models.entries()].map(([model, list]) => modelRow(model, list, { common, mixed: newCount > 0 && newCount < models.size })).join('')}</ul>
</li>`;
    };
    const reviewed = confirmed.length ? `<section class="exc-sec"><h3>Reviewed readings <span class="exc-n">${confirmed.length}</span></h3>
<p class="exc-note">Read from the providers' own pages and reviewed when they were added. Load them to put each price in the waiting list below; loading writes no price and switches no model on.</p>
<ul class="exc-list">${confirmed.map((c) => `<li class="exc-pb-model"><div class="exc-pb-name"><b>${esc(c.display_name || c.model_key || '')}</b><small>${esc(c.provider_key || '')} · ${esc(c.model_key || '')}${c.checked_at ? ` · read ${esc(day(c.checked_at))}` : ''}${c.source ? ` · <a href="${esc(c.source)}" rel="noopener noreferrer" target="_blank">${esc(host(c.source) || 'their page')}</a>` : ''}</small></div>
<p class="exc-pb-prices">${[['in_per_mtok', 'Input'], ['cached_per_mtok', 'Cached'], ['out_per_mtok', 'Output']].map(([field, label]) => `<span class="exc-pb-price"><em>${esc(label)}</em><b>${esc(money(c[field]) || '–')}</b></span>`).join('')}</p></li>`).join('')}</ul>
<form method="post" action="/console/pricebook/confirmed" class="exc-inline">${btn(`Load ${confirmed.length} reading${confirmed.length === 1 ? '' : 's'} into the waiting list`, 'primary')}</form></section>` : '';
    return `<div class="exc">
<header class="exc-head"><h2>Price book</h2><p>OpenVibe reads every provider's own price page on a schedule. A change waits here for your yes; nothing a provider publishes reaches people's bills unseen.</p>
<form method="post" action="/console/pricebook/run" class="exc-inline">${btn('Read their pages now')}${rep && rep.finished_at ? `<span class="exc-note">Last read ${esc(day(rep.finished_at))}${Array.isArray(rep.sources) ? ` · ${rep.sources.length} pages` : ''}</span>` : ''}</form></header>
${reviewed}
<section class="exc-sec"><h3>Waiting for you <span class="exc-n">${pending.length}</span></h3>${pending.length ? `<div class="exc-pb-all"><p class="exc-note">${modelCount === 1 ? '1 model' : `${modelCount} models`} from ${groups.length === 1 ? '1 provider' : `${groups.length} providers`}${fresh ? `: ${fresh === modelCount ? (fresh === 1 ? 'new to OpenVibe' : 'all new to OpenVibe') : `${fresh} new to OpenVibe`}` : ''}. A new model stays switched off until you turn it on in Models.</p>${groups.length > 1 ? decide(pending, `Accept all ${pending.length} prices`, '') : ''}</div>
<ul class="exc-list">${groups.map(providerCard).join('')}</ul>` : '<p class="exc-note">Nothing waiting: every price matches its provider\'s page.</p>'}</section>
${recent.length ? `<section class="exc-sec"><h3>Applied lately <span class="exc-n">${recent.length}</span></h3><ul class="exc-list">${recent.slice(0, 20).map((c) => change(c, false)).join('')}</ul></section>` : ''}
</div>`;
}


// The owner's GPU policy: every provider's switch, key (only the last four), order, classes, ceilings
// and share, plus the class caps and what each provider is doing right now. Data first; the forms are
// plain ovk markup so the main session can design the look without this code changing.
const nanoUsd = (n) => (n == null || n === '' ? null : `$${(Number(n) / 1e9).toFixed(2)}`);
const providerState = (gpuState, key) => {
    const instances = (gpuState && Array.isArray(gpuState.instances) ? gpuState.instances : []).filter((i) => i.marketplace === key);
    const live = instances.find((i) => ['starting', 'running', 'stopping'].includes(i.status));
    return live ? `${live.status} · ${live.gpu_class || live.job_class || 'interactive'} · ${live.gpu_name || ''} · ${nanoUsd(live.hourly_nano)}/h` : (gpuState && gpuState.marketplaces && gpuState.marketplaces[key] ? 'key set, idle' : 'no key');
};
function gpuPolicySection(data = {}) {
    const policy = data.policy && typeof data.policy === 'object' ? data.policy : null;
    const gpuState = data.gpus && data.gpus.state ? data.gpus.state : (data.gpus || null);
    const global = (policy && policy.global) || {};
    const providers = policy && Array.isArray(policy.providers) ? policy.providers : [];
    if (!policy && !gpuState) return '';
    const cap = gpuState ? { spent: nanoUsd(gpuState.spent_nano), committed: nanoUsd(gpuState.committed_nano), cap: nanoUsd(gpuState.cap_nano) } : null;
    const globalForm = `<form method="post" action="/console/gpu-policy/global" class="ovk-form">
  <label><span>Monthly cap (USD)</span><input name="monthly_cap_usd" type="number" min="0" step="0.01" value="${esc(global.monthly_cap_nano == null ? '' : Number(global.monthly_cap_nano) / 1e9)}"><small>${cap ? `${esc(cap.spent)} spent · ${esc(cap.committed)} committed of ${esc(cap.cap || 'no cap')}` : ''}</small></label>
  <label><span>Interactive cap (USD)</span><input name="interactive_cap_usd" type="number" min="0" step="0.01" value="${esc(global.interactive_cap_nano == null ? '' : Number(global.interactive_cap_nano) / 1e9)}"></label>
  <label><span>Batch cap (USD)</span><input name="batch_cap_usd" type="number" min="0" step="0.01" value="${esc(global.batch_cap_nano == null ? '' : Number(global.batch_cap_nano) / 1e9)}"></label>
  <label><span>Quote only</span><select name="quote_only"><option value="1"${global.quote_only ? ' selected' : ''}>Quotes only, rent nothing</option><option value="0"${global.quote_only ? '' : ' selected'}>Rent when the plan allows it</option></select></label>
  <p><button class="ovk-btn ovk-btn--primary" type="submit">Save caps</button></p>
</form>`;
    const providerCard = (p) => {
        const key = encodeURIComponent(p.key || '');
        const keyState = p.key_state || {};
        const live = providerState(gpuState, p.key);
        const classes = Array.isArray(p.classes) ? p.classes : [];
        const options = p.options && typeof p.options === 'object' ? p.options : {};
        return `<article class="ovk-card">
  <header><h3>${esc(p.key || 'provider')}</h3><p>${p.enabled ? '<span class="ovk-badge">Enabled</span>' : '<span class="ovk-badge">Off</span>'} ${p.configured ? '' : '<span class="ovk-badge">Not saved yet</span>'} ${keyState.present ? `<span class="ovk-badge">Key ends ${esc(keyState.last_four || '????')}</span>` : '<span class="ovk-badge">No key</span>'}</p><p>${esc(live)}</p></header>
  <form method="post" action="/console/gpu-policy/${key}" class="ovk-form">
    <label><span>Enabled</span><select name="enabled"><option value="1"${p.enabled ? ' selected' : ''}>On</option><option value="0"${p.enabled ? '' : ' selected'}>Off</option></select></label>
    <label><span>Order</span><input name="order" type="number" min="0" max="1000" step="1" value="${esc(p.order == null ? 50 : p.order)}"><small>Lower is tried first when two offers cost the same.</small></label>
    <fieldset><legend>Job classes</legend><label><input type="checkbox" name="classes" value="interactive"${classes.includes('interactive') ? ' checked' : ''}> Interactive</label><label><input type="checkbox" name="classes" value="batch"${classes.includes('batch') ? ' checked' : ''}> Batch</label></fieldset>
    <label><span>Interruptible allowed</span><select name="interruptible_allowed"><option value="1"${p.interruptible_allowed ? ' selected' : ''}>Yes, batch jobs with a checkpoint only</option><option value="0"${p.interruptible_allowed ? '' : ' selected'}>No</option></select></label>
    <label><span>Max $/GPU-hour</span><input name="max_hourly_usd" type="number" min="0" step="0.01" value="${esc(p.max_hourly_nano == null ? '' : Number(p.max_hourly_nano) / 1e9)}"></label>
    <label><span>Max replicas</span><input name="max_replicas" type="number" min="1" max="100" step="1" value="${esc(p.max_replicas == null ? 1 : p.max_replicas)}"></label>
    <label><span>Regions</span><input name="regions" maxlength="500" value="${esc(Array.isArray(p.regions) ? p.regions.join(', ') : '')}" placeholder="US, EU"><small>A comma-separated list; empty means any.</small></label>
    <label><span>Share of the monthly cap (%)</span><input name="monthly_cap_share_percent" type="number" min="0" max="100" step="1" value="${esc(p.monthly_cap_share_percent == null ? 100 : p.monthly_cap_share_percent)}"></label>
    <label><span>Provider options (JSON)</span><textarea name="options" rows="3">${esc(Object.keys(options).length ? JSON.stringify(options) : '')}</textarea><small>Organization, project, template, endpoint, monthly_nano: only what the provider needs.</small></label>
    <p><button class="ovk-btn ovk-btn--primary" type="submit">Save ${esc(p.key || 'provider')}</button></p>
  </form>
  <form method="post" action="/console/gpu-policy/${key}/key" class="ovk-form">
    <label><span>API key (write-only)</span><input name="api_key" type="password" autocomplete="new-password" minlength="8" maxlength="400"></label>
    <p><button class="ovk-btn ovk-btn--quiet" type="submit">Save key</button></p>
  </form>
</article>`;
    };
    const routing = `<table class="ovk-table"><caption>Class routing and caps</caption><thead><tr><th>Class</th><th>Providers allowed</th><th>Cap</th><th>Committed</th></tr></thead><tbody>
      ${['interactive', 'batch'].map((c) => `<tr><td>${c}</td><td>${esc(providers.filter((p) => Array.isArray(p.classes) && p.classes.includes(c)).map((p) => p.key).join(', ') || 'none')}</td><td>${esc(nanoUsd(global[c + '_cap_nano']) || 'the monthly cap')}</td><td>${esc(nanoUsd(gpuState && gpuState.by_class && gpuState.by_class[c]) || '$0.00')}</td></tr>`).join('')}
    </tbody></table>`;
    const instances = (gpuState && Array.isArray(gpuState.instances) ? gpuState.instances : []).filter((i) => ['starting', 'running', 'stopping'].includes(i.status));
    const instanceTable = instances.length ? `<table class="ovk-table"><caption>Live rentals</caption><thead><tr><th>Model</th><th>Provider</th><th>Class</th><th>GPU</th><th>Hourly</th><th>Status</th></tr></thead><tbody>${instances.map((i) => `<tr><td>${esc(i.model_key)}</td><td>${esc(i.marketplace)}</td><td>${esc(i.job_class || 'interactive')}${i.interruptible ? ' · interruptible' : ''}</td><td>${esc(i.gpu_name || '')}</td><td>${esc(nanoUsd(i.hourly_nano))}</td><td>${esc(i.status)}</td></tr>`).join('')}</tbody></table>` : '';
    return `<section class="ovk-section"><header><h2>GPU providers and job classes</h2><p>The owner's policy for every GPU provider: switch, key, order, classes, ceilings and share, and the monthly and per-class caps. Keys are write-only and only their last four are shown. Quote-only is the safe default.</p></header>
  ${gpuState ? `<p>${gpuState.enabled ? 'The provisioner is on.' : `The provisioner is off: ${esc(gpuState.reason || 'no key or no cap')}.`} ${gpuState.dry_run ? 'Quote-only is on.' : ''}</p>` : ''}
  ${globalForm}
  ${routing}
  ${providers.length ? `<div class="ovk-grid">${providers.map(providerCard).join('')}</div>` : '<p>No provider policy is available on this host.</p>'}
  ${instanceTable}
</section>`;
}

// ── GPU supply ──
function supplySection(data = {}) {
    const reports = Array.isArray(data.reports) ? data.reports : [];
    const settings = Array.isArray(data.settings) ? data.settings : [];
    const gate = data.gate || { ok: false, reason: 'GPU supply is not available on this host.' };
    const ACTION = {
        would_rent: 'Would rent the selected host', use_reseller: 'Buying these tokens is cheaper',
        would_stop: 'No demand right now', needs_measurement: 'Needs a measured throughput first',
        ceiling_required: 'The host hour is over the ceilings',
    };
    const form = (plan = {}) => `<form method="post" action="/console/supply" class="exc-form">
  <label><span>Model</span><input name="model" required maxlength="200" value="${esc(plan.model || '')}" placeholder="e.g. deepseek-r1-32b-abliterated"></label>
  <label><span>Runtime</span><select name="runtime">${['vllm', 'sglang'].map((r) => `<option value="${r}"${(plan.runtime || 'vllm') === r ? ' selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
  <label><span>Input USD / million</span><input name="input_per_million" type="number" min="0" step="any" required value="${esc(plan.input_per_million ?? '')}"></label>
  <label><span>Output USD / million</span><input name="output_per_million" type="number" min="0" step="any" required value="${esc(plan.output_per_million ?? '')}"></label>
  <label><span>Hourly spend ceiling USD</span><input name="hourly_ceiling_usd" type="number" min="0" step="any" required value="${esc(plan.hourly_ceiling_usd ?? '')}"></label>
  <label><span>Monthly spend ceiling USD</span><input name="monthly_ceiling_usd" type="number" min="0" step="any" required value="${esc(plan.monthly_ceiling_usd ?? '')}"></label>
  <label><span>Required VRAM MB</span><input name="required_vram_mb" type="number" min="1" step="1" required value="${esc(plan.required_vram_mb ?? '24000')}"></label>
  <label><span>Stop after idle minutes</span><input name="idle_minutes" type="number" min="1" step="1" required value="${esc(plan.idle_minutes ?? '10')}"></label>
  <label><span>Live supply</span><select name="enabled"><option value="0"${plan.enabled ? '' : ' selected'}>Off, quote only</option><option value="1"${plan.enabled ? ' selected' : ''}>On, rent when it is cheaper</option></select></label>
  <label class="exc-wide"><span>Type open to confirm a live plan</span><input name="confirm" maxlength="8" placeholder="open"></label>
  <p class="exc-actions">${btn('Save plan', 'primary')}</p>
</form>`;
    const planCard = (report, plan) => {
        const route = report.route || { registered: false };
        const selected = report.selected;
        const routeLine = route.registered
            ? `${route.live ? tag('Fixed route live', 'ok') : tag('Route registered, not live', 'warn')}<small>${esc(route.provider_key || '')} · ${route.fixed ? 'your fixed price' : 'the computed price'} · ${route.price && route.price.in != null ? `$${esc(route.price.in)} in / $${esc(route.price.out)} out per 1M` : 'no price'}${route.live ? '' : ` · ${esc(route.provider_status || '')}/${esc(route.model_status || '')}`}</small>`
            : `<span class="exc-quiet">${esc(route.reason || 'No host has registered this model yet.')}</span>`;
        const openRoute = route.registered && !route.live ? `<form method="post" action="/console/models/${encodeURIComponent(route.provider_key || '')}/${encodeURIComponent(plan.model || '')}/open" class="exc-inline">${btn('Open the fixed route', 'quiet')}</form>` : '';
        return `<li class="exc-pb-prov">
  <div class="exc-prov-head">${mark(plan.model || 'gpu', 32)}<span class="exc-prov-name"><b>${esc(plan.model || 'GPU plan')}</b><small>${esc(plan.runtime || '')} · ${esc(money(plan.input_per_million) || '–')} in / ${esc(money(plan.output_per_million) || '–')} out per 1M · ceiling ${esc(money(plan.hourly_ceiling_usd) || '–')}/h and ${esc(money(plan.monthly_ceiling_usd) || '–')}/month</small></span>${report.active ? tag('Live supply', 'ok') : report.enabled ? tag('Enabled, blocked', 'warn') : tag('Quote only')}</div>
  <p class="exc-tags">${report.enabled ? tag('Enabled') : ''}${selected ? tag(String(selected.gpu || '')) : ''}</p>
  <p class="exc-note">${esc(ACTION[report.action] || report.action || '')}${selected ? ` · ${esc(selected.provider || '')} ${esc(selected.gpu || '')} ${esc(selected.region || '')} at ${esc(money(selected.hourly_usd))}/h${report.rental_cost_usd != null ? ` · rent ${esc(money(report.rental_cost_usd))}/day` : ''}${report.reseller_cost_usd != null ? ` · buying ${esc(money(report.reseller_cost_usd))}/day` : ' · no resale price'}` : ''}</p>
  <p class="exc-route">${routeLine}</p>
  ${openRoute}
  ${form({ ...plan, enabled: Boolean(plan.enabled) })}
</li>`;
    };
    const plans = reports.map((report, i) => ({ report, plan: settings[i] || { ...report, ...(report.price ? { input_per_million: report.price.in, output_per_million: report.price.out } : {}) } }));
    return `<div class="exc">
<header class="exc-head"><h2>GPU supply</h2><p>What a rented GPU must earn per million tokens, and the host hour you will pay for it. The fixed prices are the route's price; a live plan asks for the cheapest host under your ceilings only when that is cheaper than buying the same tokens.</p>
<p class="exc-note">${gate.ok ? 'Owner gate open: a marketplace key, a monthly cap and a bounded cost allowance are set.' : `Gate closed: ${esc(gate.reason || 'the GPU provisioner is not set up')}`}</p></header>
<section class="exc-sec"><h3>Plans <span class="exc-n">${plans.length}</span></h3>${plans.length ? `<ul class="exc-list">${plans.map(({ report, plan }) => planCard(report, plan)).join('')}</ul>` : '<p class="exc-note">No plan yet. Save fixed prices and ceilings below to price a host; the route opens when a host registers it.</p>'}
<details class="exc-fold"><summary>Save another plan</summary><div class="exc-fold-body">${form({})}</div></details></section>
${gpuPolicySection(data)}
</div>`;
}

const SECTIONS = { providers: providersSection, models: modelsSection, pricebook: pricebookSection, supply: supplySection, sync: syncSection };
module.exports = { providersSection, modelsSection, pricebookSection, supplySection, gpuPolicySection, syncSection, SECTIONS, CSS: marks.CSS };
