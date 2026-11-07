'use strict';

/**
 * An agent's voice published here (actor.voice@1): the document, the author, and the listing's lifecycle.
 *
 * The rules are the contract's (OpenVibe.Contracts, contracts/actor/voice.v1.json): the document carries a name, a
 * short bio, the instructions, the rules, a level, a model and apps (ids only) and a signature by the author's
 * Network subject. It never carries memory, a connector's token or a file: a document that does is refused.
 *
 * The signature is a content hash and the author: Network has no per-subject signing key today (one server key
 * signs Network's own tokens), so the sha256 over the document's canonical JSON is the signature and the
 * `usr_…` subject is who wrote it. A document changed after it was signed no longer matches and is refused.
 *
 * A voice is free. There is no price and no money: it is borrowed, not bought.
 *
 *   read(input)                 a document in: the fields it keeps, or the reason it is refused
 *   publish(db, owner, doc)     the listing a document makes
 *   list(db) / get(db, slug)    the listed voices, one of them
 *   close(db, slug, by)         the author takes it down
 *   hide(db, slug, by)          staff take it down
 */
const crypto = require('crypto');

const CONTRACT = 'actor.voice@1';
const LEVELS = ['ask', 'auto-edits', 'approve-for-me', 'full'];
const APP = /^[a-z][a-z0-9._-]{0,63}$/;
const ENGINE = ['runtime', 'own-keys', 'open-gpu', 'link'];
const SUBJECT = /^usr_[0-9A-HJKMNP-TV-Z]{26}$/;
const HASH = /^[0-9a-f]{64}$/;
const FIELDS = ['voice', 'name', 'bio', 'face', 'instructions', 'rules', 'level', 'model', 'apps', 'author', 'signature'];
const NEVER = /^(memory|memories|notes?|tokens?|secret|secrets|keys?|credentials?|files?|attachments?|connectors?)$/i;

const isPlain = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** The canonical JSON of a document: the fields the contract names, in the order it names them. */
function canonical(doc) {
    const o = { voice: doc.voice, name: doc.name };
    if (doc.bio) o.bio = doc.bio;
    if (doc.face) o.face = doc.face;
    o.instructions = doc.instructions;
    if (doc.rules && doc.rules.length) o.rules = doc.rules;
    o.level = doc.level;
    if (doc.model) o.model = { engine: doc.model.engine, model: doc.model.model };
    if (doc.apps && dApps(doc)) o.apps = dApps(doc);
    o.author = doc.author && doc.author.name ? { subject: doc.author.subject, name: doc.author.name } : { subject: doc.author.subject };
    o.signed_at = doc.signature.signed_at;
    return JSON.stringify(o);
}
function dApps(doc) { return Array.isArray(doc.apps) && doc.apps.length ? doc.apps : null; }

const hashOf = (doc) => crypto.createHash('sha256').update(canonical(doc), 'utf8').digest('hex');

/** The key of a forbidden field anywhere in a document, or null. */
function findNever(value, depth = 0) {
    if (depth > 4 || !value || typeof value !== 'object') return null;
    if (Array.isArray(value)) { for (const v of value) { const k = findNever(v, depth + 1); if (k) return k; } return null; }
    for (const [k, v] of Object.entries(value)) { if (NEVER.test(k)) return k; const f = findNever(v, depth + 1); if (f) return f; }
    return null;
}

