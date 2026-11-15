'use strict';
/**
 * The general deep dive on Exchange (AI workflow research.deep_dive, report ai.research@1; the owner, 11-15: Exchange's
 * search "was meant to deep dive any query in a general sense", and OpenVibe.Design's design deep dive builds on it).
 *
 *   homePage    /deep-dive: what do you want to know, the three depths with their prices, what a deep dive does
 *   runPage     /deep-dive/:id while it runs: drawn by public/js/research-run.js from the state, redrawn every two
 *               seconds (the questions, the sources, each page as it is read, each page's notes as they land)
 *   reportPage  /deep-dive/:id once it is written: the answer first, key points and answers per question with their
 *               sources as numbered chips, a comparison, where the sources disagree, what is open, next steps, then
 *               every page read with its notes and quotes, the other sources found, and the receipt
 *   markdown    the export, with the sources as numbered links
 *
 * Every word from a report is another service's: it is escaped, and every link is http(s) or nothing.
 */
const kit = require('openvibe-shared/kit');
const glyphs = require('openvibe-shared/glyphs');
const { asset } = require('../render/layout');
const { esc } = require('../render/html');

const STEP_LABELS = { plan: 'Planning', search: 'Searching', choose: 'Choosing pages', read: 'Reading', analyse: 'Taking notes', write: 'Writing the answer' };
const STEP_NOTES = {
    plan: 'The questions an expert would need answered, and the searches that find them.',
    search: 'MegaSource (Wikipedia, Wikidata, the Search Fabric and web search), the web engine on the question and on every planned search, and GitHub for software.',
    choose: 'The pages worth reading in full, with a reason each: primary and authoritative sources first, different views, nothing thin.',
    read: 'Each page fetched as text, three at a time: its article, not its menus. A page that cannot be read gives its place to a spare.',
    analyse: 'A model reads each page against the questions and notes what it says, with short exact quotes and what kind of source it is.',
    write: 'The answer from the notes: every claim cites the pages it rests on; where sources disagree and what is still open are said.',
};
const KIND = { primary: 'Primary', reference: 'Reference', news: 'News', opinion: 'Analysis', vendor: 'Vendor', forum: 'Forum', other: 'Other' };
const CONF = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };

const jsLit = (v) => JSON.stringify(v).replace(/</g, '\\u003c');
const price = (n) => `$${Number(n || 0).toFixed(2)}`;
const when = (iso) => { if (!iso) return '—'; try { return new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; } catch { return String(iso); } };
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return String(u || ''); } };
const href = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : null);
const link = (u, text) => { const h = href(u); return h ? `<a href="${esc(h)}" rel="noopener noreferrer" target="_blank">${esc(text)}</a>` : esc(text); };

const DEFAULT_DEPTHS = [
    { key: 'quick', label: 'Quick', pages: 8, minutes: 1, price_usd: 0.1, analysis: 'reads the 8 best pages and answers with their sources' },
    { key: 'thorough', label: 'Thorough', pages: 16, minutes: 3, price_usd: 0.3, analysis: 'reads 16 pages from more searches' },
    { key: 'expert', label: 'Expert', pages: 30, minutes: 6, price_usd: 0.8, analysis: 'reads 30 pages, every angle the plan finds' },
];
const depthsOf = (depths) => (depths && depths.length && depths.some((d) => d.pages) ? depths : DEFAULT_DEPTHS);
const depthBody = (d) => `<span class="dd-depth-name">${esc(d.label || d.key)}</span><span class="dd-depth-price">${price(d.price_usd)}</span>`
    + `<span class="dd-depth-size">${esc(String(d.pages || ''))} pages read · about ${esc(String(d.minutes || '?'))} min</span>${d.analysis ? `<small>${esc(d.analysis)}</small>` : ''}`;
function depthCards(depths, selected = 'quick') {
    return `<fieldset class="dd-depths"><legend>Depth</legend><div class="dd-depth-row">${depthsOf(depths).map((d) => `<label class="dd-depth"><input type="radio" name="depth" value="${esc(d.key)}"${d.key === selected ? ' checked' : ''}>${depthBody(d)}</label>`).join('')}</div></fieldset>`;
}

