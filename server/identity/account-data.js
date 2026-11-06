'use strict';

/**
 * Account export and deletion → Exchange (ADR-033; openvibe-sdk/account-data).
 *
 * v1 rows (kept read-only since the remake) are still exported and their listings anonymised and closed, as they
 * were promised when they were written. The new rows are the person's chats, their messages and their 18+
 * confirmation; those are erased outright.
 */
const { createAccountData, TOPICS } = require('openvibe-sdk/account-data');

const LISTING_COLUMNS = [
    'id', 'slug', 'title', 'kind', 'mode', 'summary', 'description', 'wants', 'license', 'license_url', 'version',
    'creator', 'status', 'closed_reason', 'revision', 'listed_at', 'closed_at', 'created_at', 'updated_at',
];

const TABLES = [
    { table: 'exchange_listings', subject: 'owner', value: (usr) => usr, file: 'listings.json', columns: LISTING_COLUMNS, erase: { anonymize: { creator: 'a deleted maker' } } },
    { table: 'exchange_installs', subject: 'subject', value: (usr) => usr, file: 'installs.json', erase: 'delete' },
    { table: 'exchange_sandbox_trials', subject: 'subject', value: (usr) => usr, file: 'sandbox-trials.json', erase: 'delete' },
    { table: 'exchange_offers', subject: 'from_subject', value: (usr) => usr, file: 'offers.json', erase: 'delete' },
    { table: 'exchange_chats', subject: 'owner', value: (usr) => usr, file: 'chats.json', erase: 'delete' },
    { table: 'exchange_chat_messages', subject: 'owner', value: (usr) => usr, file: 'chat-messages.json', erase: 'delete' },
    { table: 'exchange_adult_confirmations', subject: 'subject', value: (usr) => usr, file: 'adult-confirmation.json', erase: 'delete' },
];

function create({ db, log = console } = {}) {
    async function extraErase(t, subjects, { erased, retained, add }) {
        // The table map anonymised every v1 listing whose owner is one of the subjects; close the public ones and
        // delete the drafts outright. Nothing is published anywhere any more (the Search relay left with v1).
        const rows = await t.many('SELECT id, status, revision FROM exchange_listings WHERE owner IS NULL');
        let closed = 0;
        let deleted = 0;
        for (const row of rows) {
            if (row.status === 'draft') {
                await t.exec('DELETE FROM exchange_listings WHERE id = $1', [row.id]);
                deleted++;
                continue;
            }
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
        note: 'Chats, messages and the 18+ confirmation are erased; v1 listings are anonymised and closed (or deleted when still drafts).',
        log,
    });
}

module.exports = { create, TABLES, TOPICS };
