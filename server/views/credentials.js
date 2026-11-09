'use strict';

const { esc } = require('../render/html');
const PROVIDERS = ['anthropic', 'openai', 'gemini', 'deepseek', 'mistral', 'xai', 'groq', 'cerebras', 'together', 'fireworks', 'openrouter', 'minimax', 'custom'];
const option = (value) => PROVIDERS.map((p) => `<option value="${p}"${p === value ? ' selected' : ''}>${p}</option>`).join('');

function credentialsPage({ credentials = [], error = null, balance = null }) {
    const cards = credentials.length ? credentials.map((c) => `<article class="ex-credential-card">
<div><strong>${esc(c.label || c.provider || c.kind)}</strong><span class="ex-credential-kind">${esc(c.kind === 'session_cookie' ? 'Browser session cookie' : 'API key')}</span></div>
<dl><dt>Provider</dt><dd>${esc(c.provider || '—')}</dd><dt>Status</dt><dd>${esc(c.status || (c.expired ? 'expired' : 'saved'))}</dd><dt>Added</dt><dd>${esc(c.created || '—')}</dd>${c.hint ? `<dt>Key hint</dt><dd>••••${esc(c.hint)}</dd>` : ''}${c.last_used ? `<dt>Last used</dt><dd>${esc(c.last_used)}</dd>` : ''}</dl>
${c.kind === 'session_cookie' || ['openrouter', 'deepseek'].includes(c.provider) ? `<form method="post" action="/privacy/credentials/${encodeURIComponent(c.id)}/balance"><button class="ovk-btn ovk-btn--quiet" type="submit">Check balance</button></form>` : ''}
<form method="post" action="/privacy/credentials/${encodeURIComponent(c.id)}/remove"><button class="ovk-btn ovk-btn--quiet" type="submit">Remove</button></form>
</article>`).join('') : '<p class="ex-prose">No provider credentials are saved to your AI account yet.</p>';
    return `<div class="ex-wrap ex-page ex-credentials">
<header class="ex-credentials-head"><p class="ex-eyebrow">Your account</p><h1>Your keys and accounts</h1><p class="ex-prose">Provider keys and browser session cookies are stored encrypted by OpenVibe.AI. This page shows metadata and never displays a saved value.</p></header>
${error ? `<p class="ex-console-error" role="alert">${esc(error)}</p>` : ''}
${balance ? `<section class="ex-credential-balance" role="status"><h2>Balance from ${esc(balance.credential && balance.credential.provider || balance.provider || 'provider')}</h2><pre>${esc(JSON.stringify(balance.values || balance.balance || balance, null, 2))}</pre></section>` : ''}
<section class="ex-credential-section"><h2>Saved credentials</h2><div class="ex-credential-list">${cards}</div></section>
<section class="ex-credential-section"><h2>Add a provider API key</h2><form class="ovk-form ex-credential-form" method="post" action="/privacy/credentials">
<input type="hidden" name="kind" value="api_key"><label>Provider<select name="provider">${option('openai')}</select></label>
<label>API key<input name="key" type="password" autocomplete="new-password" required minlength="8" maxlength="400"></label>
<label>Label (optional)<input name="label" maxlength="80" autocomplete="off"></label>
<label>Custom base URL (custom provider only)<input name="base_url" type="url" placeholder="https://api.example.com/v1"></label>
<button class="ovk-btn ovk-btn--primary" type="submit">Save and check key</button></form></section>
<section class="ex-credential-section"><h2>Add a browser session cookie</h2><p class="ex-prose">A session cookie can grant access to your provider account until it expires or you remove it. Use a dedicated browser session and remove it here when you no longer need it. OpenVibe.AI stores it encrypted and checks only the provider balance endpoints it supports.</p>
<form class="ovk-form ex-credential-form" method="post" action="/privacy/credentials"><input type="hidden" name="kind" value="session_cookie">
<label>Provider<select name="provider"><option value="anthropic">Anthropic</option><option value="openai">OpenAI</option></select></label>
<label>Cookie value<input name="cookie" type="password" autocomplete="new-password" required minlength="16" maxlength="4096"></label>
<label>Anthropic organization ID (required for Anthropic)<input name="org_id" autocomplete="off" placeholder="UUID from provider console"></label>
<button class="ovk-btn ovk-btn--quiet" type="submit">Save session cookie</button></form></section>
</div>`;
}

module.exports = { credentialsPage, PROVIDERS };
