'use strict';
/**
 * /deep-dive: the start, a run's live steps and its report (plain kit markup; the look is the main session's).
 *
 * The words are the owner's (deep-dive.md): "Deep dive", "Expert design research: we search everywhere, capture
 * the best sites at phone and computer sizes, and tell you what works and why.", "What are you designing?", the
 * three depths with their prices, and the step names Planning, Searching, Choosing sites, Capturing, Analysing,
 * Writing it up. Nothing here restyles another page; it uses kit.head, kit.section, kit.badge, kit.button,
 * kit.empty and kit.table, and plain lists and forms.
 *
 * Every screenshot is private to the run's owner and is shown through /deep-dive/:id/shot/:shot with its source
 * URL and capture date as commentary, never republished wholesale.
 */
const kit = require('openvibe-shared/kit');
const { esc, raw } = require('../render/html');

const STEP_LABELS = { plan: 'Planning', search: 'Searching', choose: 'Choosing sites', capture: 'Capturing', analyse: 'Analysing', synthesise: 'Writing it up', report: 'Writing it up' };
const STEP_NOTES = { plan: 'The questions an expert would ask, and the searches that answer them.', search: 'MegaSource, the search engines, GitHub and our own rules and components.', choose: 'The sites worth capturing, with a reason each. Add or drop any before Capture.', capture: 'Each site at 390 and 1280 px, light and dark where it supports dark, full page after a slow scroll.', analyse: 'A vision model reads each screenshot; a text model reads the DOM facts and the words.', synthesise: 'Patterns across sites, the gap, reference tokens, and recommendations checked against our rules.', report: 'The report, its evidence and the receipt.' };
const price = (n) => `$${Number(n || 0).toFixed(2)}`;
const when = (iso) => { if (!iso) return '—'; try { return new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; } catch { return String(iso); } };
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return String(u || ''); } };
const pct = (n) => Math.max(0, Math.min(100, Math.round((Number(n) || 0) * 100)));

function stepList(steps, current = null) {
    const given = new Map((steps || []).map((s) => [s.key, s]));
    const list = Object.keys(STEP_LABELS).map((key) => ({ key, status: 'pending', ...(given.get(key) || {}) }));
    return `<ol class="dd-steps">${list.map((s) => {
        const label = STEP_LABELS[s.key] || s.key;
        const detail = s.detail || (s.status === 'pending' ? 'Waiting' : '');
        return `<li class="dd-step is-${esc(s.status || 'pending')}" data-step="${esc(s.key)}"><strong>${esc(label)}</strong>${s.key === current ? ' <span class="ovk-badge">now</span>' : ''}<span>${esc(detail || '')}</span></li>`;
    }).join('')}</ol>`;
}

function progressBar(progress) {
    return `<div class="dd-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct(progress)}"><span style="display:block;width:${pct(progress)}%"></span></div>`;
}

function depthCards(depths, selected = 'quick') {
    return `<fieldset class="dd-depths"><legend>Depth</legend>${(depths || []).map((d) => `<label class="dd-depth"><input type="radio" name="depth" value="${esc(d.key)}"${d.key === selected ? ' checked' : ''}> <strong>${esc(d.label || d.key)}</strong> <span>${esc(String(d.sites || ''))} sites · about ${esc(String(d.minutes || '?'))} min · ${price(d.price_usd)}</span><small>${esc(d.analysis || '')}</small></label>`).join('')}</fieldset>`;
}

function depthList(depths) {
    return `<ul class="dd-depth-list">${(depths || []).map((d) => `<li><strong>${esc(d.label || d.key)}</strong> <span>${esc(String(d.sites || ''))} sites · about ${esc(String(d.minutes || '?'))} min · ${price(d.price_usd)}</span> <small>${esc(d.analysis || '')}</small></li>`).join('')}</ul>`;
}

function signIn(next = '/deep-dive') {
    return kit.empty({ icon: 'person', title: 'Sign in to run a deep dive', text: 'A deep dive keeps private screenshots and spends your allowance, so it needs your account. You can read what it does below first.', action: { href: `/auth/login?next=${encodeURIComponent(next)}`, label: 'Sign in with OpenVibe' } });
}

