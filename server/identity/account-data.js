'use strict';

/**
 * Account export and deletion → Exchange (ADR-033; openvibe-sdk/account-data). The rows a person owns are their
 * listings, their installations, their sandbox trials and the offers they made. A listing is anonymised, then
 * closed (or deleted if it was still a draft) in extraErase, and its Search document is tombstoned in the same
 * deletion transaction; nobody else's offers or installs are touched.
 *
 * The database stores bare usr_ ids in the subject columns. A listing's public creator name is the maker's own
 * display name; the passport, manifest, licence and tests are public metadata, never a credential.
 */
const { createAccountData, TOPICS } = require('openvibe-sdk/account-data');
const { ids } = require('openvibe-contracts');

const LISTING_COLUMNS = [
    'id', 'slug', 'title', 'kind', 'mode', 'summary', 'description', 'wants', 'license', 'license_url', 'version',
    'creator', 'status', 'closed_reason', 'revision', 'listed_at', 'closed_at', 'created_at', 'updated_at',
];

const TABLES = [
    { table: 'exchange_listings', subject: 'owner', value: (usr) => usr, file: 'listings.json', columns: LISTING_COLUMNS, erase: { anonymize: { creator: 'a deleted maker' } } },
    { table: 'exchange_installs', subject: 'subject', value: (usr) => usr, file: 'installs.json', erase: 'delete' },
    { table: 'exchange_sandbox_trials', subject: 'subject', value: (usr) => usr, file: 'sandbox-trials.json', erase: 'delete' },
    { table: 'exchange_offers', subject: 'from_subject', value: (usr) => usr, file: 'offers.json', erase: 'delete' },
];

function create({ db, log = console, now = () => Date.now() } = {}) {
    async function extraErase(t, subjects, { erased, retained, add }) {
        // The table map anonymised every listing whose owner is one of the subjects; close the public ones and
        // tombstone their Search documents, delete the drafts outright.
        const rows = await t.many('SELECT id, slug, status, mode, revision FROM exchange_listings WHERE owner IS NULL');
        let closed = 0;
        let deleted = 0;
        for (const row of rows) {
            if (row.status === 'draft') {
                await t.exec('DELETE FROM exchange_listings WHERE id = $1', [row.id]);
                deleted++;
                continue;
            }
            // Everything a person wrote is replaced, not just the owner link. A swap still needs a wants value
            // (the table's mode rule), so it gets a neutral one rather than the maker's words.
            const revision = Math.max(1, Number(row.revision) || 1) + (row.status === 'closed' ? 0 : 1);
            await t.exec(
                `UPDATE exchange_listings
                 SET title = 'A deleted listing', summary = 'Removed with its maker''s account.', description = NULL,
                     wants = CASE WHEN mode = 'swap' THEN 'A deleted swap' ELSE NULL END,
                     status = 'closed', closed_reason = COALESCE(closed_reason, 'withdrawn'), closed_at = COALESCE(closed_at, now()),
                     revision = $2, updated_at = now()
                 WHERE id = $1`,
                [row.id, revision],
            );
            if (row.status === 'closed') continue;
            await t.exec("UPDATE exchange_offers SET status = 'declined', decided_at = now() WHERE listing_id = $1 AND status = 'open'", [row.id]);
            await t.exec("INSERT INTO exchange_listing_events (listing_id, from_status, to_status, reason, changed_by) VALUES ($1, $2, 'closed', 'account deletion', 'account-deletion')", [row.id, row.status]);
            const eventId = ids.newId('event', now());
            await t.exec(
                `INSERT INTO exchange_outbox (event_id, topic, payload, created_at, next_attempt_at)
                 VALUES ($1, 'exchange.index_document.deleted', $2::jsonb, $3::timestamptz, $3::timestamptz)`,
                [eventId, JSON.stringify({ owner: 'exchange', type: 'listing', id: row.id, revision, deleted: true }), new Date(now()).toISOString()],
            );
            closed++;
        }
        if (closed) add(retained, 'exchange_listings_closed', closed);
        if (deleted) add(erased, 'exchange_listings_drafts', deleted);
    }

    return createAccountData({
        db,
        service: 'exchange',
        tables: TABLES,
        extraErase,
        note: 'Listings are anonymised and closed (or deleted when still drafts); installations, sandbox trials and offers are erased.',
        log,
    });
}

module.exports = { create, TABLES, TOPICS };
