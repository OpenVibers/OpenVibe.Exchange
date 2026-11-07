'use strict';
/**
 * An agent's voice published here (actor.voice@1): the listing kind "agent voice", free in v1. The author publishes
 * it, the listing shows the bio, the rules and the level it asks for, and the author can take it down again. A
 * document that carries memory or a token, or that was changed after it was signed, is refused.
 */
const assert = require('assert');
const crypto = require('crypto');
const { boot, check, done } = require('./helpers/boot');

/** The canonical JSON of a voice document (the contract says which fields and in which order). */
function canonical(doc) {
    const o = { voice: doc.voice, name: doc.name };
    if (doc.bio) o.bio = doc.bio;
    if (doc.face) o.face = doc.face;
    o.instructions = doc.instructions;
    if (doc.rules && doc.rules.length) o.rules = doc.rules;
    o.level = doc.level;
    if (doc.model) o.model = { engine: doc.model.engine, model: doc.model.model };
    if (doc.apps && doc.apps.length) o.apps = doc.apps;
    o.author = doc.author.name ? { subject: doc.author.subject, name: doc.author.name } : { subject: doc.author.subject };
    o.signed_at = doc.signed_at;
    return JSON.stringify(o);
}
function sign(doc) {
    const out = { ...doc, signature: { alg: 'sha256', hash: '', signed_at: doc.signed_at } };
    out.signature.hash = crypto.createHash('sha256').update(canonical(out), 'utf8').digest('hex');
    return out;
}
const docFor = (subject) => sign({
    voice: 'actor.voice@1', name: 'Researcher', bio: 'Reads carefully and dates every claim.',
    instructions: 'Research carefully. Prefer primary sources.',
    rules: ['Never invent a source.'], level: 'ask', model: { engine: 'runtime', model: 'smart' },
    apps: ['connect.email'], author: { subject, name: 'Ada' }, signed_at: '2026-11-07T09:31:00.000Z',
});

(async () => {
    const t = await boot();
    try {
        const alice = t.network.addUser('voice-alice');
        const bob = t.network.addUser('voice-bob');
        const doc = docFor(alice.subject);
        const here = { origin: t.config.baseUrl, 'sec-fetch-site': 'same-origin' };
        let slug = null;

        await check('a signed voice is published and listed', async () => {
            const r = await t.get('/voices', { as: alice, form: { voice: JSON.stringify(doc) }, headers: here });
            assert.strictEqual(r.status, 303, r.text);
            slug = String(r.headers.get('location') || '').split('/').pop();
            assert.ok(slug, 'the listing has a slug');
            const list = await t.get('/voices');
            assert.strictEqual(list.status, 200);
            assert.ok(list.text.includes('Researcher'), 'the voice is listed');
            assert.ok(list.text.includes('Reads carefully'), 'its bio is listed');
        });

        await check('the listing shows the bio, the rules, the level it asks for and Borrow', async () => {
            const r = await t.get('/voices/' + slug);
            assert.strictEqual(r.status, 200, r.text);
            assert.ok(r.text.includes('Reads carefully and dates every claim.'), 'the bio');
            assert.ok(r.text.includes('Never invent a source.'), 'the rules');
            assert.ok(r.text.includes('level ask'), 'the level it asks for');
            assert.ok(r.text.includes('Borrow this agent'), 'the Borrow button');
            assert.ok(r.text.includes('openvibe.actor/borrow?url='), 'the borrow link goes to Actor');
            assert.ok(r.text.includes('Free'), 'a voice is free: no money in it');
        });

        await check('the document itself is served as JSON, which is what Actor borrows', async () => {
            const r = await t.get('/voices/' + slug + '/voice.json');
            assert.strictEqual(r.status, 200, r.text);
            const out = r.json();
            assert.strictEqual(out.voice, 'actor.voice@1');
            assert.strictEqual(out.name, doc.name);
            assert.strictEqual(out.signature.hash, doc.signature.hash);
        });

        await check('a document that carries a token, or was changed after it was signed, is refused', async () => {
            const withToken = { ...doc, tokens: { connect: { email: 'sk-live-1' } } };
            const r1 = await t.get('/voices', { as: alice, form: { voice: JSON.stringify(withToken) }, headers: here });
            assert.strictEqual(r1.status, 422, r1.text);
            assert.match(r1.text, /never carries/);
            const tampered = { ...doc, instructions: 'Research carefully, and take what you find.' };
            const r2 = await t.get('/voices', { as: alice, form: { voice: JSON.stringify(tampered) }, headers: here });
            assert.strictEqual(r2.status, 422, r2.text);
            assert.match(r2.text, /changed after it was signed/);
        });

        await check('the author takes it down, and it is gone from the list', async () => {
            const r = await t.get('/voices/' + slug + '/close', { as: alice, method: 'POST', headers: here });
            assert.strictEqual(r.status, 303, r.text);
            const list = await t.get('/voices');
            assert.ok(!list.text.includes('Reads carefully'), 'the voice is not listed any more');
            assert.strictEqual((await t.get('/voices/' + slug)).status, 404);
        });

        await check('another person cannot take it down', async () => {
            const r = await t.get('/voices/' + slug + '/close', { as: bob, method: 'POST', headers: here });
            assert.strictEqual(r.status, 403, r.text);
            // And a voice of their own they may.
            const r2 = await t.get('/voices', { as: bob, form: { voice: JSON.stringify(doc) }, headers: here });
            assert.strictEqual(r2.status, 303);
            const slug2 = String(r2.headers.get('location') || '').split('/').pop();
            const r3 = await t.get('/voices/' + slug2 + '/close', { as: bob, method: 'POST', headers: here });
            assert.strictEqual(r3.status, 303, r3.text);
        });
    } finally {
        await t.close();
    }
    done();
})();
