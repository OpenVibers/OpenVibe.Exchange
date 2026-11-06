'use strict';

/**
 * Sharing on OpenVibe.Exchange (design 2026-11-06, visibility step 2), through openvibe-sdk/share.
 *
 * The SDK owns the model and the rules: the shares row next to each item, the one access check (canView),
 * members, access requests, transfers, the append-only log and the delivery queue. This file is the wiring a
 * service supplies, and it is the same wiring OpenVibe.Community gives its pastes:
 *
 *   - network.json   Network's identity lookups (@name to a subject, and a person's card for the page)
 *   - events.publish OpenVibe.Events, so share.* envelopes go out through the same queue
 *   - notify         Network's notification push; a refusal is logged, never allowed to stall the queue
 *   - onAudienceChange keeps a character card's own audience column in step, so an old reader that only
 *     knows the column fails closed (private stays private)
 *   - onOwnerChange  moves the item's own owner column with a transfer
 *
 * Three kinds, one sheet, the person's default plus per-item override:
 *
 *   character    private until the creator shares it; Specific people covers "look at this while I write it".
 *   chat         Only me until the owner shares it; a sealed chat stays Only me and says why (its history is
 *                sealed to the owner's Locker, so no other account could read it anyway).
 *   arena-round  Only me until the owner shares it, so a demo of a pair can be shown.
 *
 * The audiences are the SDK's: Everyone (public), Anyone with the link (link), Specific people (people), Only
 * me (private).
 */
const { createShares, ShareError } = require('openvibe-sdk/share');
const { serviceAuth } = require('openvibe-contracts');

const SERVICE = 'exchange';
const KINDS = Object.freeze(['character', 'chat', 'arena-round']);
const AUDIENCES = ['public', 'link', 'people', 'private'];
const DEFAULT_AUDIENCE = 'private';
/** Exchange's audience words to the SDK's, and back. */
const TO_SDK = { public: 'public', unlisted: 'link', private: 'private', people: 'people', link: 'link' };
const FROM_SDK = { public: 'public', link: 'unlisted', people: 'private', private: 'private' };

const KIND_LABEL = Object.freeze({ character: 'character', chat: 'chat', 'arena-round': 'arena round' });

/** An item's share ref: { service: 'exchange', kind, id }. */
const refOf = (kind, id) => ({ service: SERVICE, kind, id: String(id) });

/** Exchange's viewer as the SDK wants it: a subject object, and the staff bit. */
function shareViewer(v) {
    if (!v || !v.subject) return null;
    if (String(v.subject).startsWith('usr_')) return { subject: { type: 'user', id: v.subject }, staff: !!v.staff };
    if (String(v.subject).startsWith('gst_')) return { subject: { type: 'guest', id: v.subject }, staff: !!v.staff };
    return null;
}