/** The start form: the question and the depth (also drawn under a search on /search). */
function startForm({ depths, question = '', compact = false } = {}) {
    return `<form method="post" action="/deep-dive" class="dd-form${compact ? ' dd-form--compact' : ''}">
<label class="dd-field"><span>What do you want to know?</span><textarea name="question" rows="${compact ? 2 : 3}" maxlength="500" required placeholder="Are heat pumps worth it in a cold climate?">${esc(question)}</textarea></label>
${depthCards(depths)}
<div class="dd-go">${kit.button({ label: 'Start the deep dive', type: 'submit' })}<p class="dd-go-note">${glyphs.svg('lock')}The price is held before it starts; you can cancel at any step.</p></div>
</form>`;
}

function whatItDoes() {
    const step = (icon, title, text) => `<li><span class="dd-what-ic" aria-hidden="true">${kit.icon(icon)}</span><div><strong>${title}</strong><p>${text}</p></div></li>`;
    return kit.section({ title: 'What a deep dive does', body: `<ol class="dd-what">
${step('spark', 'Plans like an expert.', 'The questions someone who knows the field would ask first, and the searches that answer each one: the data, the primary sources, recent news, expert analysis and the strongest criticism.')}
${step('search', 'Searches every way we have.', 'MegaSource (Wikipedia, Wikidata, our Search Fabric and web search), Exchange\'s web engine on the question and on every planned search, and GitHub when it is about software.')}
${step('book', 'Reads the best pages in full.', 'Not snippets: each chosen page is fetched and read as text, its article without the menus, with its date and site. Pages a site\'s robots.txt keeps out are left out.')}
${step('check', 'Takes notes on each page.', 'What it says about each question, short exact quotes, and what kind of source it is (primary, reference, news, analysis, vendor, forum).')}
${step('eye', 'Answers with its sources.', 'A summary, the key points, an answer to each question with its confidence, a comparison when you compare, where the sources disagree, what is still open and what to do next. Every claim names the pages it rests on.')}
</ol>
<p class="ovk-note">Designing something? <a href="https://openvibe.design/create">OpenVibe.Design's design deep dive</a> builds on this one: it also photographs the best sites at phone and computer sizes and reads them as a designer.</p>` });
}

function homePage({ viewer, depths = [], error = null, question = '', mine = [] }) {
    const signedIn = Boolean(viewer && viewer.kind === 'user');
    const form = signedIn
        ? startForm({ depths, question }) + (error ? `<p class="dd-error" role="alert">${esc(error)}</p>` : '')
        : kit.empty({ icon: 'person', title: 'Sign in to run a deep dive', text: 'A deep dive spends your allowance, so it needs your account. What it does is below.', action: { href: `/auth/login?next=${encodeURIComponent('/deep-dive')}`, label: 'Sign in with OpenVibe' } })
            + `<section class="ovk-section"><h2>The depths and their prices</h2><ul class="dd-depth-row dd-depth-list">${depthsOf(depths).map((d) => `<li class="dd-depth">${depthBody(d)}</li>`).join('')}</ul></section>`;
    const recent = signedIn && mine.length ? kit.section({ title: 'Your deep dives', count: mine.length, body: `<ul class="dd-mine">${mine.slice(0, 12).map((d) => `<li><a href="/deep-dive/${encodeURIComponent(d.id)}">${esc(d.question || 'Deep dive')}</a><span class="ovk-note">${esc(d.kind === 'design' ? 'design' : d.depth || '')} · ${esc(d.status)} · ${esc(when(d.created_at))}</span></li>`).join('')}</ul>` }) : '';
    return `<div class="ex-wrap dd">${kit.head({ title: 'Deep dive', sub: 'Any question, researched like an expert would: we plan the questions, search everywhere, read the best pages in full, and answer with every source named.' })}${form}${recent}${whatItDoes()}</div>`;
}

/** The pages read, numbered in the order the answer cites them. */
function numbering(report) {
    const read = (report.reads || []).filter((r) => r.status === 'read');
    const n = new Map();
    read.forEach((r, i) => n.set(r.source_id, i + 1));
    return { read, n };
}
const cites = (ids, n) => {
    const list = [...new Set(ids || [])].filter((id) => n.has(id)).map((id) => n.get(id)).sort((a, b) => a - b);
    return list.length ? ` <span class="rs-cites">${list.map((k) => `<a class="rs-cite" href="#src-${k}" aria-label="Source ${k}">${k}</a>`).join('')}</span>` : '';
};