function whatItDoes() {
    return kit.section({ title: 'What a deep dive does', body: `<ol class="dd-what">
<li><strong>Search every way we have.</strong> Our research sources, Exchange's web, picture and icon engines, open-source projects on GitHub, design write-ups, and our own rules register and component registry.</li>
<li><strong>Choose the sites worth a look.</strong> A model ranks them with a reason each; you can add or drop any before Capture (Quick goes straight on).</li>
<li><strong>Capture them properly.</strong> 390 and 1280 px, dark and light where the site supports it, the whole page after a slow scroll so lazy sections load, and the DOM facts: type scale, palette, spacing, radii, shadows, grid, navigation, heading outline, button and link words, components. Expert adds open menus, hover and focus states, a transition frame strip, axe-core findings and LCP/CLS/INP.</li>
<li><strong>Read them.</strong> A vision model reads each screenshot and a text model reads the measured facts and the words: hierarchy, density, what draws the eye, what is good and what fails.</li>
<li><strong>Synthesise.</strong> The patterns and how many sites use each, a comparison, the best version, what everyone gets wrong, the gap nobody fills, reference tokens as inspiration, do and don't, accessibility and speed, and recommendations checked against OpenVibe's own rules.</li>
<li><strong>Show the evidence.</strong> Every claim names its site, capture and the date it was read. Screenshots stay private to you and are shown as attributed commentary, never republished.</li>
</ol>
<p class="ovk-note">The price is shown before it starts and held; cancelling stops the spend. No paid screenshot service: our own Chrome, one page budget at a time.</p>` });
}

function homePage({ viewer, depths = [], capture = null, error = null }) {
    const signedIn = Boolean(viewer && viewer.kind === 'user');
    const cards = (depths && depths.length ? depths : [
        { key: 'quick', label: 'Quick', sites: 6, minutes: 3, price_usd: 0.2, analysis: 'captures and reads each site' },
        { key: 'thorough', label: 'Thorough', sites: 15, minutes: 8, price_usd: 0.5, analysis: 'more sites' },
        { key: 'expert', label: 'Expert', sites: 30, minutes: 18, price_usd: 1.2, analysis: 'plus interactions, accessibility and speed' },
    ]).map((d) => ({ ...d, key: d.key || d.depth, price_usd: d.price_usd ?? d.price }));
    const form = signedIn
        ? `<form method="post" action="/deep-dive" class="dd-form">
<label class="dd-field"><span>What are you designing?</span><textarea name="question" rows="3" maxlength="500" required placeholder="a phone-first robot control panel"></textarea></label>
${depthCards(cards)}
<label class="dd-field"><span>Sites you already know (optional, one per line)</span><textarea name="sites" rows="2" maxlength="2048" placeholder="https://example.com/panel"></textarea></label>
<p class="dd-go">${kit.button({ label: 'Start the deep dive', type: 'submit' })}<span class="ovk-note">The price is held before it starts; you can cancel at any step.</span></p>
</form>${error ? `<p class="dd-error" role="alert">${esc(error)}</p>` : ''}`
        : signIn();
    return `<div class="ex-wrap dd">${kit.head({ title: 'Deep dive', sub: 'Expert design research: we search everywhere, capture the best sites at phone and computer sizes, and tell you what works and why.' })}${form}${signedIn ? '' : `<section class="ovk-section"><h2>The depths and their prices</h2>${depthList(cards)}</section>`}`
        + (capture && capture.enabled === false ? `<p class="dd-error">Capture is off on this host right now (drill mode or Chrome missing), so a deep dive cannot start.</p>` : '')
        + whatItDoes() + `</div>`;
}

function choosing(row, id) {
    const candidates = row.candidates || [];
    return kit.section({ title: 'Choose the sites to capture', note: 'Add or drop any site now. Capture starts when you say so (or when the wait ends).', body:
        `<ul class="dd-candidates">${candidates.map((c) => `<li><a href="${esc(c.url)}" rel="noopener noreferrer">${esc(c.title || host(c.url))}</a><span>${esc(c.reason || '')}</span><form method="post" action="/deep-dive/${encodeURIComponent(id)}/sites" class="dd-inline"><input type="hidden" name="drop" value="${esc(c.url)}">${kit.button({ label: 'Drop', type: 'submit', kind: 'quiet', small: true })}</form></li>`).join('')}</ul>
<form method="post" action="/deep-dive/${encodeURIComponent(id)}/sites" class="dd-form"><label class="dd-field"><span>Add a site (one per line)</span><textarea name="sites" rows="2" maxlength="2048"></textarea></label><input type="hidden" name="start" value="1"><p class="dd-go">${kit.button({ label: 'Start capture', type: 'submit' })}</p></form>` });
}

