#!/usr/bin/env node
'use strict';

/**
 * The first proof (plan §5.11): a licensed template listed, tried in the sandbox, installed with its passport's
 * grants, then revoked cleanly.
 *
 *   node scripts/seed-proof.js
 *
 * It writes one CC0-1.0 Website template as a draft, runs the four conformance tests, lists it, takes it through a
 * sandbox trial as a second person, installs it with the passport snapshot and revokes that install. Every step
 * goes through the same store functions the API and the pages use; nothing is inserted behind their back. Re-running
 * is safe: an existing `starter-site` listing is left as it is.
 */
const { ids } = require('openvibe-contracts');
const { load } = require('../server/config');
const { openStore } = require('../server/db');
const { createStore, slugify } = require('../server/store');
const { createSearchIndex } = require('../server/search');

const TITLE = 'Starter site template';
const SLUG = slugify(TITLE);
const LICENSE = 'CC0-1.0';

const BODY = Object.freeze({
    title: TITLE,
    kind: 'template',
    mode: 'free',
    summary: 'A licensed, static starter site: one page, one stylesheet, no tracking and no build step.',
    description: 'A Website template for a maker\'s first page. Copy it into a Space, change the words, publish. The manifest names a static entry point and the passport asks only to read Search and write Space files; it declares no spend, because v1 has no money.',
    license: LICENSE,
    license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
    version: '1.0.0',
    manifest: { name: 'Starter site', entry: 'templates/starter/index.html', runtime: 'static' },
    passport: { reads: ['search.read'], writes: ['space.files.write'], spends: [], contacts: ['https://openvibe.space'] },
});

async function runSeed({ config, s, log = console } = {}) {
    if (!config) config = load();
    if (!s) s = await openStore(config, { log });
    const search = createSearchIndex({ config, s });
    const entries = createStore(s, { search, config });

    const existing = await entries.bySlug(SLUG);
    if (existing) {
        log.log(`[seed-proof] ${SLUG} already exists (${existing.id}, ${existing.status}) — left as it is`);
        return { created: false, listing: entries.wireListing(existing), trial: null, install: null, revoked: null };
    }

    const maker = ids.newId('user');
    const installer = ids.newId('user');

    const draft = await entries.createListing({ owner: maker, creator: 'OpenVibe', body: BODY });
    if (!draft.ok) throw new Error(`listing was refused: ${draft.message}`);
    const listed = await entries.publish(draft.listing.slug, { owner: maker });
    if (!listed.ok) throw new Error(`listing was not published: ${listed.message}`);

    const sandbox = await entries.sandbox(listed.listing.slug, { subject: installer });
    if (!sandbox.ok) throw new Error(`sandbox was refused: ${sandbox.message}`);
    if (sandbox.trial.status !== 'passed') throw new Error(`sandbox trial did not pass: ${JSON.stringify(sandbox.checks)}`);

    const installed = await entries.install(listed.listing.slug, { subject: installer });
    if (!installed.ok) throw new Error(`install was refused: ${installed.message}`);

    const revoked = await entries.revoke(installed.install.id, { subject: installer });
    if (!revoked.ok) throw new Error(`revoke was refused: ${revoked.message}`);

    log.log(`[seed-proof] listed ${listed.listing.id} /listings/${listed.listing.slug} (${LICENSE}, free, version ${listed.listing.version})`);
    log.log(`[seed-proof] sandbox ${sandbox.trial.id}: ${sandbox.trial.status}; passport reads ${sandbox.trial.passport.reads.join(', ') || 'nothing'}, writes ${sandbox.trial.passport.writes.join(', ') || 'nothing'}, spends nothing`);
    log.log(`[seed-proof] installed ${installed.install.id} and revoked it (${revoked.install.status})`);
    return { created: true, listing: listed.listing, trial: sandbox.trial, install: installed.install, revoked: revoked.install };
}

async function main() {
    const config = load();
    const s = await openStore(config, { log: console });
    try {
        const out = await runSeed({ config, s });
        process.exitCode = out && out.listing ? 0 : 1;
    } finally {
        await s.close();
    }
}

if (require.main === module) {
    main().catch((err) => {
        console.error(`[seed-proof] ${err && err.message ? err.message : err}`);
        process.exitCode = 1;
    });
}

module.exports = { runSeed, SLUG, TITLE, LICENSE, BODY };