function reportPage({ row, id }) {
    const report = row.report;
    const title = row.question || 'Deep dive';
    if (!report) {
        return `<div class="ex-wrap dd">${kit.head({ title, sub: 'The run ended, but its answer is not available.', back: { href: '/deep-dive', label: 'Deep dive' } })}${kit.empty({ title: row.error ? 'The deep dive failed' : 'No answer', text: (row.error && row.error.detail) || 'Nothing was written.', action: { href: '/deep-dive', label: 'Start a new deep dive' } })}</div>`;
    }
    const a = report.answer || {};
    const { read, n } = numbering(report);
    // The exports and "again" sit under the answer, not in the head: on a phone three buttons there push the question out.
    const tools = `<nav class="rs-tools" aria-label="This deep dive">${kit.button({ href: `/deep-dive/${encodeURIComponent(id)}/export/markdown`, label: 'Markdown', icon: 'download', kind: 'quiet', small: true })}${kit.button({ href: `/deep-dive/${encodeURIComponent(id)}/export/json`, label: 'JSON', icon: 'download', kind: 'quiet', small: true })}${kit.button({ href: `/deep-dive?q=${encodeURIComponent(title)}`, label: 'Deep dive again', icon: 'spark', kind: 'quiet', small: true })}</nav>`;
    const meta = `${esc(report.input && report.input.depth || row.depth)} · ${read.length} pages read of ${(report.sources || []).length} found · ${esc(price(report.receipt && report.receipt.cost_usd))} spent · ${esc(when(report.finished_at))}`;

    const keyPoints = (a.key_points || []).length ? kit.section({ title: 'Key points', body: `<ol class="rs-points">${a.key_points.map((k) => `<li>${esc(k.text)}${cites(k.sources, n)}</li>`).join('')}</ol>` }) : '';
    const answers = (a.answers || []).length ? kit.section({ title: 'Question by question', count: a.answers.length, body: a.answers.map((x, i) => `<details class="rs-q"${i === 0 ? ' open' : ''}><summary><span>${esc(x.question)}</span><span class="rs-conf is-${esc(x.confidence)}">${esc(CONF[x.confidence] || x.confidence)}</span></summary><p>${esc(x.answer)}${cites(x.sources, n)}</p></details>`).join('') }) : '';
    const table = a.comparison && (a.comparison.columns || []).length ? kit.section({ title: 'Side by side', body: `<div class="dd-table">${kit.table({ columns: a.comparison.columns.map((c, i) => ({ key: `c${i}`, label: c })), rows: (a.comparison.rows || []).map((r) => Object.fromEntries(a.comparison.columns.map((c, i) => [`c${i}`, r[i] == null ? '—' : String(r[i])]))) })}</div>` }) : '';
    const disagree = (a.disagreements || []).length ? kit.section({ title: 'Where the sources disagree', body: `<ul class="rs-disagree">${a.disagreements.map((d) => `<li>${esc(d.what)}${cites(d.sources, n)}</li>`).join('')}</ul>` }) : '';
    const openNext = (a.open_questions || []).length || (a.next_steps || []).length
        ? kit.section({ title: 'What is open, and what next', body: `<div class="rs-two"><div><h3>Still open</h3><ul>${(a.open_questions || []).map((x) => `<li>${esc(x)}</li>`).join('') || '<li>Nothing the pages left open.</li>'}</ul></div><div><h3>Next steps</h3><ul>${(a.next_steps || []).map((x) => `<li>${esc(x)}</li>`).join('') || '<li>—</li>'}</ul></div></div>` }) : '';

    const sources = kit.section({ title: 'The pages read', count: read.length, note: 'Each with what it says. The numbers are the ones the answer cites.', body: `<ol class="rs-sources">${read.map((r, i) => `<li id="src-${i + 1}" class="rs-src"><span class="rs-n">${i + 1}</span><div class="rs-src-main">`
        + `<div class="rs-src-head">${link(r.final_url || r.url, r.title || host(r.url))}${r.kind ? `<span class="rs-kind">${esc(KIND[r.kind] || r.kind)}</span>` : ''}</div>`
        + `<small class="rs-src-meta">${esc(r.site || host(r.url))}${r.published ? ` · published ${esc(r.published)}` : ''} · read ${esc(when(r.read_at))} · ${esc(String(r.words || 0))} words</small>`
        + (r.summary ? `<p>${esc(r.summary)}</p>` : '')
        + ((r.findings || []).length ? `<details class="rs-notes"><summary>${r.findings.length} note${r.findings.length === 1 ? '' : 's'}</summary><ul>${r.findings.map((f) => `<li>${esc(f.point)}${f.quote ? `<blockquote>${esc(f.quote)}</blockquote>` : ''}</li>`).join('')}</ul></details>` : '')
        + `</div></li>`).join('')}</ol>` });
    const skipped = (report.reads || []).filter((r) => r.status === 'skipped');
    const readIds = new Set((report.reads || []).map((r) => r.source_id));
    const others = (report.sources || []).filter((s) => !readIds.has(s.id));
    const more = (skipped.length || others.length) ? `<details class="rs-more"><summary>${skipped.length ? `${skipped.length} could not be read` : ''}${skipped.length && others.length ? ' · ' : ''}${others.length ? `${others.length} more found, not read` : ''}</summary>`
        + (skipped.length ? `<ul>${skipped.map((r) => `<li>${link(r.url, r.title || host(r.url))} <span class="ovk-note">${esc(r.reason || 'not read')}</span></li>`).join('')}</ul>` : '')
        + (others.length ? `<ul>${others.slice(0, 80).map((s) => `<li>${link(s.url, s.title || host(s.url))} <span class="ovk-note">${esc(s.engine || s.kind || '')}</span></li>`).join('')}</ul>` : '') + `</details>` : '';
    const r = report.receipt || {};
    const receipt = `<details class="rs-more"><summary>The receipt: ${esc(price(r.cost_usd))} of ${esc(price(r.price_usd))} held · ${(r.models || []).length} model calls</summary>${(r.models || []).length ? kit.table({ columns: [
        { key: 'step', label: 'Step' }, { key: 'model', label: 'Model' }, { key: 'tokens_in', label: 'In', num: true }, { key: 'tokens_out', label: 'Out', num: true }, { key: 'ms', label: 'ms', num: true }, { key: 'cost_usd', label: 'USD', num: true, fmt: (v) => Number(v || 0).toFixed(6) },
    ], rows: r.models.map((m) => ({ step: m.step, model: `${m.provider || '—'}/${m.model || '—'}`, tokens_in: m.tokens_in, tokens_out: m.tokens_out, ms: m.ms, cost_usd: m.cost_usd })) }) : ''}<p><a href="/runs/${encodeURIComponent(row.run_id || id)}">The run's own receipt</a></p></details>`;
    const gaps = (report.gaps || []).length ? `<details class="rs-more"><summary>What this run could not do (${report.gaps.length})</summary><ul>${report.gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></details>` : '';

    return `<div class="ex-wrap dd rs">${kit.head({ title, sub: meta, back: { href: '/deep-dive', label: 'Deep dive' } })}`
        + `<section class="rs-answer"><h2 class="rs-label">The answer</h2><p class="rs-summary">${esc(a.summary || '')}</p></section>${tools}`
        + keyPoints + answers + table + disagree + openNext + sources
        + `<section class="ovk-section rs-foot">${more}${gaps}${receipt}</section></div>`;
}