function evidenceList(list, id) {
    if (!list || !list.length) return '';
    return `<ul class="dd-evidence">${list.map((e) => `<li>${esc(e.claim)}${e.capture_id ? ` <a href="/deep-dive/${encodeURIComponent(id)}/shot/${encodeURIComponent(e.crop_id || e.capture_id)}" rel="noopener noreferrer">capture</a>` : ''} <a href="${esc(e.url)}" rel="noopener noreferrer">${esc(host(e.url))}</a> <span class="ovk-note">read ${esc(when(e.read_at))}</span></li>`).join('')}</ul>`;
}

function capturesSection(report, id, limit = 8) {
    const caps = (report.captures || []).filter((c) => c.media_id && !c.skip).slice(0, limit);
    if (!caps.length) return kit.section({ title: 'Captures', body: '<p>No site could be captured.</p>' });
    return kit.section({ title: 'Captures', count: caps.length, note: 'Private to you. Each shot keeps its source and the date it was read; it is shown as commentary, never republished.', body:
        `<div class="dd-shots">${caps.map((c) => {
            const crop = (c.crops || [])[0];
            const src = crop || c;
            return `<figure class="dd-shot"><a href="/deep-dive/${encodeURIComponent(id)}/shot/${encodeURIComponent(src.id || c.id)}" rel="noopener noreferrer"><img src="/deep-dive/${encodeURIComponent(id)}/shot/${encodeURIComponent(src.id || c.id)}" alt="Capture of ${esc(host(c.url))} at ${c.viewport} px, ${esc(c.theme)}" loading="lazy"></a><figcaption><a href="${esc(c.url)}" rel="noopener noreferrer">${esc(host(c.url))}</a> · ${c.viewport} px · ${esc(c.theme)} · ${esc(when(c.captured_at))}${c.cached ? ' · from the 7-day cache' : ''}${c.skip ? ` · ${esc(c.skip)}` : ''}</figcaption></figure>`;
        }).join('')}</div>` });
}

function analysisSection(report, id) {
    const rows = (report.analysis || []).map((a) => `<article class="dd-analysis"><h3><a href="${esc(a.url)}" rel="noopener noreferrer">${esc(host(a.url))}</a></h3><p>${esc(a.summary)}</p>`
        + (a.first_impression ? `<p><strong>First impression:</strong> ${esc(a.first_impression)}</p>` : '')
        + `<p class="ovk-note">${[a.hierarchy && `Hierarchy: ${a.hierarchy}`, a.density && `Density: ${a.density}`, a.type && `Type: ${a.type}`, a.colour && `Colour: ${a.colour}`, a.motion && `Motion: ${a.motion}`, a.words && `Words: ${a.words}`].filter(Boolean).map(esc).join(' · ')}</p>`
        + (a.strengths && a.strengths.length ? `<p><strong>Good:</strong> ${a.strengths.map(esc).join('; ')}</p>` : '')
        + (a.weaknesses && a.weaknesses.length ? `<p><strong>Fails:</strong> ${a.weaknesses.map(esc).join('; ')}</p>` : '')
        + (a.accessibility ? `<p><strong>Accessibility:</strong> ${esc(a.accessibility)}</p>` : '')
        + (a.speed ? `<p><strong>Speed:</strong> ${esc(a.speed)}</p>` : '')
        + evidenceList(a.evidence, id) + `</article>`).join('') || '<p>No site was analysed.</p>';
    return kit.section({ title: 'What each site does', body: rows });
}

