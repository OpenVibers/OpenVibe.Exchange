'use strict';
/**
 * /search/accuracy: how often search's sourced answer is right, at each depth, with what it took and cost (plan
 * AD.34 next 2). The run's own numbers, its method and its limits, and every question with each depth's answer.
 */
const { esc } = require('../render/html');

// The search page's own words for each depth, so the two pages never disagree.
const { DEPTHS } = require('./search');
const ORDER = DEPTHS.map(([d]) => d);
const PLAIN = Object.fromEntries(DEPTHS.map(([d, , hint]) => [d, hint]));

const secs = (ms) => { const s = (Number(ms) || 0) / 1000; return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`; };
const usd = (c) => { const n = Number(c) || 0; return n <= 0 ? 'no fee' : n < 0.0001 ? 'under $0.0001' : `$${n < 0.01 ? n.toFixed(4).replace(/0+$/, '') : n.toFixed(3).replace(/0$/, '')}`; };
const pct = (a, n) => (n ? `${Math.round((a / n) * 1000) / 10}%` : '–');

function depthsOf(run) {
    return Object.keys(run.depths || {}).sort((a, b) => (ORDER.indexOf(a) + 1 || 9) - (ORDER.indexOf(b) + 1 || 9));
}

function accuracyPage(run) {
    const depths = depthsOf(run);
    const sample = run.sample || {};
    const source = run.source || {};
    const copies = depths.filter((d) => Number(run.depths[d].with_copy_source) > 0).map((d) => `${d} ${run.depths[d].with_copy_source}`).join(', ');
    const empties = depths.filter((d) => Number(run.depths[d].no_answer) > 0).map((d) => `${d} ${run.depths[d].no_answer}`).join(', ');
    const best = depths.reduce((top, d) => (!top || (run.depths[d].accuracy || 0) > (run.depths[top].accuracy || 0) ? d : top), null);
    // The 95% margin of a share measured on n questions, at the best depth's share (a normal approximation).
    const margin = best && run.depths[best].n ? Math.round(1.96 * Math.sqrt((run.depths[best].correct / run.depths[best].n) * (1 - run.depths[best].correct / run.depths[best].n) / run.depths[best].n) * 100) : 0;
    const summary = depths.map((d) => {
        const s = run.depths[d];
        return `<tr><th scope="row"><code>${esc(d)}</code><small>${esc(PLAIN[d] || '')}</small></th>`
            + `<td data-label="Right"><strong>${esc(pct(s.correct, s.n))}</strong><small>${esc(String(s.correct))} of ${esc(String(s.n))}</small></td>`
            + `<td data-label="In the sources">${esc(pct(s.gold_in_sources, s.n))}</td>`
            + `<td data-label="Typical time">${esc(secs(s.p50_ms))}<small>${esc(secs(s.p90_ms))} at the slow end</small></td>`
            + `<td data-label="Typical cost">${esc(usd(s.p50_cost_usd))}<small>${esc(usd(s.total_cost_usd))} for all ${esc(String(s.n))}</small></td></tr>`;
    }).join('');
    const yes = (r) => (!r ? '<td>–</td>' : `<td class="xa-${r.right ? 'right' : 'miss'}">${r.right ? 'right' : 'missed'}</td>`);
    const rows = (run.questions || []).map((x) => `<tr><td>${esc(x.q)}${x.topic ? `<small>${esc(x.topic)}</small>` : ''}</td><td>${esc(x.gold)}</td>${depths.map((d) => yes(x[d])).join('')}</tr>`).join('');
    return '<div class="ex-wrap xa">'
        + '<header class="xa-head"><h1>How accurate is search?</h1>'
        + `<p class="ex-lede">${esc(String(sample.n || run.questions.length))} short factual questions, asked at each depth with a sourced answer, on ${esc(run.measured)}. `
        + `${best ? `At <code>${esc(best)}</code> it answered ${esc(pct(run.depths[best].correct, run.depths[best].n))} right. ` : ''}`
        + 'Graded strictly, so the real figure is at least this.</p>'
        + '<p class="ex-head-actions"><a class="ovk-btn ovk-btn--primary" href="/search">Try a search</a> <a class="ovk-btn" href="/search/accuracy.json">The data (JSON)</a></p></header>'
        + '<section aria-labelledby="xa-by-depth"><h2 id="xa-by-depth">By depth</h2>'
        + '<div class="exc-scroll"><table class="ovk-table xa-table xa-depths"><thead><tr><th scope="col">Depth</th><th scope="col">Right</th><th scope="col">Answer in the sources</th><th scope="col">Typical time</th><th scope="col">Typical cost</th></tr></thead>'
        + `<tbody>${summary}</tbody></table></div>`
        + '<p class="xa-note">"Answer in the sources" is how often the right answer was somewhere in what the search found, whether or not the written answer used it: the room left for a better answer.</p>'
        + (empties ? `<p class="xa-note">Some misses are answers left empty: the search found sources and wrote nothing (${esc(empties)}). They count as missed.</p>` : '')
        + '</section>'
        + '<section aria-labelledby="xa-how"><h2 id="xa-how">How it was measured</h2><ul class="xa-list">'
        + `<li>The questions: ${esc(String(sample.n || ''))} from ${source.url ? `<a href="${esc(source.url)}">${esc(source.name || 'SimpleQA')}</a>` : esc(source.name || 'SimpleQA')} by ${esc(source.by || 'OpenAI')} (${esc(source.license || 'MIT')}), a random sample of its ${esc(String(sample.of || ''))} (seed ${esc(String(sample.seed || ''))}), leaving out the ${esc(String(sample.left_out || 0))} used while tuning search.</li>`
        + `<li>Each one through the search API with <code>output: "answer"</code> at each depth, with a cost limit of ${esc(usd(run.max_cost_usd))} a question, from OpenVibe's own servers.</li>`
        + (Array.isArray(run.excluded) && run.excluded.length ? `<li>Sites that copy benchmark datasets (${run.excluded.map((x) => `<code>${esc(x)}</code>`).join(', ')}) were left out of every search, so it could not read an answer off the benchmark itself.${copies ? ` Some answers still had a page that looked like a copy among their sources (${esc(copies)}).` : ''}</li>` : '')
        + `<li>The grader: ${esc(run.grader || 'the answer must contain the reference answer')}. An answer that says it another way counts as missed, so this is a floor under SimpleQA's own grader, which asks a model.</li>`
        + '<li>Time is the whole call, from asking to the written answer. Cost is what the call was charged.</li></ul></section>'
        + '<section aria-labelledby="xa-limits"><h2 id="xa-limits">What it does not tell you</h2><ul class="xa-list">'
        + '<li>These are short questions with one right answer. Research questions, comparisons and recent news are other tests.</li>'
        + (margin ? `<li>${esc(String(sample.n || run.questions.length))} questions give each figure a margin of about ±${esc(String(margin))} points (95%), so a smaller gap between depths is within it.</li>` : '')
        + '<li>It is one run on one day: the web, the engines and the models change, and the next run is its own page.</li></ul></section>'
        + `<details class="xa-all"><summary>Every question <span class="ovk-count">${esc(String((run.questions || []).length))}</span></summary>`
        + `<div class="exc-scroll"><table class="ovk-table xa-table xa-qs"><thead><tr><th scope="col">Question</th><th scope="col">Reference</th>${depths.map((d) => `<th scope="col"><code>${esc(d)}</code></th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`
        + '<p class="xa-note">Each depth\'s written answers are in the JSON.</p></details>'
        + '</div>';
}

module.exports = { accuracyPage, depthsOf };
