'use strict';
const kit = require('openvibe-shared/kit');
const { esc } = require('../render/html');
const number = (value, digits = 2) => value == null ? '—' : Number(value).toLocaleString('en-US', { maximumFractionDigits: digits });
function modelFacts(analysis) {
    if (!analysis) return kit.section({ title: 'Measured performance', body: '<p>Measured performance is unavailable.</p>' });
    const series = (analysis.measured?.series || []).filter((row) => row.runs >= 20);
    const latest = series.reduce((day, row) => row.day > day ? row.day : day, '');
    const rows = series.filter((row) => row.day === latest);
    const measured = rows.length ? kit.table({ caption: `Measured runs on ${latest}`, columns: [
        { key: 'provider', label: 'Provider' }, { key: 'task', label: 'Task kind' }, { key: 'runs', label: 'Runs', num: true },
        { key: 'median', label: 'Median latency (ms)', num: true, fmt: number }, { key: 'p95', label: '95th percentile (ms)', num: true, fmt: number },
        { key: 'first', label: 'First token (ms)', num: true, fmt: number }, { key: 'cost', label: 'Cost per run (USD)', num: true, fmt: (value) => number(value, 8) },
    ], rows: rows.map((row) => ({ provider: row.provider, task: row.task_kind, runs: row.runs, median: row.latency_p50_ms, p95: row.latency_p95_ms, first: row.ttft_p50_ms, cost: row.cost_per_run_usd })) }) : '<p>No completed day has twenty qualifying runs for this model.</p>';
    const rating = analysis.rating;
    const quality = rating ? `<p>${esc(rating.subject)}: ${number(rating.elo)} (${number(rating.ci_lower)}–${number(rating.ci_upper)}), ${number(rating.games, 0)} games.</p>` : `<p>${analysis.ratings?.unavailable ? 'The rating source is unavailable.' : 'No single model rating has twenty qualifying games.'}</p>`;
    return kit.section({ title: 'Measured performance', body: measured + `<p><a href="/api/v1/analysis/models/${encodeURIComponent(analysis.model)}?rating_kind=${encodeURIComponent(analysis.ratings?.kind || 'chat.arena')}">Metrics and rating data</a></p>` })
        + kit.section({ title: `Bench rating: ${analysis.ratings?.kind || 'chat.arena'}`, body: quality + (analysis.ratings?.stale ? '<p>This is the last cached rating; Bench is unavailable.</p>' : '') + '<p>Source: OpenVibe.Bench. Latency and cost come from OpenVibe.AI receipts.</p>' });
}
module.exports = { modelFacts };