function synthesisSection(report, id) {
    const s = report.synthesis || {};
    const patterns = (s.patterns || []).length ? `<ul class="dd-patterns">${s.patterns.map((p) => `<li><strong>${esc(p.name)}</strong> <span class="ovk-badge">${esc(String(p.usage_count || (p.sites || []).length))} sites</span><p>${esc(p.what)}</p>${evidenceList(p.evidence, id)}</li>`).join('')}</ul>` : '<p>No pattern was found.</p>';
    const table = s.comparison && (s.comparison.columns || []).length
        ? kit.table({ columns: s.comparison.columns.map((c, i) => ({ key: `c${i}`, label: c })), rows: (s.comparison.rows || []).map((r) => Object.fromEntries((s.comparison.columns || []).map((c, i) => [`c${i}`, r[i] == null ? '—' : String(r[i])]))) })
        : '';
    const tokens = s.reference_tokens || {};
    const tokenList = (list, label, render) => (list || []).length ? `<h3>${esc(label)}</h3><ul>${list.slice(0, 12).map((t) => `<li>${esc(t.source_id || '')}: ${render(t)}</li>`).join('')}</ul>` : '';
    const recs = (report.recommendations || []).length ? `<ol class="dd-recs">${report.recommendations.map((r) => `<li><strong>${esc(r.what)}</strong><p>${esc(r.why)}</p><p class="ovk-note">${r.rule && r.rule.id ? `Rule ${esc(r.rule.id)} (${esc(r.rule.status)}): ${esc(r.rule.text)}` : 'No existing rule: a proposed new one.'}</p>${evidenceList(r.evidence, id)}</li>`).join('')}</ol>` : '<p>No recommendation was made.</p>';
    return kit.section({ title: 'What the sites agree on', body: patterns + (s.gap ? `<p><strong>The gap nobody fills:</strong> ${esc(s.gap)}</p>` : '') + (table ? `<div class="dd-table">${table}</div>` : '') })
        + (s.best && s.best.what ? kit.section({ title: 'The best version', body: `<p><a href="${esc((report.sources || []).find((x) => x.id === s.best.source_id)?.url || '#')}" rel="noopener noreferrer">${esc(host((report.sources || []).find((x) => x.id === s.best.source_id)?.url || ''))}</a> ${esc(s.best.what)}</p>${evidenceList(s.best.evidence, id)}` }) : '')
        + ((s.mistakes || []).length ? kit.section({ title: 'What everyone gets wrong', body: `<ul class="dd-mistakes">${s.mistakes.map((m) => `<li>${esc(m.what)}${evidenceList(m.evidence, id)}</li>`).join('')}</ul>` }) : '')
        + kit.section({ title: 'Reference tokens', note: 'Inspiration, never copied: palettes, type scales and spacing read from the captured pages.', body: tokenList(tokens.palettes, 'Palettes', (t) => (t.colours || []).map(esc).join(', ')) + tokenList(tokens.type_scales, 'Type scales', (t) => `${(t.families || []).map(esc).join(', ')} — ${(t.sizes || []).map(esc).join(', ')}`) + tokenList(tokens.spacing, 'Spacing', (t) => (t.steps || []).map(esc).join(', ')) })
        + kit.section({ title: 'Do and do not', body: `<div class="dd-two"><div><h3>Do</h3><ul>${(s.do || []).map((x) => `<li>${esc(x)}</li>`).join('') || '<li>—</li>'}</ul></div><div><h3>Do not</h3><ul>${(s.dont || []).map((x) => `<li>${esc(x)}</li>`).join('') || '<li>—</li>'}</ul></div></div>` })
        + (s.accessibility && s.accessibility.length ? kit.section({ title: 'Accessibility', body: `<ul>${s.accessibility.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` }) : '')
        + (s.speed && s.speed.length ? kit.section({ title: 'Speed', body: `<ul>${s.speed.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` }) : '')
        + kit.section({ title: 'For OpenVibe', note: 'Each recommendation says which of our rules it follows, or which it would change. Nothing is added to the register by itself.', body: recs });
}

