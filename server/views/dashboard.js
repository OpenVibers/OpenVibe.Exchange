'use strict';
/**
 * The Dashboard (Opus's design, 2026-11-09): one page per tab, server-rendered, with the kit's tab rail. Keys are cards
 * with their prefix, cap and models; a new key's secret shows once on its own page; Usage starts with the totals and
 * a day-by-day bar, then one two-line row per day, key and model (names, not ids), with the CSV beside the title.
 * Credits, Deployments and Settings each say in one line what lives there and link to it.
 */
const kit = require('openvibe-shared/kit');
const { esc } = require('../render/html');

const TABS = [['keys', 'Keys'], ['usage', 'Usage'], ['credits', 'Credits'], ['deployments', 'Deployments'], ['settings', 'Settings']];
const money = (v) => {
    const n = Number(v) || 0;
    if (n === 0) return '$0';
    if (n < 0.01) return `$${Number(n.toPrecision(2))}`;
    return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const count = (v) => {
    const n = Number(v) || 0;
    if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
    if (n >= 1e3) return `${Number((n / 1e3).toFixed(n >= 1e4 ? 0 : 1))}k`;
    return n.toLocaleString('en-US');
};
const day = (iso) => {
    const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
    return Number.isNaN(d.getTime()) ? String(iso || '') : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
};
/** A key's expiry, to the minute and with its year: "Jan 1, 2027, 00:00 UTC". */
const expiry = (iso) => {
    const d = new Date(String(iso || ''));
    if (Number.isNaN(d.getTime())) return String(iso || '');
    const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    return `${date}, ${d.toISOString().slice(11, 16)} UTC`;
};
const plural = (n, one, many = `${one}s`) => `${Number(n).toLocaleString('en-US')} ${Number(n) === 1 ? one : many}`;

/** The frame every tab shares: the page head, the tab rail, the tab's body. */
function shell(tab, body) {
    return `<div class="ex-wrap xd">${kit.head({ title: 'Dashboard', sub: 'Keys, usage and endpoints for the Exchange API' })}${kit.tabs({
        label: 'Dashboard', active: tab, items: TABS.map(([key, label]) => ({ key, label, href: `/dashboard/${key}` })),
    })}<div class="xd-body">${body}</div></div>`;
}

function keyCard(k) {
    const models = Array.isArray(k.allowed_models) && k.allowed_models.length ? plural(k.allowed_models.length, 'model') : 'every model';
    const made = k.created_at ? `made ${day(k.created_at)}` : '';
    const revoked = !!k.revoked_at;
    return `<li class="xd-key${revoked ? ' is-revoked' : ''}"><div class="xd-key-main"><strong>${esc(k.name)}</strong><code>${esc(k.prefix)}…</code></div>`
        + `<p class="xd-key-meta">${esc([`${money(k.monthly_cap_usd)} a month`, models, k.expires_at ? `expires ${expiry(k.expires_at)}` : '', revoked ? `revoked ${day(k.revoked_at)}` : made].filter(Boolean).join(' · '))}</p>`
        + (revoked ? '' : `<form method="post" action="/dashboard/keys/${encodeURIComponent(k.id)}/revoke" class="xd-key-act">${kit.button({ label: 'Revoke', type: 'submit', kind: 'danger', small: true })}</form>`)
        + '</li>';
}

function keysPage(keys = []) {
    const live = keys.filter((k) => !k.revoked_at);
    const list = keys.length
        ? `<ul class="xd-keys">${keys.map(keyCard).join('')}</ul>`
        : kit.empty({ title: 'No keys yet', text: 'Make one below. Its secret shows once, when you make it.' });
    return shell('keys', `<section class="xd-card"><h2>Your keys${live.length ? `<span class="ovk-count">${live.length}</span>` : ''}</h2>${list}</section>`
        + `<section class="xd-card" id="new"><h2>New key</h2><p class="xd-note">The secret shows once, when you make it. Calls stop when the month's spend reaches the cap.</p>`
        + '<form class="xd-form" method="post" action="/dashboard/keys">'
        + '<label><span>Name</span><input name="name" required maxlength="80" placeholder="My application" autocomplete="off"></label>'
        + '<label><span>Monthly cap</span><span class="xd-money"><span aria-hidden="true">$</span><input name="monthly_cap_usd" type="number" min="1" step="0.01" value="5" required inputmode="decimal" aria-describedby="cap-hint"></span><small id="cap-hint">Each call holds up to $1 (or its max_cost_usd) until it finishes; the unused part comes back.</small></label>'
        + '<label><span>Expiry (UTC; optional)</span><input name="expires_at" type="datetime-local"></label>'
        + '<label><span>Models it may call</span><input name="allowed_models" placeholder="Every model" autocomplete="off" aria-describedby="models-hint"><small id="models-hint">Model ids, comma separated, e.g. deepseek/deepseek-chat. Empty allows every model.</small></label>'
        + `${kit.button({ label: 'Make the key', type: 'submit' })}</form></section>`);
}

function newKeyPage(secret, key = null) {
    return shell('keys', `<section class="xd-card xd-secret"><h2>Copy your key now</h2><p class="xd-note">${key && key.name ? `<strong>${esc(key.name)}</strong>: ` : ''}this is the only time it shows. Keep it in your app's secrets; anyone with it can spend up to its cap.</p>`
        + `${kit.snippet({ code: secret, id: 'new-key' })}<p class="xd-actions">${kit.button({ href: '/dashboard/keys', label: 'Done' })}</p></section>`);
}

/** Usage rows from the API (by day, key, model and status) with key names; the newest day first. */
function usagePage(rows = [], keys = []) {
    const names = new Map(keys.map((k) => [k.id, k.name]));
    const totals = rows.reduce((t, r) => ({
        cost: t.cost + (Number(r.cost_usd) || 0), requests: t.requests + (Number(r.requests) || 0),
        tokens: t.tokens + (Number(r.tokens_in) || 0) + (Number(r.tokens_out) || 0),
    }), { cost: 0, requests: 0, tokens: 0 });
    const days = [...new Set(rows.map((r) => String(r.day).slice(0, 10)))].sort();
    const head = `<div class="xd-title"><h2>Usage</h2>${rows.length ? `<a class="ovk-btn ovk-btn--quiet ovk-btn--small" href="/dashboard/usage.csv" download><span>CSV</span></a>` : ''}</div>`;
    if (!rows.length) return shell('usage', `<section class="xd-card">${head}${kit.empty({ title: 'No usage yet', text: 'Calls made with your keys show here by day, key and model, with their tokens and cost.' })}</section>`);
    const span = days.length > 1 ? `${day(days[0])} – ${day(days[days.length - 1])}` : day(days[0]);
    const stat = (v, label) => `<div><dd>${esc(v)}</dd><dt>${esc(label)}</dt></div>`;
    // Requests per day, the last 14 days that have any: bars scaled to the busiest one (the rows below hold the numbers).
    const shown = days.slice(-14);
    const perDay = shown.map((d) => [d, rows.filter((r) => String(r.day).slice(0, 10) === d).reduce((n, r) => n + (Number(r.requests) || 0), 0)]);
    const peak = Math.max(1, ...perDay.map(([, n]) => n));
    const bars = `<div class="xd-bars" aria-hidden="true">${perDay.map(([d, n]) => `<span title="${esc(`${day(d)}: ${plural(n, 'request')}`)}"><i style="height:${Math.max(4, Math.round((n / peak) * 100))}%"></i><b>${esc(day(d).replace(/^[A-Za-z]+ /, ''))}</b></span>`).join('')}</div>`;
    const byDay = [...days].reverse().map((d) => {
        const items = rows.filter((r) => String(r.day).slice(0, 10) === d)
            .sort((a, b) => (Number(b.cost_usd) || 0) - (Number(a.cost_usd) || 0))
            .map((r) => {
                const key = names.get(r.key_id) || r.key_id;
                const state = r.status && r.status !== 'settled' ? `<span class="xd-chip">${esc(r.status)}</span>` : '';
                return `<li><div class="xd-use-top"><code>${esc(r.model)}</code><strong>${esc(money(r.cost_usd))}</strong></div>`
                    + `<p>${esc([key, plural(r.requests, 'request'), `${count(r.tokens_in)} in · ${count(r.tokens_out)} out`].join(' · '))}${state}</p></li>`;
            }).join('');
        return `<h3 class="xd-day">${esc(day(d))}</h3><ul class="xd-use">${items}</ul>`;
    }).join('');
    return shell('usage', `<section class="xd-card">${head}<p class="xd-note">${esc(span)}</p>`
        + `<dl class="xd-stats">${stat(money(totals.cost), 'spent')}${stat(count(totals.requests), 'requests')}${stat(count(totals.tokens), 'tokens')}</dl>`
        + `${bars}</section><section class="xd-card"><h2 class="xd-sub">By day, key and model</h2>${byDay}</section>`);
}

function creditsPage() {
    return shell('credits', '<section class="xd-card"><h2>Credits</h2><p class="xd-note">Credits pay for managed models. Your balance, top-ups and auto top-up live in your OpenVibe wallet, the same one on every OpenVibe site.</p>'
        + `<p class="xd-actions">${kit.button({ href: 'https://openvibe.network/my#wallet', label: 'Open your wallet' })}</p>`
        + '<p class="xd-note">With your own provider key, calls cost the provider\'s price and nothing more: 0% fee, no cap.</p></section>');
}

function deploymentsPage(endpoints = []) {
    const rows = endpoints.map((e) => `<li><div class="xd-use-top"><code>${esc(e.model || '')}</code><span class="xd-chip">${esc(e.status || '')}</span></div><p>${esc(e.id || '')}${e.price_per_hour != null ? ` · ${esc(money(e.price_per_hour))} an hour` : ''}</p></li>`).join('');
    return shell('deployments', '<section class="xd-card"><h2>Deployments</h2><p class="xd-note">Your own endpoint: a model on a GPU of its own, private to you. The hourly price shows before it starts, and it stops when idle.</p>'
        + `<p class="xd-actions">${kit.button({ href: '/own', label: 'Price an endpoint' })}</p>`
        + (rows ? `<ul class="xd-use">${rows}</ul>` : kit.empty({ title: 'No deployments yet', text: 'An endpoint you start shows here with its status and price.' }))
        + '</section>');
}

function settingsPage() {
    const item = (href, title, sub) => kit.row({ href, title, sub, trail: kit.icon('chevron') });
    return shell('settings', `<section class="xd-card"><h2>Settings</h2>${kit.list([
        item('/privacy/keys', 'Your provider keys', 'Bring your own key at a 0% fee, and choose the data policy for your calls.'),
        item('/api#privacy', 'Routing and strict privacy', 'Prefer the cheapest or the fastest route; keep prompts out of every log.'),
        item('/uncensored', 'Adult models (18+)', 'Opt in to uncensored models. The content floor applies on every request.'),
    ], { flush: true })}</section>`);
}

function unavailablePage() {
    return shell('', '<section class="xd-card">' + kit.empty({ title: 'The account API did not answer', text: 'Nothing was changed. Try again in a moment.' }) + '</section>');
}

module.exports = { keysPage, newKeyPage, usagePage, creditsPage, deploymentsPage, settingsPage, unavailablePage, TABS };
