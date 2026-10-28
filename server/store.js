'use strict';

/**
 * Exchange's data: listings, their permission passports and conformance tests, sandbox trials, installations and
 * free/swap offers.
 *
 * A listing is born `draft` and only its owner can list it, after every conformance test for the current version
 * passed. A write that changes a public listing writes its Search document (or tombstone) in the same transaction
 * (server/search.js). An installation is private: it never becomes a Search document. A sandbox trial is a
 * manifest dry run, not a code execution — Exchange v1 never runs a listing's code (Run has no sandbox today).
 *
 * There is no money in v1: a listing's mode is `free` or `swap`, and its passport's `spends` must be empty.
 * The passport is the listing's public declaration of what it may read, write, spend and contact; installs keep
 * the exact passport they were installed with, so a later edit to the listing cannot widen an old install.
 */
const { cleanText, refusals, SAFETY } = require('./safety');

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KINDS = Object.freeze(['agent', 'mcp_tool', 'template', 'theme', 'game_asset', 'service']);
const MODES = Object.freeze(['free', 'swap']);
const STATUSES = Object.freeze(['draft', 'listed', 'hidden', 'closed']);
const CLOSED_REASONS = Object.freeze(['given', 'swapped', 'withdrawn']);
const OFFER_KINDS = Object.freeze(['claim', 'swap']);
const OFFER_STATUSES = Object.freeze(['open', 'accepted', 'declined', 'withdrawn']);
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const LICENSE_RE = /^[A-Za-z0-9][A-Za-z0-9.+-]{1,63}$/;
const SCOPE_RE = /^[a-z][a-z0-9_.:-]{1,63}$/;
const CONTACT_RE = /^https:\/\/[^\s"'<>]{1,200}$/;
const SECRET_VALUE_RE = /(?:secret|password|passwd|token|api[_-]?key|private[_-]?key|bearer)\s*[:=]|-----BEGIN [A-Z ]*PRIVATE KEY-----/i;

const iso = (v) => (v == null ? null : (v instanceof Date ? v.toISOString() : String(v)));
const refusal = (status, code, message, field) => ({ ok: false, status, code, message, ...(field ? { field } : {}) });

function json(v, fallback) {
    if (v == null) return fallback;
    if (typeof v === 'object') return v;
    try { return JSON.parse(v); } catch { return fallback; }
}

function stringArray(v) {
    return Array.isArray(v) ? v.map(String) : [];
}

function wirePassport(v) {
    const p = json(v, {});
    return {
        reads: stringArray(p.reads),
        writes: stringArray(p.writes),
        spends: stringArray(p.spends),
        contacts: stringArray(p.contacts),
    };
}

function wireManifest(v) {
    const m = json(v, {});
    return { name: m.name || '', entry: m.entry || '', runtime: m.runtime || null };
}

function wireTest(row) {
    if (!row) return null;
    return { id: Number(row.id), name: row.name, status: row.status, detail: row.detail == null ? null : row.detail, ran_at: iso(row.ran_at) };
}

function wireListing(row, { tests = null, includeOwner = false, summaryTests = false } = {}) {
    if (!row) return null;
    const out = {
        id: row.id,
        slug: row.slug,
        title: row.title,
        kind: row.kind,
        mode: row.mode,
        summary: row.summary == null ? null : row.summary,
        description: row.description == null ? null : row.description,
        wants: row.wants == null ? null : row.wants,
        license: row.license,
        license_url: row.license_url == null ? null : row.license_url,
        version: row.version,
        creator: row.creator,
        status: row.status,
        revision: Number(row.revision) || 1,
        passport: wirePassport(row.passport),
        manifest: wireManifest(row.manifest),
        listed_at: iso(row.listed_at),
        closed_at: iso(row.closed_at),
        closed_reason: row.closed_reason == null ? null : row.closed_reason,
        created_at: iso(row.created_at),
        updated_at: iso(row.updated_at),
    };
    if (includeOwner) out.owner = row.owner == null ? null : row.owner;
    if (summaryTests) {
        const count = Number(row.test_count) || 0;
        const failed = Number(row.test_failed) || 0;
        out.tests = { count, failed, verified: count > 0 && failed === 0 };
    }
    if (tests) out.tests = { count: tests.length, failed: tests.filter((t) => t.status === 'failed').length, verified: tests.length > 0 && tests.every((t) => t.status === 'passed'), rows: tests };
    if (row.install_count != null) out.installs = Number(row.install_count) || 0;
    if (row.offer_count != null) out.open_offers = Number(row.offer_count) || 0;
    return out;
}

function wireTrial(row, listing = null) {
    if (!row) return null;
    return {
        id: row.id,
        listing_id: row.listing_id,
        version: row.version,
        status: row.status,
        passport: wirePassport(row.passport),
        checks: json(row.checks, []),
        created_at: iso(row.created_at),
        expires_at: iso(row.expires_at),
        consumed_at: iso(row.consumed_at),
        ...(listing ? { listing: { slug: listing.slug, title: listing.title, mode: listing.mode, version: listing.version } } : {}),
    };
}

function wireInstall(row) {
    if (!row) return null;
    return {
        id: row.id,
        listing_id: row.listing_id,
        version: row.version,
        status: row.status,
        passport: wirePassport(row.passport),
        installed_at: iso(row.installed_at),
        revoked_at: iso(row.revoked_at),
        revision: Number(row.revision) || 1,
        ...(row.slug ? { listing: { slug: row.slug, title: row.title, mode: row.mode, kind: row.kind, license: row.license } } : {}),
    };
}

function wireOffer(row) {
    if (!row) return null;
    return {
        id: row.id,
        listing_id: row.listing_id,
        kind: row.kind,
        body: row.body,
        give: row.give == null ? null : row.give,
        from_name: row.from_name,
        status: row.status,
        created_at: iso(row.created_at),
        decided_at: iso(row.decided_at),
        ...(row.slug ? { listing: { slug: row.slug, title: row.title, mode: row.mode, owner: row.listing_owner || null } } : {}),
    };
}

function normalizePassport(input) {
    const p = input && typeof input === 'object' ? input : {};
    const allowed = ['reads', 'writes', 'spends', 'contacts'];
    const unknown = Object.keys(p).filter((k) => !allowed.includes(k));
    if (unknown.length) return refusal(400, 'exchange.invalid', `Unknown passport field: ${unknown[0]}`, 'passport');
    const out = {};
    for (const key of ['reads', 'writes']) {
        const list = p[key] == null ? [] : p[key];
        if (!Array.isArray(list)) return refusal(400, 'exchange.invalid', `passport.${key} must be an array of permission names`, 'passport');
        if (list.length > 20) return refusal(400, 'exchange.invalid', `passport.${key} may name at most 20 permissions`, 'passport');
        const seen = new Set();
        const cleaned = [];
        for (const value of list) {
            const s = cleanText(value, 64);
            if (!SCOPE_RE.test(s)) return refusal(400, 'exchange.invalid', `passport.${key} must be lower-case permission names such as search.read`, 'passport');
            if (!seen.has(s)) { seen.add(s); cleaned.push(s); }
        }
        out[key] = cleaned;
    }
    const spends = p.spends == null ? [] : p.spends;
    if (!Array.isArray(spends)) return refusal(400, 'exchange.invalid', 'passport.spends must be an array', 'passport');
    if (spends.length) return refusal(400, 'exchange.no_money', 'v1 is free and swap only: a passport may not declare a spend', 'passport');
    out.spends = [];
    const contacts = p.contacts == null ? [] : p.contacts;
    if (!Array.isArray(contacts)) return refusal(400, 'exchange.invalid', 'passport.contacts must be an array of https origins', 'passport');
    if (contacts.length > 20) return refusal(400, 'exchange.invalid', 'passport.contacts may name at most 20 origins', 'passport');
    out.contacts = [];
    const seenContacts = new Set();
    for (const value of contacts) {
        const s = cleanText(value, 200);
        if (!CONTACT_RE.test(s)) return refusal(400, 'exchange.invalid', 'passport.contacts must be https origins, one per entry', 'passport');
        try {
            const u = new URL(s);
            if (u.username || u.password || !u.hostname) throw new Error('credentials');
            const normalized = `${u.origin}${u.pathname === '/' ? '' : u.pathname}`;
            if (!seenContacts.has(normalized)) { seenContacts.add(normalized); out.contacts.push(normalized); }
        } catch { return refusal(400, 'exchange.invalid', 'passport.contacts must be https origins, one per entry', 'passport'); }
    }
    return { ok: true, value: out };
}

function normalizeManifest(input, version) {
    const m = input && typeof input === 'object' ? input : {};
    const allowed = ['name', 'entry', 'runtime'];
    const unknown = Object.keys(m).filter((k) => !allowed.includes(k));
    if (unknown.length) return refusal(400, 'exchange.invalid', `A manifest may name only name, entry and runtime (not ${unknown[0]})`, 'manifest');
    const name = cleanText(m.name, 80);
    const entry = cleanText(m.entry, 200);
    const runtime = cleanText(m.runtime, 80);
    if (name.length < 2 || name.length > 80) return refusal(400, 'exchange.invalid', 'manifest.name must be 2 to 80 characters', 'manifest');
    if (entry.length < 1 || entry.length > 200) return refusal(400, 'exchange.invalid', 'manifest.entry must be 1 to 200 characters', 'manifest');
    if (runtime && (runtime.length < 1 || runtime.length > 80)) return refusal(400, 'exchange.invalid', 'manifest.runtime may be at most 80 characters', 'manifest');
    for (const [key, value] of [['name', name], ['entry', entry], ['runtime', runtime]]) {
        if (SECRET_VALUE_RE.test(value)) return refusal(400, 'exchange.manifest_secret', `manifest.${key} looks like a credential; a manifest is public metadata and must never carry a secret`, 'manifest');
        if (/[\u0000-\u001f\u007f]/.test(value)) return refusal(400, 'exchange.invalid', 'a manifest is plain text: no control characters', 'manifest');
    }
    return { ok: true, value: { name, entry, runtime: runtime || null, version } };
}

/** Validate a new listing body. Returns { ok, value } or a refusal; the page form and the API share it. */
function normalizeListing(body) {
    const b = body && typeof body === 'object' ? body : {};
    const allowed = ['title', 'kind', 'mode', 'summary', 'description', 'license', 'license_url', 'version', 'wants', 'manifest', 'passport'];
    const unknown = Object.keys(b).filter((k) => !allowed.includes(k));
    if (unknown.length) return refusal(400, 'exchange.invalid', `Unknown field: ${unknown[0]}`, unknown[0]);
    const title = cleanText(b.title, 120);
    if (title.length < 3 || title.length > 120) return refusal(400, 'exchange.invalid', 'title must be 3 to 120 characters', 'title');
    if (!KINDS.includes(b.kind)) return refusal(400, 'exchange.invalid', `kind must be one of ${KINDS.join(', ')}`, 'kind');
    if (!MODES.includes(b.mode)) return refusal(400, 'exchange.invalid', `mode must be one of ${MODES.join(', ')}`, 'mode');
    const summary = cleanText(b.summary, 600);
    if (summary.length < 3 || summary.length > 600) return refusal(400, 'exchange.invalid', 'summary must be 3 to 600 characters', 'summary');
    const description = cleanText(b.description, 4000);
    const license = cleanText(b.license, 64);
    if (!LICENSE_RE.test(license)) return refusal(400, 'exchange.invalid', 'license must be an SPDX identifier such as CC0-1.0, MIT or AGPL-3.0-only', 'license');
    const licenseUrl = cleanText(b.license_url, 300);
    if (licenseUrl && !/^https:\/\/[^\s"'<>]{1,300}$/.test(licenseUrl)) return refusal(400, 'exchange.invalid', 'license_url must be an https URL', 'license_url');
    const version = cleanText(b.version, 32);
    if (!VERSION_RE.test(version)) return refusal(400, 'exchange.invalid', 'version must be a semantic version such as 1.0.0', 'version');
    const wants = cleanText(b.wants, 300);
    if (b.mode === 'swap' && (wants.length < 3 || wants.length > 300)) return refusal(400, 'exchange.invalid', 'a swap listing must say what it would like in return (3 to 300 characters)', 'wants');
    if (b.mode === 'free' && wants) return refusal(400, 'exchange.invalid', 'a free listing does not name what it wants in return', 'wants');
    const manifest = normalizeManifest(b.manifest, version);
    if (!manifest.ok) return manifest;
    const passport = normalizePassport(b.passport);
    if (!passport.ok) return passport;
    const hit = refusals(title, summary, description, wants);
    if (hit) return hit;
    return {
        ok: true,
        value: {
            title, kind: b.kind, mode: b.mode, summary, description: description || null, license,
            license_url: licenseUrl || null, version, wants: wants || null, manifest: manifest.value, passport: passport.value,
        },
    };
}

/** The four conformance tests run for every version. A listing is not public until every one passed. */
function checksFor(v) {
    return [
        { name: 'manifest', status: 'passed', detail: 'The manifest names the listing and its entry point; it carries no credential.' },
        { name: 'passport', status: 'passed', detail: 'The permission passport is present and names only read, write and contact grants.' },
        { name: 'licence', status: 'passed', detail: `The licence is ${v.license}.` },
        { name: 'no_money', status: 'passed', detail: `Mode ${v.mode}; the passport declares no spend. ${SAFETY}` },
    ];
}

function slugify(title) {
    const s = String(title || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 70);
    return s || 'listing';
}

function createStore(s, { search, config }) {
    const db = s.db;
    const q = (t) => t || db;
    const sandboxTtlMs = Math.max(5, Number(config && config.sandbox && config.sandbox.ttlMinutes) || 60) * 60_000;
    const sandboxPerDay = Math.max(1, Number(config && config.sandbox && config.sandbox.perDay) || 20);

    async function bySlug(slug, t) {
        return await q(t).maybe('SELECT * FROM exchange_listings WHERE slug = $1', [String(slug || '')]);
    }
    async function byId(id, t) {
        return await q(t).maybe('SELECT * FROM exchange_listings WHERE id = $1', [String(id || '')]);
    }
    async function testsFor(listingId, version = null, t) {
        const rows = version
            ? await q(t).many('SELECT * FROM exchange_listing_tests WHERE listing_id = $1 AND version = $2 ORDER BY id ASC', [listingId, version])
            : await q(t).many('SELECT * FROM exchange_listing_tests WHERE listing_id = $1 ORDER BY id ASC', [listingId]);
        return rows.map(wireTest);
    }
    async function verified(listingId, version, t) {
        const rows = await testsFor(listingId, version, t);
        return rows.length > 0 && rows.every((r) => r.status === 'passed');
    }

    async function uniqueSlug(base, t) {
        const root = String(base || 'listing').slice(0, 70).replace(/^-+|-+$/g, '') || 'listing';
        let slug = root;
        for (let i = 2; i < 200; i++) {
            const found = await q(t).maybe('SELECT id FROM exchange_listings WHERE slug = $1', [slug]);
            if (!found) return slug;
            slug = `${root}-${i}`;
        }
        return `${root}-${Date.now().toString(36)}`;
    }

    async function event(t, listingId, from, to, reason, changedBy) {
        await t.exec('INSERT INTO exchange_listing_events (listing_id, from_status, to_status, reason, changed_by) VALUES ($1, $2, $3, $4, $5)',
            [listingId, from, to, reason || null, changedBy || null]);
    }

    /** Insert one draft and its conformance tests in the caller's transaction. Never publishes. */
    async function createListing({ owner, creator, body }, t = null) {
        const checked = normalizeListing(body);
        if (!checked.ok) return checked;
        const v = checked.value;
        const run = async (tx) => {
            const id = s.newId('exl');
            const slug = await uniqueSlug(slugify(v.title), tx);
            const creatorName = cleanText(creator, 80) || 'a maker';
            const row = await tx.maybe(
                `INSERT INTO exchange_listings (id, slug, title, kind, mode, summary, description, wants, license, license_url, version,
                    creator, owner, status, manifest, passport, revision, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'draft', $14::jsonb, $15::jsonb, 1, now(), now())
                 RETURNING *`,
                [id, slug, v.title, v.kind, v.mode, v.summary, v.description, v.wants, v.license, v.license_url, v.version,
                    creatorName, owner, JSON.stringify(v.manifest), JSON.stringify(v.passport)],
            );
            const checks = checksFor(v);
            for (const c of checks) {
                await tx.exec('INSERT INTO exchange_listing_tests (listing_id, version, name, status, detail) VALUES ($1, $2, $3, $4, $5)',
                    [id, v.version, c.name, c.status, c.detail]);
            }
            await event(tx, id, null, 'draft', 'created', owner);
            const tests = await testsFor(id, v.version, tx);
            return { ok: true, listing: wireListing(row, { tests, includeOwner: true }) };
        };
        return t ? await run(t) : await s.tx(run);
    }

    /** Public listings, newest first. cursor is an opaque (listed_at, id) keyset position. */
    async function list({ limit = 20, cursor = null, mode = null, kind = null, q: text = null } = {}) {
        const n = Math.min(50, Math.max(1, Number(limit) || 20));
        const args = [];
        let where = "status = 'listed'";
        if (mode) { if (!MODES.includes(mode)) return { error: 'mode' }; args.push(mode); where += ` AND mode = $${args.length}`; }
        if (kind) { if (!KINDS.includes(kind)) return { error: 'kind' }; args.push(kind); where += ` AND kind = $${args.length}`; }
        const term = cleanText(text, 120);
        if (term) {
            args.push(`%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
            where += ` AND (title ILIKE $${args.length} OR summary ILIKE $${args.length} OR creator ILIKE $${args.length})`;
        }
        let pos = null;
        if (cursor) {
            try {
                const decoded = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
                if (typeof decoded.t === 'string' && typeof decoded.i === 'string' && !Number.isNaN(Date.parse(decoded.t))) pos = decoded;
            } catch { /* refused below */ }
            if (!pos) return { error: 'cursor' };
            args.push(pos.t, pos.i);
            where += ` AND (listed_at, id) < ($${args.length - 1}::timestamptz, $${args.length})`;
        }
        args.push(n + 1);
        const rows = await db.many(
            `SELECT l.*,
                    (SELECT COUNT(*)::int FROM exchange_listing_tests t WHERE t.listing_id = l.id AND t.version = l.version AND t.status = 'passed') AS test_count,
                    (SELECT COUNT(*)::int FROM exchange_listing_tests t WHERE t.listing_id = l.id AND t.version = l.version AND t.status = 'failed') AS test_failed
             FROM exchange_listings l WHERE ${where} ORDER BY listed_at DESC, id DESC LIMIT $${args.length}`,
            args,
        );
        const hasMore = rows.length > n;
        const page = rows.slice(0, n);
        const last = page[page.length - 1];
        return {
            listings: page.map((r) => wireListing(r, { summaryTests: true })),
            next_cursor: hasMore && last ? Buffer.from(JSON.stringify({ t: iso(last.listed_at), i: last.id })).toString('base64url') : null,
        };
    }

    /** One listing with its conformance tests and public counters. */
    async function detail(slug) {
        const row = await bySlug(slug);
        if (!row) return null;
        const enriched = await db.maybe(
            `SELECT l.*,
                    (SELECT COUNT(*)::int FROM exchange_installs i WHERE i.listing_id = l.id AND i.status = 'active') AS install_count,
                    (SELECT COUNT(*)::int FROM exchange_offers o WHERE o.listing_id = l.id AND o.status = 'open') AS offer_count
             FROM exchange_listings l WHERE l.id = $1`,
            [row.id],
        );
        return { row: enriched, listing: wireListing(enriched, { tests: await testsFor(row.id), includeOwner: true }) };
    }

    async function listMine(owner, { limit = 100 } = {}) {
        const rows = await db.many('SELECT * FROM exchange_listings WHERE owner = $1 ORDER BY created_at DESC LIMIT $2', [owner, Math.min(200, Math.max(1, Number(limit) || 100))]);
        const out = [];
        for (const row of rows) out.push(wireListing(row, { tests: await testsFor(row.id) }));
        return out;
    }

    async function counts() {
        const row = await db.maybe(
            `SELECT COUNT(*)::int AS listings,
                    COUNT(*) FILTER (WHERE mode = 'free')::int AS free,
                    COUNT(*) FILTER (WHERE mode = 'swap')::int AS swap,
                    (SELECT COUNT(DISTINCT owner)::int FROM exchange_listings WHERE status = 'listed' AND owner IS NOT NULL) AS makers,
                    (SELECT COUNT(*)::int FROM exchange_installs WHERE status = 'active') AS installs
             FROM exchange_listings WHERE status = 'listed'`,
        );
        return row || { listings: 0, free: 0, swap: 0, makers: 0, installs: 0 };
    }

    /** Owner publishes a draft (or a closed one cannot be relisted). Every conformance test must have passed. */
    async function publish(slug, { owner } = {}) {
        return await s.tx(async (t) => {
            const row = await bySlug(slug, t);
            if (!row || row.owner !== owner) return refusal(404, 'exchange.not_found', 'No such listing of yours.');
            if (row.status === 'listed') return { ok: true, listing: wireListing(row, { tests: await testsFor(row.id), includeOwner: true }), unchanged: true };
            if (row.status === 'hidden') return refusal(409, 'exchange.hidden', 'Staff hid this listing; it cannot be relisted here.');
            if (row.status === 'closed') return refusal(409, 'exchange.closed', 'A closed listing cannot be relisted; submit a new one.');
            if (!(await verified(row.id, row.version, t))) return refusal(409, 'exchange.tests_not_passed', 'Every conformance test for this version must pass before the listing can be public.');
            const updated = await t.maybe("UPDATE exchange_listings SET status = 'listed', listed_at = now(), revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING *", [row.id]);
            await event(t, row.id, row.status, 'listed', 'listed', owner);
            await search.sync(t, wireListing(updated), []);
            return { ok: true, listing: wireListing(updated, { tests: await testsFor(row.id), includeOwner: true }), unchanged: false };
        });
    }

    async function close(slug, { owner, reason = 'withdrawn' } = {}) {
        return await s.tx(async (t) => {
            const row = await bySlug(slug, t);
            if (!row || row.owner !== owner) return refusal(404, 'exchange.not_found', 'No such listing of yours.');
            if (row.status === 'closed') return { ok: true, listing: wireListing(row, { tests: await testsFor(row.id), includeOwner: true }), unchanged: true };
            const why = CLOSED_REASONS.includes(reason) ? reason : 'withdrawn';
            const updated = await t.maybe("UPDATE exchange_listings SET status = 'closed', closed_reason = $2, closed_at = now(), revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING *", [row.id, why]);
            await t.exec("UPDATE exchange_offers SET status = 'declined', decided_at = now() WHERE listing_id = $1 AND status = 'open'", [row.id]);
            await event(t, row.id, row.status, 'closed', why, owner);
            await search.sync(t, wireListing(updated), []);
            return { ok: true, listing: wireListing(updated, { tests: await testsFor(row.id), includeOwner: true }), unchanged: false };
        });
    }

    async function hide(slug, { changedBy } = {}) {
        return await s.tx(async (t) => {
            const row = await bySlug(slug, t);
            if (!row) return refusal(404, 'exchange.not_found', 'No such listing.');
            if (row.status === 'hidden') return { ok: true, listing: wireListing(row, { tests: await testsFor(row.id), includeOwner: true }), unchanged: true };
            const updated = await t.maybe("UPDATE exchange_listings SET status = 'hidden', revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING *", [row.id]);
            await event(t, row.id, row.status, 'hidden', 'staff hide', changedBy);
            await search.sync(t, wireListing(updated), []);
            return { ok: true, listing: wireListing(updated, { tests: await testsFor(row.id), includeOwner: true }), unchanged: false };
        });
    }

    /** A sandbox trial: a manifest dry run against the passport; no listing code is executed. */
    async function sandbox(slug, { subject }) {
        const row = await bySlug(slug);
        if (!row || row.status !== 'listed') return refusal(404, 'exchange.not_found', 'No such public listing.');
        const tests = await testsFor(row.id, row.version);
        const dayStart = new Date(s.now());
        dayStart.setUTCHours(0, 0, 0, 0);
        const used = Number(await db.value('SELECT COUNT(*)::int FROM exchange_sandbox_trials WHERE subject = $1 AND created_at >= $2::timestamptz', [subject, dayStart.toISOString()])) || 0;
        if (used >= sandboxPerDay) return refusal(429, 'exchange.sandbox_limit', 'You have tried as many listings in the sandbox today as v1 allows; try again tomorrow.');
        const passport = wirePassport(row.passport);
        const verifiedTests = tests.length > 0 && tests.every((x) => x.status === 'passed');
        const checks = [
            { name: 'listed', status: 'passed', detail: 'The listing is public.' },
            { name: 'tests', status: verifiedTests ? 'passed' : 'failed', detail: verifiedTests ? `${tests.length} conformance tests passed for version ${row.version}.` : 'The conformance tests for this version are not all passing.' },
            { name: 'passport', status: passport.spends.length === 0 ? 'passed' : 'failed', detail: passport.spends.length === 0 ? 'The passport declares read, write and contact grants only; no spend.' : 'The passport declares a spend, which v1 does not allow.' },
            { name: 'execution', status: 'passed', detail: 'Dry run only: Exchange v1 does not execute the listing. A real Run sandbox needs the run.sandbox.execute grant (README).' },
        ];
        const status = checks.every((c) => c.status === 'passed') ? 'passed' : 'failed';
        const id = s.newId('exs');
        const expiresAt = new Date(s.now() + sandboxTtlMs).toISOString();
        const saved = await db.maybe(
            `INSERT INTO exchange_sandbox_trials (id, listing_id, subject, version, status, passport, checks, created_at, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, now(), $8::timestamptz) RETURNING *`,
            [id, row.id, subject, row.version, status, JSON.stringify(passport), JSON.stringify(checks), expiresAt],
        );
        return { ok: true, trial: wireTrial(saved, row), checks, listing: wireListing(row) };
    }

    async function trialById(id, { subject }) {
        const row = await db.maybe(
            `SELECT t.*, l.slug, l.title, l.mode, l.version AS listing_version FROM exchange_sandbox_trials t
             JOIN exchange_listings l ON l.id = t.listing_id WHERE t.id = $1 AND t.subject = $2`,
            [String(id || ''), subject],
        );
        if (!row) return null;
        const listing = { slug: row.slug, title: row.title, mode: row.mode, version: row.listing_version };
        return { row, trial: wireTrial(row, listing), listing };
    }

    async function hasPassedTrial(listingId, subject, version) {
        const row = await db.maybe(
            `SELECT id FROM exchange_sandbox_trials
             WHERE listing_id = $1 AND subject = $2 AND version = $3 AND status = 'passed' AND consumed_at IS NULL AND expires_at > $4::timestamptz
             ORDER BY created_at DESC LIMIT 1`,
            [listingId, subject, version, s.iso()],
        );
        return Boolean(row);
    }

    async function activeInstall(listingId, subject) {
        const row = await db.maybe("SELECT * FROM exchange_installs WHERE listing_id = $1 AND subject = $2 AND status = 'active'", [listingId, subject]);
        return wireInstall(row);
    }

    async function install(slug, { subject }) {
        return await s.tx(async (t) => {
            const row = await bySlug(slug, t);
            if (!row || row.status !== 'listed') return refusal(404, 'exchange.not_found', 'No such public listing.');
            const existing = await t.maybe("SELECT * FROM exchange_installs WHERE listing_id = $1 AND subject = $2 AND status = 'active'", [row.id, subject]);
            if (existing) return { ok: true, install: wireInstall({ ...existing, slug: row.slug, title: row.title, mode: row.mode, kind: row.kind, license: row.license }), unchanged: true };
            const trial = await t.maybe(
                `SELECT * FROM exchange_sandbox_trials
                 WHERE listing_id = $1 AND subject = $2 AND version = $3 AND status = 'passed' AND consumed_at IS NULL AND expires_at > $4::timestamptz
                 ORDER BY created_at DESC LIMIT 1`,
                [row.id, subject, row.version, s.iso()],
            );
            if (!trial) return refusal(409, 'exchange.sandbox_required', 'Try this version in the sandbox first; a passed trial is required before an install.');
            const id = s.newId('exi');
            const saved = await t.maybe(
                `INSERT INTO exchange_installs (id, listing_id, subject, version, passport, status, installed_at, revision)
                 VALUES ($1, $2, $3, $4, $5::jsonb, 'active', now(), 1) RETURNING *`,
                [id, row.id, subject, row.version, JSON.stringify(wirePassport(row.passport))],
            );
            await t.exec('UPDATE exchange_sandbox_trials SET consumed_at = now() WHERE id = $1', [trial.id]);
            return { ok: true, install: wireInstall({ ...saved, slug: row.slug, title: row.title, mode: row.mode, kind: row.kind, license: row.license }), unchanged: false };
        });
    }

    async function installsFor(subject) {
        const rows = await db.many(
            `SELECT i.*, l.slug, l.title, l.mode, l.kind, l.license FROM exchange_installs i
             JOIN exchange_listings l ON l.id = i.listing_id WHERE i.subject = $1 ORDER BY i.installed_at DESC`,
            [subject],
        );
        return rows.map(wireInstall);
    }

    async function revoke(installId, { subject }) {
        return await s.tx(async (t) => {
            const row = await t.maybe('SELECT * FROM exchange_installs WHERE id = $1 AND subject = $2', [String(installId || ''), subject]);
            if (!row) return refusal(404, 'exchange.install_not_found', 'No such installation of yours.');
            if (row.status === 'revoked') return { ok: true, install: wireInstall(row), unchanged: true };
            const updated = await t.maybe("UPDATE exchange_installs SET status = 'revoked', revoked_at = now(), revision = revision + 1 WHERE id = $1 RETURNING *", [row.id]);
            // v1 has no Network grant to revoke: this record is the entitlement. v2 calls Network's grant revoke
            // with the exchange service token (README, "Grants it will need").
            return { ok: true, install: wireInstall(updated), unchanged: false };
        });
    }

    /** A free claim or a swap offer. The owner cannot offer on their own listing. */
    async function offer(slug, { subject, fromName, body, give }) {
        return await s.tx(async (t) => {
            const row = await bySlug(slug, t);
            if (!row || row.status !== 'listed') return refusal(404, 'exchange.not_found', 'No such public listing.');
            if (row.owner === subject) return refusal(400, 'exchange.own_listing', 'This is your listing; you cannot claim or swap with yourself.');
            const existing = await t.maybe("SELECT id FROM exchange_offers WHERE listing_id = $1 AND from_subject = $2 AND status = 'open'", [row.id, subject]);
            if (existing) return refusal(409, 'exchange.offer_exists', 'You already have an open offer on this listing.');
            const kind = row.mode === 'free' ? 'claim' : 'swap';
            const message = cleanText(body, 1000);
            if (message.length < 3 || message.length > 1000) return refusal(400, 'exchange.invalid', 'Say something to the maker (3 to 1000 characters).', 'body');
            const giving = cleanText(give, 1000);
            if (kind === 'swap' && (giving.length < 3 || giving.length > 1000)) return refusal(400, 'exchange.invalid', 'A swap offer must say what you offer in return (3 to 1000 characters).', 'give');
            if (kind === 'claim' && giving && (giving.length < 3 || giving.length > 1000)) return refusal(400, 'exchange.invalid', 'A claim may include a note of 3 to 1000 characters, or nothing at all.', 'give');
            const hit = refusals(message, giving);
            if (hit) return hit;
            const id = s.newId('exo');
            const saved = await t.maybe(
                `INSERT INTO exchange_offers (id, listing_id, from_subject, from_name, kind, body, give, status, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', now()) RETURNING *`,
                [id, row.id, subject, cleanText(fromName, 80) || 'a maker', kind, message, giving || null],
            );
            return { ok: true, offer: wireOffer({ ...saved, slug: row.slug, title: row.title, mode: row.mode, listing_owner: row.owner }) };
        });
    }

    async function offersFor(subject) {
        const sent = await db.many(
            `SELECT o.*, l.slug, l.title, l.mode, l.owner AS listing_owner FROM exchange_offers o
             JOIN exchange_listings l ON l.id = o.listing_id WHERE o.from_subject = $1 ORDER BY o.created_at DESC`,
            [subject],
        );
        const received = await db.many(
            `SELECT o.*, l.slug, l.title, l.mode, l.owner AS listing_owner FROM exchange_offers o
             JOIN exchange_listings l ON l.id = o.listing_id WHERE l.owner = $1 ORDER BY o.created_at DESC`,
            [subject],
        );
        return { sent: sent.map(wireOffer), received: received.map(wireOffer) };
    }

    async function offersForListing(listingId) {
        const rows = await db.many("SELECT * FROM exchange_offers WHERE listing_id = $1 AND status = 'open' ORDER BY created_at ASC", [listingId]);
        return rows.map(wireOffer);
    }

    /** accept/decline are the owner's; withdraw is the offerer's. Accept closes the listing (given or swapped). */
    async function decideOffer(offerId, { subject, action }) {
        if (!['accept', 'decline', 'withdraw'].includes(action)) return refusal(400, 'exchange.invalid', 'action must be accept, decline or withdraw');
        return await s.tx(async (t) => {
            const o = await t.maybe('SELECT * FROM exchange_offers WHERE id = $1', [String(offerId || '')]);
            if (!o) return refusal(404, 'exchange.offer_not_found', 'No such offer.');
            const listing = await byId(o.listing_id, t);
            if (!listing) return refusal(404, 'exchange.offer_not_found', 'No such offer.');
            if (action === 'withdraw' && o.from_subject !== subject) return refusal(403, 'exchange.offer_not_yours', 'Only the person who made an offer can withdraw it.');
            if (action !== 'withdraw' && listing.owner !== subject) return refusal(403, 'exchange.owner_only', 'Only the listing owner can accept or decline an offer.');
            if (o.status !== 'open') return { ok: true, offer: wireOffer(o), unchanged: true };
            const status = action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'withdrawn';
            const updated = await t.maybe("UPDATE exchange_offers SET status = $2, decided_at = now() WHERE id = $1 RETURNING *", [o.id, status]);
            let closed = null;
            if (status === 'accepted') {
                const why = listing.mode === 'free' ? 'given' : 'swapped';
                const updatedListing = await t.maybe("UPDATE exchange_listings SET status = 'closed', closed_reason = $2, closed_at = now(), revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING *", [listing.id, why]);
                await t.exec("UPDATE exchange_offers SET status = 'declined', decided_at = now() WHERE listing_id = $1 AND id <> $2 AND status = 'open'", [listing.id, o.id]);
                await event(t, listing.id, listing.status, 'closed', why, subject);
                await search.sync(t, wireListing(updatedListing), []);
                closed = wireListing(updatedListing, { tests: await testsFor(listing.id), includeOwner: true });
            }
            return { ok: true, offer: wireOffer(updated), closed, unchanged: false };
        });
    }

    /** Imported/seedable listing used by scripts/seed-proof.js: goes through the same validation and tests. */
    async function seedListing({ owner, creator, body }) {
        return await createListing({ owner, creator, body });
    }

    return {
        wireListing, wireTrial, wireInstall, wireOffer, wirePassport, wireTest,
        normalizeListing, normalizePassport, normalizeManifest, checksFor,
        bySlug, byId, testsFor, verified, uniqueSlug,
        createListing, list, detail, listMine, counts,
        publish, close, hide,
        sandbox, trialById,
        hasPassedTrial, activeInstall, install, installsFor, revoke,
        offer, offersFor, offersForListing, decideOffer,
        seedListing,
        KINDS, MODES, STATUSES, CLOSED_REASONS, OFFER_KINDS, OFFER_STATUSES, SAFETY,
    };
}

module.exports = {
    createStore, slugify, normalizeListing, normalizePassport, normalizeManifest, checksFor,
    wireListing, wireTrial, wireInstall, wireOffer, wirePassport, wireTest,
    SLUG_RE, KINDS, MODES, STATUSES, CLOSED_REASONS, OFFER_KINDS, OFFER_STATUSES, VERSION_RE, LICENSE_RE,
};