function receiptSection(report, moreUrl) {
    const r = report.receipt || {};
    const models = (r.models || []).length ? kit.table({ caption: 'Every model call on the receipt', columns: [
        { key: 'step', label: 'Step' }, { key: 'provider', label: 'Provider' }, { key: 'model', label: 'Model' },
        { key: 'tokens_in', label: 'In', num: true }, { key: 'tokens_out', label: 'Out', num: true }, { key: 'ms', label: 'ms', num: true }, { key: 'cost_usd', label: 'USD', num: true, fmt: (v) => Number(v || 0).toFixed(6) },
    ], rows: r.models.map((m) => ({ step: m.step, provider: m.provider || '—', model: m.model || '—', tokens_in: m.tokens_in, tokens_out: m.tokens_out, ms: m.ms, cost_usd: m.cost_usd })) }) : '';
    return kit.section({ title: 'The receipt', body: `<p>Price shown before the run: <strong>${price(r.price_usd)}</strong>. Held: ${price(r.held_usd)}. Spent: <strong>${price(r.cost_usd)}</strong>. Captures: ${esc(String(r.captures_count || 0))}.</p>${models}${moreUrl ? `<p><a href="${esc(moreUrl)}" rel="noopener noreferrer">The run's own receipt</a> lists every call and capture.</p>` : ''}` });
}

function reportPage({ viewer, row, id }) {
    const report = row.report;
    const title = row.question || 'Deep dive';
    const actions = [kit.button({ href: `/deep-dive/${encodeURIComponent(id)}/export/markdown`, label: 'Markdown', kind: 'quiet' }), kit.button({ href: `/deep-dive/${encodeURIComponent(id)}/export/json`, label: 'JSON', kind: 'quiet' }), kit.button({ href: `https://openvibe.design/create?research=${encodeURIComponent(id)}`, label: 'Use on OpenVibe.Design', kind: 'quiet' })];
    if (!report) {
        return `<div class="ex-wrap dd">${kit.head({ title, sub: 'The run ended, but its report is not available.', back: { href: '/deep-dive', label: 'Deep dive' } })}${kit.empty({ title: row.error ? 'The deep dive failed' : 'No report', text: (row.error && row.error.detail) || 'Nothing was written.' })}</div>`;
    }
    const s = report.synthesis || {};
    return `<div class="ex-wrap dd">${kit.head({ title, sub: `${report.input && report.input.depth || row.depth} · ${String((report.sources || []).length)} sources · ${String(report.receipt && report.receipt.captures_count || 0)} captures · written ${when(report.finished_at)}`, back: { href: '/deep-dive', label: 'Deep dive' }, actions })}`
        + `<p class="dd-lede">${esc(s.gap || '')}</p>`
        + capturesSection(report, id)
        + synthesisSection(report, id)
        + analysisSection(report, id)
        + (report.gaps && report.gaps.length ? kit.section({ title: 'What this run could not do', body: `<ul>${report.gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` }) : '')
        + receiptSection(report, `/runs/${encodeURIComponent(row.run_id || id)}`)
        + `<p class="ovk-note">Screenshots are private to you and are shown as commentary with their source and read date; no site's code or assets are copied into a design.</p></div>`;
}

function runPage({ viewer, row, id }) {
    if (row.status === 'succeeded') return reportPage({ viewer, row, id });
    const title = row.question || 'Deep dive';
    const live = ['queued', 'running', 'choosing'].includes(row.status);
    const head = kit.head({ title, sub: `${row.depth} deep dive · ${price(row.price_usd)} held · started ${when(row.created_at)}`, back: { href: '/deep-dive', label: 'Deep dive' } });
    const body = `<section class="dd-live"><div class="dd-live-head"><span class="ovk-badge">${esc(row.status)}</span>${row.step ? `<span class="ovk-note">${esc(STEP_LABELS[row.step] || row.step)}</span>` : ''}<span class="ovk-note" data-progress-text>${pct(row.progress)}%</span></div>`
        + progressBar(row.progress) + stepList(row.steps, row.step)
        + (row.status === 'choosing' ? choosing(row, id) : `<p class="ovk-note">${esc((row.steps || []).find((s) => s.key === row.step)?.detail || '')}</p>`)
        + (row.error ? `<p class="dd-error" role="alert">${esc(row.error.detail || row.error.code)}</p>` : '')
        + (live ? `<form method="post" action="/deep-dive/${encodeURIComponent(id)}/cancel" class="dd-cancel">${kit.button({ label: 'Cancel the deep dive', type: 'submit', kind: 'danger' })}<span class="ovk-note">Cancelling stops the next model call and the next capture.</span></form>` : '')
        + (row.status === 'failed' || row.status === 'cancelled' ? `<p>${kit.button({ href: '/deep-dive', label: 'Start a new deep dive' })}</p>` : '')
        + `</section>`;
    const poll = live ? `<script>(function(){var id=${JSON.stringify(id)};var status=${JSON.stringify(row.status)};var ticks=0;var t=setInterval(function(){ticks++;if(ticks>900){clearInterval(t);return;}fetch('/deep-dive/'+encodeURIComponent(id)+'/state',{headers:{Accept:'application/json'}}).then(function(r){if(!r.ok)return null;return r.json();}).then(function(j){if(!j||!j.deep_dive)return;var d=j.deep_dive;if(d.status!==status){location.reload();return;}var bar=document.querySelector('[role=progressbar]');if(bar){bar.setAttribute('aria-valuenow',Math.round((d.progress||0)*100));var fill=bar.firstElementChild;if(fill)fill.style.width=Math.round((d.progress||0)*100)+'%';}var txt=document.querySelector('[data-progress-text]');if(txt)txt.textContent=Math.round((d.progress||0)*100)+'%';}).catch(function(){});},2500);})();</script>` : '';
    return `<div class="ex-wrap dd">${head}${body}${poll}</div>`;
}

function exportMarkdown(report) {
    const lines = [];
    const s = report.synthesis || {};
    lines.push(`# ${report.input && report.input.question || 'Deep dive'}`, '');
    lines.push(`Depth: ${report.input && report.input.depth || ''} · ${(report.sources || []).length} sources · ${(report.receipt && report.receipt.captures_count) || 0} captures · ${when(report.finished_at)}`, '');
    if (s.gap) lines.push(`**The gap:** ${s.gap}`, '');
    lines.push('## What the sites agree on', '');
    for (const p of s.patterns || []) lines.push(`- **${p.name}** (${p.usage_count || (p.sites || []).length} sites): ${p.what}`);
    if (s.comparison && (s.comparison.columns || []).length) {
        lines.push('', `| ${s.comparison.columns.join(' | ')} |`, `| ${s.comparison.columns.map(() => '---').join(' | ')} |`);
        for (const r of s.comparison.rows || []) lines.push(`| ${r.map((x) => String(x).replace(/\|/g, '\\|')).join(' | ')} |`);
    }
    if (s.best && s.best.what) lines.push('', '## The best version', '', s.best.what);
    if ((s.mistakes || []).length) { lines.push('', '## What everyone gets wrong', ''); for (const m of s.mistakes) lines.push(`- ${m.what}`); }
    if ((s.do || []).length) { lines.push('', '## Do', ''); for (const x of s.do) lines.push(`- ${x}`); }
    if ((s.dont || []).length) { lines.push('', '## Do not', ''); for (const x of s.dont) lines.push(`- ${x}`); }
    if (s.accessibility && s.accessibility.length) { lines.push('', '## Accessibility', ''); for (const x of s.accessibility) lines.push(`- ${x}`); }
    if (s.speed && s.speed.length) { lines.push('', '## Speed', ''); for (const x of s.speed) lines.push(`- ${x}`); }
    lines.push('', '## What each site does', '');
    for (const a of report.analysis || []) {
        lines.push(`### ${a.url}`, '', a.summary, '');
        if (a.strengths && a.strengths.length) lines.push(`Good: ${a.strengths.join('; ')}`);
        if (a.weaknesses && a.weaknesses.length) lines.push(`Fails: ${a.weaknesses.join('; ')}`);
        lines.push('');
    }
    if ((report.recommendations || []).length) { lines.push('## For OpenVibe', ''); for (const r of report.recommendations) lines.push(`- **${r.what}** ${r.why}${r.rule && r.rule.id ? ` (rule ${r.rule.id}, ${r.rule.status})` : ''}`); }
    lines.push('', '## Evidence', '', 'Every claim above cites its site, capture and read date in the JSON export and on the report page.', '');
    lines.push('Screenshots are private to the run\'s owner and are shown there as attributed commentary; no site\'s code or assets are copied into a design.', '');
    lines.push('## The receipt', '', `Price shown: $${Number(report.receipt && report.receipt.price_usd || 0).toFixed(2)}. Spent: $${Number(report.receipt && report.receipt.cost_usd || 0).toFixed(6)}. Captures: ${report.receipt && report.receipt.captures_count || 0}.`, '');
    for (const m of (report.receipt && report.receipt.models) || []) lines.push(`- ${m.step}: ${m.provider || '?'}/${m.model || '?'} — ${m.tokens_in} in, ${m.tokens_out} out, $${Number(m.cost_usd || 0).toFixed(6)}, ${m.ms} ms`);
    return lines.join('\n');
}

module.exports = { homePage, runPage, reportPage, exportMarkdown, STEP_LABELS };
