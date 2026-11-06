'use strict';
/**
 * ADR-033: Exchange's part of an account export and of a deletion, applied through /internal/events with a stand-in
 * Network. The export carries the person's v1 listings (kept read-only) and their new chats, messages and 18+
 * confirmation. A deletion anonymises and closes a v1 listing, deletes a draft, and erases the person's installs,
 * trials, offers, chats, messages and confirmation; another person's rows stay. A redelivery changes nothing; a bad
 * signature and a proxied request are refused.
 */
const assert = require('assert');
const http = require('http');
const { ids } = require('openvibe-contracts');
const { boot, check, done } = require('./helpers/boot');
const { createNetworkSender, uncovered } = require('openvibe-sdk/account-data');
const { signDeliveryHeaders } = require('openvibe-sdk/events');
const { TABLES, EXEMPT } = require('../server/identity/account-data');
const { testDb } = require('./helpers/db');
const { createFakeAi } = require('./helpers/ai');

const A = ids.newId('user');
const B = ids.newId('user');
const EXP = `exp_${ids.ulid()}`;
const DEL = `del_${ids.ulid()}`;
const SECRET = `fixture_${'account'.repeat(6)}`;
const WRONG = `fixture_${'mismatch'.repeat(6)}`;

const exportEvent = { event_id: `evt_${ids.ulid()}`, event_type: 'network.account.export_requested', source: 'network', payload: { export_id: EXP, subject: A } };
const deleteEvent = { event_id: `evt_${ids.ulid()}`, event_type: 'network.account.deleted', source: 'network', payload: { deletion_id: DEL, subject: A, aliases: [] } };
const bodyOf = (ev) => JSON.stringify({ event: ev, seq: 1 });

const PASSPORT = '{"reads":[],"writes":[],"spends":[],"contacts":[]}';
const SEALED = Buffer.alloc(96, 7).toString('base64');
const MANIFEST = '{"name":"x","entry":"y"}';

async function startNetworkStub() {
    const calls = [];
    const server = http.createServer((req, res) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            const raw = Buffer.concat(chunks);
            const json = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
            if (req.url === '/oauth/token') return json(200, { access_token: 'tok_exchange', token_type: 'Bearer', expires_in: 300 });
            calls.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(raw.toString() || 'null') });
            return json(201, {});
        });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((r) => server.close(r)) };
}

async function seedListing(db, { owner, title, status = 'listed', kind = 'theme' }) {
    const id = `exl_${ids.ulid()}`;
    const slug = `t-${ids.ulid().slice(-10).toLowerCase()}`;
    await db.exec(`INSERT INTO exchange_listings (id, slug, title, mode, summary, license, version, creator, owner, kind, status, listed_at, manifest, passport)
        VALUES ($1, $2, $3, 'free', 'A summary.', 'CC0-1.0', '1.0.0', 'a maker', $4, $5, $6, $7::timestamptz, $8::jsonb, $9::jsonb)`,
    [id, slug, title, owner, kind, status, status === 'listed' ? new Date().toISOString() : null, MANIFEST, PASSPORT]);
    return { id, slug };
}

