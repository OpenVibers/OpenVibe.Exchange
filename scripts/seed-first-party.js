#!/usr/bin/env node
'use strict';

/**
 * Seed or refresh the first-party catalogue now (the service also runs it at boot and every
 * EXCHANGE_FIRST_PARTY_INTERVAL_MS):
 *
 *   node scripts/seed-first-party.js [design,obs,games]
 *
 * It uses the same store functions and the same sources as the job, prints counts only, and never creates a person's
 * listing. Re-running is safe: source/source_id is the idempotency key.
 */
const { load } = require('../server/config');
const { openStore } = require('../server/db');
const { createStore } = require('../server/store');
const { createSearchIndex } = require('../server/search');
const { createFirstParty, SOURCES } = require('../server/jobs/first-party');

(async () => {
    const config = load(process.env);
    if (config.drill) throw new Error('refusing to seed under EXCHANGE_DRILL');
    const s = await openStore(config);
    try {
        const search = createSearchIndex({ config, s });
        const entries = createStore(s, { search, config });
        const job = createFirstParty({ config, s, entries, now: s.now });
        const asked = process.argv.slice(2).flatMap((x) => x.split(',')).filter(Boolean);
        const sources = asked.length ? asked : SOURCES;
        const out = await job.runOnce({ sources });
        const lines = [];
        for (const [source, result] of Object.entries(out.sources || {})) {
            if (result && result.themes) {
                lines.push(`[seed] ${source}.themes: ${result.themes.ok ? 'ok' : 'failed'} imported=${result.themes.imported || 0} changed=${result.themes.changed || 0} retired=${result.themes.retired || 0} removed_token_listings=${result.removed_tokens || 0}`);
            } else {
                lines.push(`[seed] ${source}: ${result && result.ok ? 'ok' : 'failed'} imported=${(result && result.imported) || 0} changed=${(result && result.changed) || 0} retired=${(result && result.retired) || 0}${result && result.error ? ` error=${result.error}` : ''}`);
            }
        }
        for (const line of lines) console.log(line);
        const ok = Object.values(out.sources || {}).every((r) => !r || r.ok !== false) && Object.values(out.sources || {}).every((r) => !r || r.themes === undefined || r.themes.ok);
        process.exitCode = ok ? 0 : 1;
    } finally {
        await s.close();
    }
})().catch((err) => { console.error(`[seed] ${err && err.message ? err.message : err}`); process.exitCode = 1; });
