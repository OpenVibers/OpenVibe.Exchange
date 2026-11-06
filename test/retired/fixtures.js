'use strict';
/** Shared fixtures: a valid CC0 template and helpers to create / publish it through the public API. */

const BODY = Object.freeze({
    title: 'Starter site template',
    kind: 'template',
    mode: 'free',
    summary: 'A licensed, static starter site: one page, no tracking.',
    description: 'Copy it into a Space, change the words, publish.',
    license: 'CC0-1.0',
    license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
    version: '1.0.0',
    manifest: { name: 'Starter site', entry: 'templates/starter/index.html', runtime: 'static' },
    passport: { reads: ['search.read'], writes: ['space.files.write'], spends: [], contacts: ['https://openvibe.space'] },
});

function body(overrides = {}) {
    return {
        ...BODY,
        ...overrides,
        manifest: { ...BODY.manifest, ...(overrides.manifest || {}) },
        passport: { ...BODY.passport, ...(overrides.passport || {}) },
    };
}

async function create(t, user, overrides = {}) {
    const r = await t.get('/api/v1/listings', { as: user, json: body(overrides) });
    if (r.status !== 201) throw new Error(`create listing ${r.status}: ${r.text}`);
    return r.json();
}

async function listed(t, user, overrides = {}) {
    const l = await create(t, user, overrides);
    const r = await t.get(`/api/v1/listings/${l.slug}/list`, { as: user, method: 'POST' });
    if (r.status !== 200) throw new Error(`publish listing ${r.status}: ${r.text}`);
    return r.json();
}

async function sandbox(t, user, slug) {
    const r = await t.get(`/api/v1/listings/${slug}/sandbox`, { as: user, method: 'POST' });
    if (r.status !== 201) throw new Error(`sandbox ${r.status}: ${r.text}`);
    return r.json();
}

async function install(t, user, slug) {
    const r = await t.get(`/api/v1/listings/${slug}/install`, { as: user, method: 'POST' });
    if (r.status !== 201 && r.status !== 200) throw new Error(`install ${r.status}: ${r.text}`);
    return r.json();
}

module.exports = { BODY, body, create, listed, sandbox, install };