/** A document in: the fields it keeps (anything the contract does not know is stripped) or the reason it is refused. */
function read(input) {
    if (!isPlain(input)) return { error: 'A voice file must be a JSON object.' };
    if (input.voice !== CONTRACT) return { error: 'This is not a voice file: it says ' + JSON.stringify(input.voice === undefined ? null : input.voice) + '.' };
    const smuggled = findNever(input);
    if (smuggled) return { error: 'A voice never carries ' + smuggled + '.' };
    const doc = {};
    for (const k of FIELDS) if (input[k] !== undefined) doc[k] = input[k];
    if (typeof doc.name !== 'string' || !doc.name.trim() || doc.name.length > 60) return { error: 'The name must be 1–60 characters.' };
    if (doc.bio !== undefined && (typeof doc.bio !== 'string' || doc.bio.length > 280)) return { error: 'The bio must be at most 280 characters.' };
    if (doc.face !== undefined && (typeof doc.face !== 'string' || !doc.face.trim() || doc.face.length > 500)) return { error: 'The face must be an avatar ref of 1–500 characters.' };
    if (typeof doc.instructions !== 'string' || !doc.instructions.trim() || doc.instructions.length > 4000) return { error: 'The instructions must be 1–4000 characters.' };
    if (doc.rules !== undefined) {
        if (!Array.isArray(doc.rules) || doc.rules.length > 20) return { error: 'The rules must be at most 20 lines.' };
        for (const r of doc.rules) if (typeof r !== 'string' || !r.trim() || r.length > 200) return { error: 'Each rule must be 1–200 characters.' };
    }
    if (!LEVELS.includes(doc.level)) return { error: 'The level must be one of ' + LEVELS.join(', ') + '.' };
    if (doc.model !== undefined) {
        if (!isPlain(doc.model) || !ENGINE.includes(doc.model.engine)) return { error: 'The model engine must be one of ' + ENGINE.join(', ') + '.' };
        if (typeof doc.model.model !== 'string' || !doc.model.model.trim() || doc.model.model.length > 120) return { error: 'The model id must be 1–120 characters.' };
    }
    if (doc.apps !== undefined) {
        if (!Array.isArray(doc.apps) || doc.apps.length > 50) return { error: 'The apps must be at most 50 ids.' };
        for (const a of doc.apps) if (typeof a !== 'string' || !APP.test(a)) return { error: 'Each app id must be a connect slug.' };
    }
    if (!isPlain(doc.author)) return { error: 'The author must be a Network subject.' };
    const author = { subject: String(doc.author.subject || '').replace(/^user:/, '') };
    if (!SUBJECT.test(author.subject)) return { error: 'The author must be a Network subject (usr_…).' };
    if (doc.author.name !== undefined) {
        if (typeof doc.author.name !== 'string' || doc.author.name.length > 80) return { error: 'The author name must be at most 80 characters.' };
        author.name = doc.author.name;
    }
    doc.author = author;
    if (!isPlain(doc.signature) || doc.signature.alg !== 'sha256' || !HASH.test(String(doc.signature.hash || ''))) return { error: 'The signature must be a sha256 hash.' };
    if (typeof doc.signature.signed_at !== 'string' || Number.isNaN(Date.parse(doc.signature.signed_at))) return { error: 'The signature must carry the timestamp it was written at.' };
    if (hashOf(doc) !== doc.signature.hash) return { error: 'This voice was changed after it was signed: the hash does not match.' };
    return { doc };
}

/** The link a person shares to borrow this voice: the document itself, as JSON. */
const documentPath = (slug) => '/voices/' + encodeURIComponent(slug) + '/voice.json';

/** A slug for a voice: its name, then a short id so two voices with one name do not collide. */
function slugOf(name, id) {
    const base = String(name || 'voice').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'voice';
    return base + '-' + String(id || '').slice(-6).toLowerCase();
}

/** The listing a document makes. The author is the person who published it. */
async function publish(s, owner, doc) {
    const id = s.newId('voc');
    const slug = slugOf(doc.name, id);
    const row = await s.db.maybe("INSERT INTO exchange_agent_voices (id, slug, owner, name, bio, level, rules, voice, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,'listed',now(),now()) RETURNING *",
    [id, slug, owner, doc.name, doc.bio || null, doc.level, JSON.stringify(doc.rules || []), JSON.stringify(doc)]);
    await s.db.query('INSERT INTO exchange_agent_voice_events (id, voice_id, from_status, to_status, reason, changed_by, created_at) VALUES ($1,$2,NULL,$3,$4,$5,now())',
    [s.newId('evt'), id, 'listed', 'published', owner]);
    return row;
}

const list = (s) => s.db.many("SELECT * FROM exchange_agent_voices WHERE status = 'listed' ORDER BY created_at DESC LIMIT 200");
const get = (s, slug) => s.db.maybe('SELECT * FROM exchange_agent_voices WHERE slug = $1', [String(slug || '')]);

/** A status change, with its event row: the audit a listing has always had. */
async function setStatus(s, row, to, by, reason = null) {
    if (!row || row.status === to) return null;
    const updated = await s.db.maybe('UPDATE exchange_agent_voices SET status = $1, updated_at = now() WHERE id = $2 RETURNING *', [to, row.id]);
    await s.db.query('INSERT INTO exchange_agent_voice_events (id, voice_id, from_status, to_status, reason, changed_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,now())',
    [s.newId('evt'), row.id, row.status, to, reason, by]);
    return updated;
}

const close = (s, row, by) => setStatus(s, row, 'closed', by, 'closed by its author');
const hide = (s, row, by) => setStatus(s, row, 'hidden', by, 'hidden by staff');

module.exports = { CONTRACT, LEVELS, read, canonical, hashOf, findNever, publish, list, get, close, hide, setStatus, slugOf, documentPath };