function createSharing({ db, config, fetchImpl = globalThis.fetch, log = console } = {}) {
    const base = String(config.networkInternalUrl || config.networkUrl).replace(/\/+$/, '');
    const tokens = config.oauth.clientSecret ? serviceAuth.createTokenClient({
        tokenUrl: base + '/oauth/token',
        clientId: config.oauth.clientId,
        clientSecret: config.oauth.clientSecret,
        audience: 'openvibe.network',
        scope: 'identity.subject.resolve network.notifications.push',
        fetchImpl,
    }) : null;

    async function networkJson({ path, method = 'GET', json, query } = {}) {
        if (!tokens) throw new Error('Network is not configured for this service');
        const url = new URL(base + path);
        for (const [k, v] of Object.entries(query || {})) if (v != null) url.searchParams.set(k, String(v));
        const headers = { Accept: 'application/json', ...(await tokens.authHeaders()) };
        if (json !== undefined) headers['Content-Type'] = 'application/json';
        const res = await fetchImpl(url, { method, headers, body: json === undefined ? undefined : JSON.stringify(json), signal: AbortSignal.timeout(8000) });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
            const err = new Error('Network ' + method + ' ' + path + ' ' + res.status + ': ' + ((body && (body.detail || body.error)) || 'failed'));
            err.status = res.status;
            throw err;
        }
        return body;
    }

    /** The page a notification opens, by kind. Never carries a title. */
    function linkOf(ref, row) {
        if (ref.kind === 'character') return config.baseUrl + '/c/' + encodeURIComponent(row.handle || '') + '/' + encodeURIComponent(row.slug || '');
        if (ref.kind === 'chat') return config.baseUrl + '/chat/' + encodeURIComponent(ref.id);
        if (ref.kind === 'arena-round') return config.baseUrl + '/arena/' + encodeURIComponent(ref.id);
        return config.baseUrl + '/';
    }

    async function itemRow(kind, id) {
        if (kind === 'character') return (await db.prepare('SELECT handle, slug FROM exchange_characters WHERE id = ?').get(String(id))) || {};
        if (kind === 'chat') return (await db.prepare('SELECT sealed FROM exchange_chats WHERE id = ?').get(String(id))) || {};
        return {};
    }

    /** One notification, addressed by canonical subject. It never carries an item's text. */
    async function notify(n) {
        const to = n && n.to;
        if (!to || to.type !== 'user') return;
        const kind = n.ref && n.ref.kind;
        const label = KIND_LABEL[kind] || 'thing';
        const words = {
            'share.added': ['A ' + label + ' was shared with you', 'Open it on OpenVibe.Exchange.'],
            'share.access_requested': ['Someone asked for access to your ' + label, 'Review the request on OpenVibe.Exchange.'],
            'share.transfer.requested': ['Someone wants to give you a ' + label, 'Accept or decline it on OpenVibe.Exchange.'],
            'share.transfer.answered': ['A ' + label + ' transfer was answered', 'See what happened on OpenVibe.Exchange.'],
        }[n.kind] || ['Sharing on OpenVibe.Exchange', 'There is something new for you.'];
        try {
            const row = n.ref ? await itemRow(n.ref.kind, n.ref.id) : {};
            await networkJson({
                path: '/internal/notifications/push', method: 'POST',
                json: {
                    subject: to.id, type: 'GENERIC', title: words[0], message: words[1],
                    service: 'exchange', url: n.ref && n.ref.id ? linkOf(n.ref, row) : config.baseUrl + '/',
                    category: 'social',
                },
            });
        } catch (err) {
            log.warn('[Sharing] notification not sent:', err.message);
        }
    }

    /** OpenVibe.Events. Exchange has no outbox of its own yet, so the envelope goes straight out. */
    async function publish(envelope) {
        if (!config.events.url) { log.warn('[Sharing] no events URL configured; share envelope not sent'); return; }
        const res = await fetchImpl(config.events.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(envelope),
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error('Events answered ' + res.status);
    }

    const shares = createShares({
        db,
        network: { json: networkJson },
        events: { publish },
        notify,
        onAudienceChange: async (ref, audience, tx) => {
            if (ref.service !== SERVICE) return;
            if (ref.kind === 'character') {
                await tx.exec('UPDATE exchange_characters SET audience = $1, updated_at = now() WHERE id = $2', [FROM_SDK[audience] || 'private', ref.id]);
                return;
            }
            if (ref.kind === 'chat') {
                // A sealed chat is never shared: its turns never reach this database in plain text, and the one
                // who holds the key is its owner. Refuse the change rather than promising something unreadable.
                if (audience !== 'private') {
                    const row = await tx.maybe('SELECT sealed FROM exchange_chats WHERE id = $1', [ref.id]);
                    if (row && row.sealed) throw new ShareError(400, 'share.invalid', 'A sealed chat stays Only me: only your Locker can read it.');
                }
            }
        },
        onOwnerChange: async (ref, from, to, tx) => {
            if (ref.service !== SERVICE) return;
            const owner = to && (to.type === 'user' || to.type === 'guest') ? to.id : null;
            if (ref.kind === 'character') {
                await tx.exec('UPDATE exchange_characters SET owner = $1, updated_at = now() WHERE id = $2', [owner, ref.id]);
            } else if (ref.kind === 'chat') {
                const row = await tx.maybe('SELECT sealed FROM exchange_chats WHERE id = $1', [ref.id]);
                if (row && row.sealed) throw new ShareError(400, 'share.invalid', 'A sealed chat stays with you: it cannot be given away.');
                await tx.exec('UPDATE exchange_chats SET owner = $1, updated_at = now() WHERE id = $2', [owner, ref.id]);
            } else if (ref.kind === 'arena-round') {
                await tx.exec('UPDATE exchange_arena_rounds SET owner = $1 WHERE id = $2', [owner, ref.id]);
            }
        },
    });

    const sv = (viewer) => shareViewer(viewer);

    return {
        shares,
        SERVICE,
        KINDS,
        AUDIENCES,
        TO_SDK,
        FROM_SDK,
        DEFAULT_AUDIENCE,
        refOf,
        shareViewer,
        networkJson,
        /** The SDK's own DDL, run by the migration role (server/db.js). */
        migrate: async () => await shares.migrate(),
        /** Register an item with the sharing system, Only me until its owner says otherwise. */
        register: async (viewer, kind, id, audience = DEFAULT_AUDIENCE) => await shares.register(refOf(kind, id), {
            owner_subject: { type: String(viewer.subject).startsWith('gst_') ? 'guest' : 'user', id: String(viewer.subject) },
            audience: TO_SDK[audience] || DEFAULT_AUDIENCE,
        }),
        /** The person's default for new items of a kind ("New chats: Only me"). Only me when unset. */
        defaultOf: async (owner, kind) => {
            if (!owner) return DEFAULT_AUDIENCE;
            const row = await db.prepare('SELECT audience FROM exchange_share_defaults WHERE owner = ? AND kind = ?')
                .get(String(owner), kind);
            return row && AUDIENCES.includes(row.audience) ? row.audience : DEFAULT_AUDIENCE;
        },
        /**
         * Set the default, and with `applyAll` move what exists too (rule 2). A sealed chat is never moved off
         * Only me; the character's own audience column follows whatever the share rows say.
         */
        setDefault: async (owner, kind, audience, { applyAll = false } = {}) => {
            if (!owner || !KINDS.includes(kind)) return false;
            const want = AUDIENCES.includes(audience) ? audience : DEFAULT_AUDIENCE;
            await db.prepare(`INSERT INTO exchange_share_defaults (owner, kind, audience, updated_at) VALUES (?, ?, ?, now())
                ON CONFLICT (owner, kind) DO UPDATE SET audience = excluded.audience, updated_at = now()`)
                .run(String(owner), kind, want);
            if (!applyAll) return true;
            const subject = { type: String(owner).startsWith('gst_') ? 'guest' : 'user', id: String(owner) };
            await db.tx(async (tx) => {
                if (kind === 'chat') {
                    await tx.exec(`UPDATE shares SET audience = $1, revision = revision + 1
                        WHERE service = $2 AND kind = 'chat' AND owner_subject->>'id' = $3 AND owner_subject->>'type' = $4
                        AND NOT EXISTS (SELECT 1 FROM exchange_chats c WHERE c.id = resource_id AND c.sealed)`,
                        [want, SERVICE, subject.id, subject.type]);
                } else {
                    await tx.exec(`UPDATE shares SET audience = $1, revision = revision + 1
                        WHERE service = $2 AND kind = $3 AND owner_subject->>'id' = $4 AND owner_subject->>'type' = $5`,
                        [want, SERVICE, kind, subject.id, subject.type]);
                }
                if (kind === 'character') {
                    await tx.exec('UPDATE exchange_characters SET audience = $1, updated_at = now() WHERE owner = $2',
                        [FROM_SDK[want] || 'private', String(owner)]);
                }
            });
            return true;
        },
        /** Just the audience, for deciding between "Only me" (no hint) and "Specific people" (the gate). */
        audienceOf: async (kind, id) => {
            const row = await db.prepare('SELECT audience FROM shares WHERE service = ? AND kind = ? AND resource_id = ?')
                .get(SERVICE, kind, String(id));
            return row ? row.audience : null;
        },
        canView: async (viewer, kind, id) => await shares.canView(sv(viewer), refOf(kind, id)),
        canEdit: async (viewer, kind, id) => await shares.canEdit(sv(viewer), refOf(kind, id)),
        get: async (viewer, kind, id) => await shares.get(sv(viewer), refOf(kind, id)),
        /** The owner's answer for the page, or null for anybody else. */
        ownerView: async (viewer, kind, id) => {
            try { return await shares.get(sv(viewer), refOf(kind, id)); } catch { return null; }
        },
        setAudience: async (viewer, kind, id, audience) => await shares.setAudience(sv(viewer), refOf(kind, id), TO_SDK[audience] || DEFAULT_AUDIENCE),
        addMembers: async (viewer, kind, id, list) => await shares.addMembers(sv(viewer), refOf(kind, id), list),
        removeMember: async (viewer, kind, id, subject) => await shares.removeMember(sv(viewer), refOf(kind, id), subject),
        requestAccess: async (viewer, kind, id) => await shares.requestAccess(sv(viewer), refOf(kind, id)),
        lookup: async (viewer, name) => await shares.lookup(sv(viewer), name),
        sharedWithMe: async (viewer, opts) => await shares.sharedWithMe(sv(viewer), { service: SERVICE, ...(opts || {}) }),
        /** The uniform API's describe(ref): the sheet shows the item's title and link to someone who may open it. */
        describe: async (ref) => {
            if (ref.service !== SERVICE) return {};
            const id = String(ref.id);
            if (ref.kind === 'character') {
                const row = await db.prepare('SELECT name, handle, slug FROM exchange_characters WHERE id = ?').get(id);
                if (!row) return {};
                return { title: row.name, link: linkOf(ref, row), roles: ['viewer'], transferable: true };
            }
            if (ref.kind === 'chat') {
                const row = await db.prepare('SELECT title, sealed FROM exchange_chats WHERE id = ?').get(id);
                if (!row) return {};
                return { title: row.sealed ? 'A sealed chat' : row.title, link: linkOf(ref, row), roles: ['viewer'], transferable: !row.sealed };
            }
            if (ref.kind === 'arena-round') {
                const row = await db.prepare('SELECT category FROM exchange_arena_rounds WHERE id = ?').get(id);
                if (!row) return {};
                return { title: 'An Arena round: ' + row.category, link: linkOf(ref, row), roles: ['viewer'], transferable: true };
            }
            return {};
        },
        /** Expire members and transfers, then send the queued events and notifications. */
        work: async ({ flush = true } = {}) => {
            let expired = 0;
            try { expired = await shares.expireMembers(); } catch (err) { log.warn('[Sharing] expiry sweep:', err.message); }
            let sent = 0;
            if (flush) { try { sent = await shares.flush(); } catch (err) { log.warn('[Sharing] deliveries:', err.message); } }
            return { expired, sent };
        },
    };
}

module.exports = { createSharing, shareViewer, refOf, KINDS, AUDIENCES, TO_SDK, FROM_SDK, SERVICE, DEFAULT_AUDIENCE, KIND_LABEL };
