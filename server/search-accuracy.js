'use strict';
/**
 * Search, measured (plan AD.34 next 2, AD.39 item 10): the latest accuracy run of AI's search v2, kept as a file per
 * run in measurements/search-accuracy/<YYYY-MM-DD>.json and shown at /search/accuracy (JSON at /search/accuracy.json).
 *
 *   latest(dir?)   the newest run, or null when there is none. A run is
 *                  { measured, source, sample, grader, max_cost_usd, depths: { <depth>: summary }, questions: [...] }
 *                  where a summary is { n, correct, accuracy, gold_in_sources, errors, p50_ms, p90_ms, p50_cost_usd,
 *                  total_cost_usd } and a question is { q, gold, topic, <depth>: { right, in_sources, ms, cost, answer } }.
 *
 * Read once per file and kept: a run never changes after it is committed.
 */
const fs = require('fs');
const path = require('path');

// In the repo, not data/ (the service's own runtime folder, which git ignores): a run is published by committing it.
const DIR = path.join(__dirname, '..', 'measurements', 'search-accuracy');
const RUN = /^\d{4}-\d{2}-\d{2}\.json$/;
const _cache = new Map();   // file → run

function latest(dir = DIR) {
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => RUN.test(n)).sort(); } catch { return null; }
    const name = names[names.length - 1];
    if (!name) return null;
    const file = path.join(dir, name);
    if (!_cache.has(file)) {
        try {
            const run = JSON.parse(fs.readFileSync(file, 'utf8'));
            _cache.set(file, run && run.depths && Array.isArray(run.questions) ? run : null);
        } catch { _cache.set(file, null); }
    }
    return _cache.get(file);
}

module.exports = { latest, DIR };
