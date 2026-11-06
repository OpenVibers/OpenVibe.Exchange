'use strict';

/**
 * Sharing for character cards (Opus's design, 2026-11-06), through openvibe-sdk/share.
 *
 * The SDK owns the model and the rules: the shares row next to each card, the one access check (canView),
 * members, access requests, transfers, the append-only log and the delivery queue. This file is the wiring
 * a service supplies, and it is the same wiring OpenVibe.Community gives its pastes:
 *
 *   - network.json   Network's identity lookups (@name to a subject, and a person's card for the page)
 *   - events.publish OpenVibe.Events, so share.* envelopes go out through the same queue
 *   - notify         Network's notification push; a refusal is logged, never allowed to stall the queue
 *   - onAudienceChange keeps the card's own audience column in step, so an old reader that only knows the
 *     column fails closed (private stays private)
 *
 * The audiences: a card is private by default, unlisted (a link, not in the gallery) or public.
 * The SDK speaks public, link, people and private; unlisted is its link.
 */
const { createShares } = require('openvibe-sdk/share');
const { serviceAuth } = require('openvibe-contracts');

const SERVICE = 'exchange';
const KIND = 'character';
const AUDIENCES = ['public', 'link', 'people', 'private'];
/** Exchange's audience words to the SDK's, and back. */
const TO_SDK = { public: 'public', unlisted: 'link', private: 'private' };
const FROM_SDK = { public: 'public', link: 'unlisted', people: 'private', private: 'private' };

/** A card's share ref: { service: 'exchange', kind: 'character', id: <card id> }. */
const refOf = (id) => ({ service: SERVICE, kind: KIND, id: String(id) });

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

    /** One notification, addressed by canonical subject. It never carries a card's text. */
    async function notify(n) {
        const to = n && n.to;
        if (!to || to.type !== 'user') return;
        const words = {
            'share.added': ['A character was shared with you', 'Open it on OpenVibe.Exchange.'],
            'share.access_requested': ['Someone asked for access to your character', 'Review the request on OpenVibe.Exchange.'],
            'share.transfer.requested': ['Someone wants to give you a character', 'Accept or decline it on OpenVibe.Exchange.'],
            'share.transfer.answered': ['A character transfer was answered', 'See what happened on OpenVibe.Exchange.'],
        }[n.kind] || ['Sharing on OpenVibe.Exchange', 'There is something new for you.'];
        try {
            await networkJson({
                path: '/internal/notifications/push', method: 'POST',
                json: {
                    subject: to.id, type: 'GENERIC', title: words[0], message: words[1],
                    service: 'exchange', url: n.ref && n.ref.id ? config.baseUrl + '/c/' + n.ref.id : config.baseUrl + '/companions',
                    category: 'social',
                },
            });
        } catch (err) {
            log.warn('[Companions] notification not sent:', err.message);
        }
    }

    /** OpenVibe.Events. Exchange has no outbox of its own yet, so the envelope goes straight out. */
    async function publish(envelope) {
        if (!config.events.url) { log.warn('[Companions] no events URL configured; share envelope not sent'); return; }
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
            if (ref.service !== SERVICE || ref.kind !== KIND) return;
            await tx.exec('UPDATE exchange_characters SET audience = $1, updated_at = now() WHERE id = $2', [FROM_SDK[audience] || 'private', ref.id]);
        },
        onOwnerChange: async (ref, from, to, tx) => {
            if (ref.service !== SERVICE || ref.kind !== KIND) return;
            const owner = to && to.type === 'user' ? to.id : null;
            await tx.exec('UPDATE exchange_characters SET owner = $1, updated_at = now() WHERE id = $2', [owner, ref.id]);
        },
    });

    const sv = (viewer) => shareViewer(viewer);
    const at = (id) => refOf(id);

    return {
        shares,
        SERVICE,
        KIND,
        AUDIENCES,
        TO_SDK,
        FROM_SDK,
        refOf,
        shareViewer,
        networkJson,
        /** The SDK's own DDL, run by the migration role (server/db.js). */
        migrate: async () => await shares.migrate(),
        /** Register a card with the sharing system, private until its owner says otherwise. */
        register: async (viewer, id, audience = 'private') => await shares.register(at(id), {
            owner_subject: { type: 'user', id: String(viewer.subject) },
            audience: TO_SDK[audience] || 'private',
        }),
        canView: async (viewer, id) => await shares.canView(sv(viewer), at(id)),
        canEdit: async (viewer, id) => await shares.canEdit(sv(viewer), at(id)),
        get: async (viewer, id) => await shares.get(sv(viewer), at(id)),
        getWithRevision: async (viewer, id) => await shares.getWithRevision(sv(viewer), at(id)),
        setAudience: async (viewer, id, audience) => await shares.setAudience(sv(viewer), at(id), TO_SDK[audience] || 'private'),
        addMembers: async (viewer, id, list) => await shares.addMembers(sv(viewer), at(id), list),
        removeMember: async (viewer, id, subject) => await shares.removeMember(sv(viewer), at(id), subject),
        requestAccess: async (viewer, id) => await shares.requestAccess(sv(viewer), at(id)),
        lookup: async (viewer, name) => await shares.lookup(sv(viewer), name),
        sharedWithMe: async (viewer, opts) => await shares.sharedWithMe(sv(viewer), { service: SERVICE, ...(opts || {}) }),
        /** Expire members and transfers, then send the queued events and notifications. */
        work: async ({ flush = true } = {}) => {
            let expired = 0;
            try { expired = await shares.expireMembers(); } catch (err) { log.warn('[Companions] expiry sweep:', err.message); }
            let sent = 0;
            if (flush) { try { sent = await shares.flush(); } catch (err) { log.warn('[Companions] deliveries:', err.message); } }
            return { expired, sent };
        },
    };
}

module.exports = { createSharing, shareViewer, refOf, AUDIENCES, TO_SDK, FROM_SDK, SERVICE, KIND };