function runPage({ row, id }) {
    if (row.status === 'succeeded') return reportPage({ row, id });
    const title = row.question || 'Deep dive';
    const live = ['queued', 'running'].includes(row.status);
    const head = kit.head({ title, sub: `${row.depth} deep dive · ${price(row.price_usd)} held · started ${when(row.created_at)}`, back: { href: '/deep-dive', label: 'Deep dive' } });
    const since = row.started_at || row.created_at;
    const seed = { id, since, labels: STEP_LABELS, notes: STEP_NOTES, order: Object.keys(STEP_LABELS), minutes: { quick: 1, thorough: 3, expert: 6 }[row.depth] || null,
        state: { status: row.status, step: row.step, progress: row.progress, steps: row.steps || [], site_limit: row.site_limit || null, plan: row.plan || null,
            candidates: (row.candidates || []).map((c) => ({ url: c.url, title: c.title, reason: c.reason, source_id: c.source_id, chosen: c.chosen })),
            reads: (row.reads || []).map((r) => ({ id: r.id, source_id: r.source_id, url: r.url, title: r.title, site: r.site, status: r.status, reason: r.reason, words: r.words, kind: r.kind, summary: r.summary, findings: (r.findings || []).length })),
            gaps: row.gaps || [], error: row.error || null } };
    // Without JavaScript the steps are still listed; with it, research-run.js draws the live view over this.
    const steps = new Map((row.steps || []).map((s) => [s.key, s]));
    const fallback = `<ol class="dd-steps">${Object.keys(STEP_LABELS).map((k) => { const s = steps.get(k) || { status: 'pending' }; return `<li class="dd-step is-${esc(s.status)}"><strong>${esc(STEP_LABELS[k])}</strong><span class="dd-step-detail">${esc(s.detail || (s.status === 'pending' ? 'Waiting' : ''))}</span></li>`; }).join('')}</ol>`;
    const body = `<section class="dd-live"${live ? ' data-dd-run' : ''}>${fallback}</section>`
        + (row.error ? `<p class="dd-error" role="alert">${esc(row.error.detail || row.error.code)}</p>` : '')
        + (live ? `<form method="post" action="/deep-dive/${encodeURIComponent(id)}/cancel" class="dd-cancel">${kit.button({ label: 'Cancel the deep dive', type: 'submit', kind: 'danger' })}<span class="ovk-note">Cancelling stops the next page read and the next model call.</span></form>` : '')
        + (row.status === 'failed' || row.status === 'cancelled' ? `<p>${kit.button({ href: `/deep-dive?q=${encodeURIComponent(title)}`, label: 'Try it again' })}</p>` : '');
    const script = live ? `<script type="application/json" id="dd-state">${jsLit(seed)}</script><script src="${asset('js/research-run.js')}" defer></script>` : '';
    return `<div class="ex-wrap dd rs">${head}${body}${script}</div>`;
}

