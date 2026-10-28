'use strict';
/**
 * Server-rendered pages: the home (hero, three scenes, fresh listings), browse and filters, one listing with its
 * passport and tests, the submit form, the sandbox trial, installations, offers, safety, developers, 404, cache
 * headers, content-hashed one-comment assets, and the discovery artifacts.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const fixtures = require('./helpers/fixtures');
const { assetVersion } = require('../server/render/layout');

function jsonLd(html) {
    return [...String(html).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
}

(async () => {
    const t = await boot();
    const alice = t.network.addUser('alice');
    const bob = t.network.addUser('bob');
    const listing = await fixtures.listed(t, alice, {
        title: 'A page-tested template',
        summary: 'A template that the pages can show.',
        description: 'Line one.\nLine two.',
    });
    try {
        await check('home: the hero, the three scenes and a fresh listing, public with Vary: Cookie', async () => {
            const r = await t.get('/');
            assert.strictEqual(r.status, 200);
            assert.strictEqual(r.headers.get('cache-control'), 'public, max-age=60');
            assert.strictEqual(r.headers.get('vary'), 'Cookie');
            for (const marker of ['id="ex-home"', 'id="ex-listings"', 'class="sc-room-scenes"', '<noscript><nav', '<footer id="ov-footer"', '<main id="main"', 'Trade what people make', 'A page-tested template', '/submit', '/safety']) {
                assert.ok(r.text.includes(marker), marker);
            }
            const types = jsonLd(r.text).map((x) => x['@type']);
            assert.ok(types.includes('WebSite'), types.join(','));
            assert.ok(types.includes('WebApplication'), types.join(','));
            assert.strictEqual((await t.get('/', { as: alice })).headers.get('cache-control'), 'private, no-store');
        });

        await check('/listings filters and lists; a public listing page carries the passport and tests', async () => {
            const browse = await t.get('/listings?mode=free&kind=template');
            assert.strictEqual(browse.status, 200);
            assert.strictEqual(browse.headers.get('cache-control'), 'public, max-age=60');
            assert.ok(browse.text.includes('id="ex-listings-page"'));
            assert.ok(browse.text.includes('id="ex-filters"'));
            assert.ok(browse.text.includes('A page-tested template'));
            const detail = await t.get(`/listings/${listing.slug}`);
            assert.strictEqual(detail.status, 200);
            assert.strictEqual(detail.headers.get('cache-control'), 'public, max-age=60');
            for (const marker of ['id="ex-listing"', 'id="ex-about"', 'id="ex-passport"', 'id="ex-tests"', 'id="ex-sandbox"', 'id="ex-install"', 'id="ex-manifest"', 'ex-passport-reads', 'CC0-1.0', 'Line one.']) {
                assert.ok(detail.text.includes(marker), marker);
            }
            assert.ok(!detail.text.includes('id="ex-offer-form"'), 'a guest gets a sign-in prompt, not the form');
            const signed = await t.get(`/listings/${listing.slug}`, { as: bob });
            assert.strictEqual(signed.status, 200);
            assert.ok(signed.text.includes('id="ex-offer-form"'));
            assert.ok(signed.text.includes('Run the sandbox'));
            assert.strictEqual(signed.headers.get('cache-control'), 'private, no-store');
        });

        await check('the submit form is plain HTML; a form POST saves a draft and redirects to it', async () => {
            const form = await t.get('/submit');
            assert.strictEqual(form.status, 200);
            for (const marker of ['id="ex-submit"', 'id="ex-listing-form"', 'name="passport_reads"', 'name="manifest_entry"', 'name="mode"', 'nothing', 'no money']) assert.ok(form.text.toLowerCase().includes(marker.toLowerCase()), marker);
            const r = await t.get('/submit', {
                as: alice,
                form: {
                    title: 'A form-made theme', kind: 'theme', mode: 'free', summary: 'A theme made through the form.',
                    description: 'It has a description.', license: 'MIT', version: '1.0.0',
                    manifest_name: 'Form theme', manifest_entry: 'theme.json', manifest_runtime: 'css',
                    passport_reads: 'search.read\nspace.files.read', passport_writes: 'space.files.write', passport_contacts: 'https://openvibe.space',
                },
            });
            assert.strictEqual(r.status, 303, r.text);
            assert.match(r.headers.get('location'), /^\/listings\/a-form-made-theme\?submitted=1$/);
            const page = await t.get(r.headers.get('location'), { as: alice });
            assert.strictEqual(page.status, 200);
            assert.ok(page.text.includes('id="ex-owner"'));
            assert.ok(page.text.includes('Draft'));
            assert.ok(page.text.includes('id="ex-passport"'));
            assert.strictEqual((await t.get('/submit', { as: alice, form: { title: 'x' } })).status, 400);
        });

        await check('a form POST from another site is refused', async () => {
            const r = await t.get('/submit', {
                as: alice, origin: 'https://evil.example',
                form: { title: 'A cross-site theme', kind: 'theme', mode: 'free', summary: 'A theme.', license: 'MIT', version: '1.0.0', manifest_name: 'X', manifest_entry: 'x' },
            });
            assert.strictEqual(r.status, 403);
            assert.ok(r.text.includes('id="ex-not-found"') || r.text.includes('That came from somewhere else'));
        });

        await check('the sandbox form redirects to a stable trial page; install and revoke work by form', async () => {
            const sb = await t.get(`/listings/${listing.slug}/sandbox`, { as: bob, method: 'POST' });
            assert.strictEqual(sb.status, 303);
            assert.match(sb.headers.get('location'), /^\/sandbox\/exs_/);
            const page = await t.get(sb.headers.get('location'), { as: bob });
            assert.strictEqual(page.status, 200);
            assert.ok(page.text.includes('id="ex-sandbox-trial"'));
            assert.ok(page.text.includes('The dry run passed'));
            const ins = await t.get(`/listings/${listing.slug}/install`, { as: bob, method: 'POST' });
            assert.strictEqual(ins.status, 303);
            assert.strictEqual(ins.headers.get('location'), '/installs?installed=1');
            const installs = await t.get('/installs', { as: bob });
            assert.ok(installs.text.includes('id="ex-installs"'));
            assert.ok(installs.text.includes('Revoke'));
            const id = await t.ctx.s.db.value("SELECT id FROM exchange_installs WHERE status = 'active' LIMIT 1");
            const rev = await t.get(`/installs/${id}/revoke`, { as: bob, method: 'POST' });
            assert.strictEqual(rev.status, 303);
            assert.strictEqual(rev.headers.get('location'), '/installs?revoked=1');
            assert.strictEqual((await t.ctx.s.db.value('SELECT status FROM exchange_installs WHERE id = $1', [id])), 'revoked');
        });

        await check('the claim form creates a free claim; the owner sees it on the listing page', async () => {
            const claim = await t.get(`/listings/${listing.slug}/offers`, { as: bob, form: { body: 'I would like to use this.' } });
            assert.strictEqual(claim.status, 303);
            assert.strictEqual(claim.headers.get('location'), `/listings/${listing.slug}?offered=1`);
            const owner = await t.get(`/listings/${listing.slug}`, { as: alice });
            assert.ok(owner.text.includes('id="ex-offers"'));
            assert.ok(owner.text.includes('I would like to use this.'));
            assert.ok(owner.text.includes('Accept the claim'));
        });

        await check('safety, developers, 404 and the submit sign-in prompt', async () => {
            const safety = await t.get('/safety');
            assert.strictEqual(safety.status, 200);
            assert.ok(safety.text.includes('id="ex-safety"'));
            assert.ok(safety.text.includes('No money, anywhere'));
            const dev = await t.get('/developers');
            assert.strictEqual(dev.status, 200);
            assert.ok(dev.text.includes('id="ex-developers"'));
            assert.ok(dev.text.includes('/api/v1/listings'));
            assert.ok(dev.text.includes('network.grants.write'));
            const nf = await t.get('/no/such/page');
            assert.strictEqual(nf.status, 404);
            assert.match(nf.headers.get('content-type'), /^text\/html/);
            assert.ok(nf.text.includes('id="ex-not-found"'));
            const prompt = await t.get('/submit', { as: null });
            assert.ok(prompt.text.includes('id="ex-listing-form"'), 'a guest can read the form');
            const install = await t.get('/installs');
            assert.strictEqual(install.status, 401);
            assert.ok(install.text.includes('Sign in with OpenVibe'));
        });

        await check('assets are content-hashed and served; robots and sitemap list public listings', async () => {
            const v = assetVersion('css/exchange.css');
            const css = await t.get(`/css/exchange.css?v=${v}`);
            assert.strictEqual(css.status, 200);
            assert.strictEqual(css.headers.get('cache-control'), 'public, max-age=31536000, immutable');
            assert.match(css.text, /OpenVibe\.Exchange: the room's own pieces/, 'the designed stylesheet');
            const wrong = await t.get('/css/exchange.css?v=deadbeefdeadbeef');
            assert.strictEqual(wrong.status, 200);
            assert.strictEqual(wrong.headers.get('cache-control'), 'public, max-age=300, stale-while-revalidate=86400');
            const js = await t.get('/js/exchange.js');
            assert.strictEqual(js.status, 200);
            assert.match(js.headers.get('content-type'), /javascript/);
            assert.strictEqual(js.text.trim().split('\n').length, 1);
            const robots = await t.get('/robots.txt');
            assert.match(robots.text, /Disallow: \/api\//);
            const map = await t.get('/sitemap.xml');
            assert.strictEqual(map.status, 200);
            assert.ok(map.text.includes(`https://openvibe.exchange/listings/${listing.slug}`));
            const llms = await t.get('/llms.txt');
            assert.strictEqual(llms.status, 200);
            assert.ok(llms.text.includes('OpenVibe.Exchange'));
            const full = await t.get('/llms-full.txt');
            assert.ok(full.text.includes(listing.slug));
        });
    } finally {
        await t.close();
    }
    done();
})();
