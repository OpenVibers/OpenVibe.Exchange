'use strict';

/**
 * OpenVibe.Exchange's Search Fabric feed. Every public listing is one `search.index-document@1` (owner `exchange`,
 * type `listing`, page `/listings/<slug>`), written to `exchange_outbox` in the same transaction as the listing
 * change; a listing that is not `listed` (draft, hidden, closed) writes a tombstone, which wins over any older
 * revision. The document carries the maker's copy, the passport's declared permissions and the licence, so Search
 * can filter free/swap and kinds without reading the listing page.
 *
 * No service grant is needed to queue the rows: they wait in the outbox until OpenVibe.Search's document writer is
 * configured for `exchange` (README, "Grants it will need"). The relay is deliberately not part of v1.
 */
const { ids } = require('openvibe-contracts');

const OWNER = 'exchange';
const TYPE = 'listing';
const EVENT_UPSERTED = 'exchange.index_document.upserted';
const EVENT_DELETED = 'exchange.index_document.deleted';

const iso = (v) => (v == null ? null : (v instanceof Date ? v.toISOString() : String(v)));
const pagePath = (listing) => `/listings/${listing.slug}`;

function documentOf(listing, { baseUrl = 'https://openvibe.exchange' } = {}) {
    const revision = Math.max(1, Number(listing && listing.revision) || 1);
    if (!listing || listing.status !== 'listed') return { owner: OWNER, type: TYPE, id: listing.id, revision, deleted: true };
    const p = listing.passport || {};
    const reads = Array.isArray(p.reads) ? p.reads : [];
    const writes = Array.isArray(p.writes) ? p.writes : [];
    const contacts = Array.isArray(p.contacts) ? p.contacts : [];
    const body = [
        listing.title,
        listing.summary || '',
        listing.description || '',
        listing.wants ? `Wanted in return: ${listing.wants}` : '',
        reads.length ? `Reads: ${reads.join(', ')}` : '',
        writes.length ? `Writes: ${writes.join(', ')}` : '',
        contacts.length ? `Contacts: ${contacts.join(', ')}` : '',
        `Licence: ${listing.license} · version ${listing.version} · ${listing.mode}`,
        listing.home_url ? `Home: ${listing.home_url}` : '',
    ].filter(Boolean).join('\n').slice(0, 48_000);
    return {
        owner: OWNER,
        type: TYPE,
        id: listing.id,
        revision,
        deleted: false,
        visibility: 'public',
        canonical_url: `${String(baseUrl).replace(/\/+$/, '')}${pagePath(listing)}`,
        title: listing.title,
        ...(listing.summary ? { summary: listing.summary } : {}),
        body,
        facets: {
            kind: listing.kind,
            mode: listing.mode,
            license: listing.license,
            creator: listing.creator,
            official: Boolean(listing.official),
            can_read: reads,
            can_write: writes,
            can_contact: contacts,
        },
        authorship: 'human',
        publication_state: 'published',
        published_at: iso(listing.listed_at || listing.created_at),
        updated_at: iso(listing.updated_at),
        indexability: { decision: 'index' },
    };
}

function createSearchIndex({ config, s, baseUrl = config.baseUrl }) {
    const nowIso = () => new Date(s.now()).toISOString();

    async function enqueue(topic, payload, t = null) {
        const db = t || s.db;
        const eventId = ids.newId('event', s.now());
        await db.exec(
            `INSERT INTO exchange_outbox (event_id, topic, payload, created_at, next_attempt_at)
             VALUES ($1, $2, $3::jsonb, $4::timestamptz, $4::timestamptz)`,
            [eventId, topic, JSON.stringify(payload), nowIso()],
        );
        return eventId;
    }

    /** Queue the current document on the caller's transaction (upsert when listed, tombstone otherwise). */
    async function sync(t, listing) {
        const doc = documentOf(listing, { baseUrl });
        return await enqueue(doc.deleted ? EVENT_DELETED : EVENT_UPSERTED, doc, t);
    }

    async function remove(t, id, revision) {
        return await enqueue(EVENT_DELETED, { owner: OWNER, type: TYPE, id, revision: Math.max(1, Number(revision) || 1), deleted: true }, t);
    }

    async function pending() {
        return Number(await s.db.value('SELECT COUNT(*)::int AS n FROM exchange_outbox WHERE published_at IS NULL'));
    }

    return { sync, remove, enqueue, documentOf, pending, baseUrl: String(baseUrl).replace(/\/+$/, '') };
}

module.exports = { createSearchIndex, documentOf, pagePath, OWNER, TYPE, EVENT_UPSERTED, EVENT_DELETED };