function exportMarkdown(report) {
    const { read, n } = numbering(report);
    const a = report.answer || {};
    const c = (ids) => { const l = [...new Set(ids || [])].filter((x) => n.has(x)).map((x) => n.get(x)).sort((p, q) => p - q); return l.length ? ` ${l.map((k) => `[${k}]`).join('')}` : ''; };
    const lines = [`# ${report.input && report.input.question || 'Deep dive'}`, '', `${report.input && report.input.depth || ''} deep dive · ${read.length} pages read · ${when(report.finished_at)}`, '', '## The answer', '', a.summary || '', ''];
    if ((a.key_points || []).length) { lines.push('## Key points', ''); a.key_points.forEach((k, i) => lines.push(`${i + 1}. ${k.text}${c(k.sources)}`)); lines.push(''); }
    if ((a.answers || []).length) { lines.push('## Question by question', ''); for (const x of a.answers) lines.push(`### ${x.question}`, '', `${x.answer}${c(x.sources)} (${CONF[x.confidence] || x.confidence})`, ''); }
    if (a.comparison && (a.comparison.columns || []).length) {
        lines.push('## Side by side', '', `| ${a.comparison.columns.join(' | ')} |`, `| ${a.comparison.columns.map(() => '---').join(' | ')} |`);
        for (const r of a.comparison.rows || []) lines.push(`| ${r.map((x) => String(x).replace(/\|/g, '\\|')).join(' | ')} |`);
        lines.push('');
    }
    if ((a.disagreements || []).length) { lines.push('## Where the sources disagree', ''); for (const d of a.disagreements) lines.push(`- ${d.what}${c(d.sources)}`); lines.push(''); }
    if ((a.open_questions || []).length) { lines.push('## Still open', ''); for (const x of a.open_questions) lines.push(`- ${x}`); lines.push(''); }
    if ((a.next_steps || []).length) { lines.push('## Next steps', ''); for (const x of a.next_steps) lines.push(`- ${x}`); lines.push(''); }
    lines.push('## Sources', '');
    read.forEach((r, i) => lines.push(`${i + 1}. [${(r.title || host(r.url)).replace(/[[\]]/g, '')}](${r.final_url || r.url}) — ${r.site || host(r.url)}${r.published ? `, ${r.published}` : ''}${r.summary ? `. ${r.summary}` : ''}`));
    lines.push('', `Spent $${Number(report.receipt && report.receipt.cost_usd || 0).toFixed(4)} of $${Number(report.receipt && report.receipt.price_usd || 0).toFixed(2)} held.`);
    return lines.join('\n');
}

module.exports = { homePage, runPage, reportPage, exportMarkdown, startForm, STEP_LABELS, DEFAULT_DEPTHS };