(async () => {
    await check('every table that names a person is covered or exempted with a reason', async () => {
        const d = await testDb();
        try {
            const missing = await uncovered(d.db, {
                tables: TABLES,
                exempt: {
                    account_data_events: 'the ledger of requests itself: which export and deletion exchange applied',
                    ...EXEMPT,
                },
            });
            assert.deepStrictEqual(missing, [], `a table with a person column is neither covered nor exempted: ${missing.join(', ')}`);
        } finally { await d.close(); }
    });

    const stub = await startNetworkStub();
    const sender = createNetworkSender({ networkInternalUrl: stub.url, clientId: 'exchange', clientSecret: 'exchange-secret' });
    const t = await boot({ env: { EXCHANGE_EVENTS_SECRET: SECRET }, accountSend: sender, ai: createFakeAi() });
    try {
        const db = t.ctx.s.db;
        const aListed = await seedListing(db, { owner: A, title: 'Alice\'s listed theme' });
        const aDraft = await seedListing(db, { owner: A, title: 'Alice\'s draft theme', status: 'draft' });
        const bListed = await seedListing(db, { owner: B, title: 'Bob\'s listed theme' });
        const trial = `exs_${ids.ulid()}`;
        await db.exec(`INSERT INTO exchange_sandbox_trials (id, listing_id, subject, version, status, passport, checks, expires_at)
            VALUES ($1, $2, $3, '1.0.0', 'passed', $4::jsonb, '[]'::jsonb, now() + interval '1 hour')`, [trial, bListed.id, A, PASSPORT]);
        const install = `exi_${ids.ulid()}`;
        await db.exec(`INSERT INTO exchange_installs (id, listing_id, subject, version, passport) VALUES ($1, $2, $3, '1.0.0', $4::jsonb)`, [install, bListed.id, A, PASSPORT]);
        const offer = `exo_${ids.ulid()}`;
        await db.exec(`INSERT INTO exchange_offers (id, listing_id, from_subject, from_name, kind, body) VALUES ($1, $2, $3, 'alice', 'claim', 'I would like Bob''s theme.')`, [offer, bListed.id, A]);

        // The companions: a person's characters and their chats are theirs too.
        const aCharacter = await t.ctx.characters.create({ owner: A, handle: 'alice', name: 'Alice’s companion', description: 'A keeper of clocks' });
        const bCharacter = await t.ctx.characters.create({ owner: B, handle: 'bob', name: 'Bob’s companion' });
        const aCompanion = await t.ctx.companionChats.create({ owner: A, characterId: aCharacter.id, title: 'A chat with a character' });
        await t.ctx.companionChats.append({ owner: A, chatId: aCompanion.id, role: 'user', content: 'Who are you?', turnId: 'ext_1' });
        await t.ctx.companionChats.append({ owner: A, chatId: aCompanion.id, role: 'assistant', content: 'A keeper of clocks.', turnId: 'ext_1', parentId: 'exm_1' });
        await db.exec(`INSERT INTO shares (service, kind, resource_id, owner_subject, audience) VALUES ('exchange', 'character', $1, $2::jsonb, 'private')`, [aCharacter.id, JSON.stringify({ type: 'user', id: A })]);
        await db.exec(`INSERT INTO share_members (service, kind, resource_id, subject, role, added_by, added_at)
            VALUES ('exchange', 'character', $1, $2::jsonb, 'viewer', $3::jsonb, now())`, [aCharacter.id, JSON.stringify({ type: 'user', id: A }), JSON.stringify({ type: 'user', id: A })]);
        const bCompanion = await t.ctx.companionChats.create({ owner: B, characterId: bCharacter.id, title: 'Bob’s chat' });
        await t.ctx.companionChats.append({ owner: B, chatId: bCompanion.id, role: 'user', content: 'Bob’s words', turnId: 'ext_2' });

        const sealedChat = await t.ctx.chats.createSealed({ owner: A, envelope: SEALED });
        // The memory-note index, a lorebook with an entry, and a Locker row: stages 3 and 4, exported and erased.
        const noteId = `exn_${ids.ulid()}`;
        const m2Id = `mem_${ids.ulid()}`;
        await db.exec(`INSERT INTO exchange_companion_notes (id, owner, character_id, m2_id, kind, pinned, sealed, origin)
            VALUES ($1, $2, $3, $4, 'fact', true, false, 'person')`, [noteId, A, aCharacter.id, m2Id]);
        const bookId = `exb_${ids.ulid()}`;
        await db.exec(`INSERT INTO exchange_lorebooks (id, owner, name, scope, character_id) VALUES ($1, $2, 'Clock lore', 'character', $3)`, [bookId, A, aCharacter.id]);
        const entryId = `exe_${ids.ulid()}`;
        await db.exec(`INSERT INTO exchange_lorebook_entries (id, lorebook_id, owner, name, keys, content, priority) VALUES ($1, $2, $3, 'The engine', '["engine"]', 'The engine computes numbers.', 3)`, [entryId, bookId, A]);
        await db.exec(`INSERT INTO exchange_companion_locks (owner, character_id, fingerprint) VALUES ($1, $2, 'word word word word')`, [A, aCharacter.id]);

        const chat = await t.ctx.chats.create({ owner: A, models: ['deepseek/deepseek-chat'], title: 'A question for the models' });
        await t.ctx.chats.append(A, chat.id, { role: 'user', content: 'What is a mutex?' });
        await t.ctx.chats.append(A, chat.id, { role: 'assistant', model: 'deepseek/deepseek-chat', content: 'A lock.', meta: { run_id: 'run_x' } });
        await t.ctx.adult.confirm(A, '1');

        await check('an export carries Alice\'s v1 rows, chats, messages and confirmation, and not Bob\'s', async () => {
            const body = bodyOf(exportEvent);
            const res = await t.get('/internal/events', { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...signDeliveryHeaders(body, SECRET) } });
            assert.strictEqual(res.status, 200, res.text);
            assert.strictEqual(res.json().outcome, 'exported');
            const part = stub.calls.find((c) => c.url === `/internal/account-exports/${EXP}/parts`);
            assert.ok(part, 'the part was pushed to Network');
            assert.strictEqual(part.auth, 'Bearer tok_exchange');
            assert.strictEqual(part.body.subject, A);
            assert.deepStrictEqual(part.body.files.map((f) => f.name).sort(),
                ['adult-confirmation.json', 'characters.json', 'chat-messages.json', 'chat-seals.json', 'chats.json', 'companion-chats.json', 'companion-locks.json', 'companion-messages.json', 'companion-notes.json', 'installs.json', 'listings.json', 'lorebook-entries.json', 'lorebooks.json', 'offers.json', 'sandbox-trials.json']);
            const all = JSON.stringify(part.body);
            assert.ok(all.includes('Alice\'s listed theme'));
            assert.ok(all.includes('Alice\'s draft theme'));
            assert.ok(!all.includes('Bob\'s listed theme'), 'nobody else\'s row');
            assert.ok(all.includes('A question for the models') && all.includes('What is a mutex?') && all.includes('A lock.'), 'the chat and its messages');
            assert.ok(all.includes(SEALED), 'a sealed chat’s envelope is exported as it is stored');
            assert.strictEqual(part.body.files.find((f) => f.name === 'installs.json').content[0].id, install);
            assert.strictEqual(part.body.files.find((f) => f.name === 'sandbox-trials.json').content[0].id, trial);
            assert.match(all, /I would like Bob/);
            assert.ok(all.includes('A keeper of clocks'), 'the character and the companion chat are exported');
            assert.ok(all.includes(noteId) && all.includes(m2Id), 'the note index is exported (its text is in the person’s own memory)');
            assert.ok(all.includes('Clock lore') && all.includes('The engine computes numbers.'), 'the lorebook and its entry are exported');
            assert.ok(all.includes('word word word word'), 'the Locker row is exported');
            assert.ok(!all.includes('Bob’s words'), 'nobody else’s companion chat');
        });

        await check('a deletion closes the listed listing, deletes the draft, and erases Alice\'s rows; Bob stays', async () => {
            const body = bodyOf(deleteEvent);
            const res = await t.get('/internal/events', { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...signDeliveryHeaders(body, SECRET) } });
            assert.strictEqual(res.status, 200, res.text);
            assert.strictEqual(res.json().outcome, 'erased');
            const listed = await db.maybe('SELECT owner, status, closed_reason, title, summary, creator FROM exchange_listings WHERE id = $1', [aListed.id]);
            assert.strictEqual(listed.owner, null);
            assert.strictEqual(listed.status, 'closed');
            assert.strictEqual(listed.closed_reason, 'withdrawn');
            assert.strictEqual(listed.title, 'A deleted listing');
            assert.strictEqual(listed.summary, "Removed with its maker's account.");
            assert.strictEqual(listed.creator, 'a deleted maker');
            assert.strictEqual(Number(await db.value('SELECT COUNT(*)::int AS n FROM exchange_listings WHERE id = $1', [aDraft.id])), 0);
            const bobRow = await db.maybe('SELECT owner, status FROM exchange_listings WHERE id = $1', [bListed.id]);
            assert.strictEqual(bobRow.owner, B);
            assert.strictEqual(bobRow.status, 'listed');
            assert.strictEqual(Number(await db.value('SELECT COUNT(*)::int AS n FROM exchange_installs WHERE id = $1', [install])), 0);
            assert.strictEqual(Number(await db.value('SELECT COUNT(*)::int AS n FROM exchange_sandbox_trials WHERE id = $1', [trial])), 0);
            assert.strictEqual(Number(await db.value('SELECT COUNT(*)::int AS n FROM exchange_offers WHERE id = $1', [offer])), 0);
            assert.strictEqual(Number(await db.value('SELECT COUNT(*)::int AS n FROM exchange_chats WHERE owner = $1', [A])), 0, 'the chat is erased');
            assert.strictEqual(Number(await db.value('SELECT COUNT(*)::int AS n FROM exchange_chat_messages WHERE owner = $1', [A])), 0, 'its messages are erased');
            assert.strictEqual(Number(await db.value('SELECT COUNT(*)::int AS n FROM exchange_chat_seals WHERE owner = $1', [A])), 0, 'the sealed envelope is erased with the chat');
            assert.strictEqual(Number(await db.value('SELECT COUNT(*)::int AS n FROM exchange_chats WHERE id = $1', [sealedChat.id])), 0);
            assert.strictEqual(Number(await db.value('SELECT COUNT(*)::int AS n FROM exchange_adult_confirmations WHERE subject = $1', [A])), 0, 'the confirmation is erased');
            assert.strictEqual(Number(await db.value('SELECT COUNT(*)::int AS n FROM exchange_characters WHERE owner = $1', [A])), 0, 'the character is erased');
            assert.strictEqual(Number(await db.value('SELECT COUNT(*)::int AS n FROM exchange_companion_chats WHERE owner = $1', [A])), 0, 'the companion chat is erased');
            assert.strictEqual(Number(await db.value('SELECT COUNT(*)::int AS n FROM exchange_companion_messages WHERE owner = $1', [A])), 0, 'its companion messages are erased');
            assert.strictEqual(Number(await db.value('SELECT COUNT(*)::int AS n FROM exchange_companion_notes WHERE owner = $1', [A])), 0, 'the note index is erased');
            assert.strictEqual(Number(await db.value('SELECT COUNT(*)::int AS n FROM exchange_lorebooks WHERE owner = $1', [A])), 0, 'the lorebooks are erased');
            assert.strictEqual(Number(await db.value('SELECT COUNT(*)::int AS n FROM exchange_lorebook_entries WHERE owner = $1', [A])), 0, 'their entries are erased');
            assert.strictEqual(Number(await db.value('SELECT COUNT(*)::int AS n FROM exchange_companion_locks WHERE owner = $1', [A])), 0, 'the Locker rows are erased');
            assert.strictEqual(Number(await db.value('SELECT COUNT(*)::int AS n FROM exchange_characters WHERE owner = $1', [B])), 1, 'Bob keeps his character');
            assert.strictEqual(Number(await db.value('SELECT COUNT(*)::int AS n FROM exchange_companion_chats WHERE owner = $1', [B])), 1, 'Bob keeps his chat');
            assert.strictEqual(Number(await db.value('SELECT COUNT(*)::int AS n FROM share_members WHERE subject = $1::jsonb', [JSON.stringify({ type: 'user', id: A })])), 0, 'the sharing rows go with the account');
            const confirmation = stub.calls.find((c) => c.url === `/internal/account-deletions/${DEL}/confirmations`);
            assert.ok(confirmation, 'the confirmation was sent');
            assert.ok(confirmation.body.erased.exchange_listings_drafts >= 1);
            assert.ok(confirmation.body.retained.exchange_listings_closed >= 1);
            assert.ok(!Number.isNaN(Date.parse(confirmation.body.completed_at)));
        });

        await check('a redelivery changes nothing', async () => {
            const body = bodyOf(deleteEvent);
            const res = await t.get('/internal/events', { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...signDeliveryHeaders(body, SECRET) } });
            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.json().outcome, 'unchanged');
        });

        await check('the internal route refuses a bad signature (401) and a forwarded request (403)', async () => {
            const body = bodyOf(exportEvent);
            const bad = await t.get('/internal/events', { method: 'POST', body, headers: { 'Content-Type': 'application/json', ...signDeliveryHeaders(body, WRONG) } });
            assert.strictEqual(bad.status, 401);
            const forwarded = await t.get('/internal/events', { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.9', ...signDeliveryHeaders(body, SECRET) } });
            assert.strictEqual(forwarded.status, 403);
        });
    } finally {
        await t.close();
        await stub.close();
    }
    done();
})();
