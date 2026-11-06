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
    // The companions (2026-11-06): a person's characters, their chats and the messages in them are theirs,
    // exactly like the chats above. The messages go first, then the chats, then the characters: a character
    // may be deleted while somebody else's chat still points at it, and that chat keeps its messages.
    { table: 'exchange_companion_messages', subject: 'owner', value: (usr) => usr, file: 'companion-messages.json', erase: 'delete' },
    { table: 'exchange_companion_chats', subject: 'owner', value: (usr) => usr, file: 'companion-chats.json', erase: 'delete' },
    { table: 'exchange_characters', subject: 'owner', value: (usr) => usr, file: 'characters.json', erase: 'delete' },
    // Memory notes and lorebooks (stages 3 and 4, 2026-11-06). The note TEXT lives in the person's own
    // OpenVibe memory (the M2 store, OpenVibe.AI), which its own account export and deletion carry; Exchange
    // exports and erases the index (kind, pin, who wrote it) and every lorebook entry, which are ours.
    { table: 'exchange_companion_notes', subject: 'owner', value: (usr) => usr, file: 'companion-notes.json', erase: 'delete' },
    { table: 'exchange_lorebook_entries', subject: 'owner', value: (usr) => usr, file: 'lorebook-entries.json', erase: 'delete' },
    { table: 'exchange_lorebooks', subject: 'owner', value: (usr) => usr, file: 'lorebooks.json', erase: 'delete' },
    { table: 'exchange_companion_locks', subject: 'owner', value: (usr) => usr, file: 'companion-locks.json', erase: 'delete' },
];

function create({ db, log = console } = {}) {
    async function extraErase(t, subjects, { erased, retained, add }) {
        // The sharing system's own rows (openvibe-sdk/share) name a person as a member or as somebody who asked
        // for access. Their subject column is jsonb (a subject object), which the table map cannot express, so
        // they are erased here instead.
        const forms = subjects.map((s) => JSON.stringify({ type: 'user', id: s }));
        const members = await t.exec(`DELETE FROM share_members WHERE subject = ANY($1::jsonb[])`, [forms]);
        const requests = await t.exec(`DELETE FROM share_access_requests WHERE subject = ANY($1::jsonb[])`, [forms]);
        if (Number(members) || Number(requests)) add(erased, 'share_rows', Number(members) + Number(requests));

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
        note: 'Chats, messages, the characters and their companion chats and messages, the memory-note index, the lorebooks and the Locker rows, and the 18+ confirmation are erased; v1 listings are anonymised and closed (or deleted when still drafts). The text of a memory note is in the person’s own OpenVibe memory and is exported and erased there.',
        log,
    });
}

// The sharing system's own tables carry a person (a member, an access request). Their subject column is jsonb,
// so the table map cannot express them: they are erased in extraErase, with the rest of the person's rows.
const EXEMPT = {
    share_members: 'the sharing system own member rows: the subject is a jsonb subject, so they are erased in extraErase',
    share_access_requests: 'the sharing system own access requests: the subject is a jsonb subject, so they are erased in extraErase',
};

module.exports = { create, TABLES, TOPICS, EXEMPT };
