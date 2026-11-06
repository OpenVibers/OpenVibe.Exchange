'use strict';
/**
 * Companions, stages 3 and 4 (Opus design, 2026-11-06): memory notes in the person's OpenVibe memory (M2), the
 * Memory panel, the lorebooks that join a turn, the Locker that seals notes and history, and the account export.
 *
 * The rules checked here:
 *   - a note is short, one of the three kinds, and the hard floor refuses one that breaks it;
 *   - the notes that join a turn are pinned first, within a token budget, and the "what the model saw" panel
 *     lists them;
 *   - the cheap economy model takes notes every few turns, under the free-use ceiling;
 *   - a lorebook entry joins when its key is in the recent turns, the highest priority first, within a budget;
 *   - World Info imports and exports again as the same file;
 *   - a sealed note and a sealed message are envelopes at rest, and a locked chat needs the browser's decrypted
 *     history to answer; it refuses to turn the Locker off while anything is sealed;
 *   - the memory index and the lorebooks are exported and erased with the account.
 */
const assert = require('assert');
const { ids } = require('openvibe-contracts');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');
const locker = require('openvibe-sdk/locker');

/**
 * The M2 memory store, in memory: the routes the memory client calls, the scope grammar, the dedupe and the
 * merge pointer. Every item is returned whole, as the real store returns its item view.
 */
function createFakeMemory() {
    const items = new Map();
    const calls = [];
    let n = 0;
    const view = (it) => ({
        id: it.id, owner: 'usr', scope: it.scope, kind: it.kind, text: it.text, source: it.source,
        sources: [it.source], source_ref: it.source_ref || null, status: it.status || 'active',
        confidence: 1, seen_at: it.updated_at, created_at: it.created_at, updated_at: it.updated_at,
        machine: null, merged_into: it.merged_into || null, conflict_with: it.conflict_with || null,
    });
    const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), json: async () => body });
    async function fetchImpl(url, options = {}) {
        const u = new URL(String(url));
        const method = String(options.method || 'GET').toUpperCase();
        const body = options.body ? JSON.parse(String(options.body)) : null;
        calls.push({ method, path: u.pathname, query: u.search, body, auth: options.headers && options.headers.Authorization });
        if (u.pathname === '/api/v1/memory/items' && method === 'GET') {
            const scope = u.searchParams.get('scope');
            const list = [...items.values()].filter((it) => !scope || it.scope === scope).map(view);
            return reply(200, { items: list, count: list.length });
        }
        if (u.pathname === '/api/v1/memory/items:batch' && method === 'POST') {
            const out = [];
            let created = 0;
            let deduped = 0;
            for (const raw of body.items || []) {
                const prev = [...items.values()].find((it) => it.scope === raw.scope && it.text === raw.text);
                if (prev) { prev.updated_at = new Date().toISOString(); out.push(view(prev)); deduped++; continue; }
                const at = new Date().toISOString();
                const item = {
                    id: `mem_${ids.ulid()}`, scope: raw.scope, kind: raw.kind, text: raw.text, source: raw.source,
                    source_ref: raw.source_ref || null, status: raw.status || 'active',
                    created_at: at, updated_at: at,
                };
                items.set(item.id, item); out.push(view(item)); created++; n++;
            }
            return reply(200, { items: out, count: created + deduped, created, deduped });
        }
        const one = /^\/api\/v1\/memory\/items\/([^/]+)$/.exec(u.pathname);
        if (one && method === 'PATCH') {
            const item = items.get(decodeURIComponent(one[1]));
            if (!item) return reply(404, { detail: 'no such memory item' });
            if (body && body.text != null) item.text = body.text;
            item.updated_at = new Date().toISOString();
            return reply(200, { item: view(item) });
        }
        if (one && method === 'DELETE') {
            items.delete(decodeURIComponent(one[1]));
            return reply(200, { deleted: 1 });
        }
        return reply(404, { detail: 'not found' });
    }
    return { fetchImpl, items, calls };
}

const AI_ANSWER = 'The clocks are safe with me.';
function fakeAi() {
    return createFakeAi({
        chat(args) {
            if (args.model === 'openvibe/economy') {
                return { content: '[{"kind":"fact","text":"The person is called Ada and likes clocks."}]', model: 'openvibe/economy', provider: 'local', run_id: 'run_NOTE', cost_usd: 0.000001, tokens_in: 40, tokens_out: 18, latency_ms: 12, why: ['the cheapest model'] };
            }
            return { content: AI_ANSWER, model: args.model, provider: 'deepseek', run_id: 'run_TEST', cost_usd: 0.00012, tokens_in: 10, tokens_out: 20, latency_ms: 420, why: ['cheapest healthy offer within your ceiling'] };
        },
    });
}

const FORM = {
    name: 'Ada Lovelace', description: 'The first programmer, in her London study.',
    personality: 'precise and warm', first_message: 'Good evening. What shall we compute?',
};

(async () => {
    const memory = createFakeMemory();
    const ai = fakeAi();
    const t = await boot({
        ai, aiFetchImpl: memory.fetchImpl,
        env: { EXCHANGE_COMPANIONS_NOTES_EVERY_TURNS: '100', EXCHANGE_COMPANIONS_MEMORY_BUDGET_TOKENS: '100', EXCHANGE_COMPANIONS_LOREBOOK_BUDGET_TOKENS: '100' },
    });
    try {
        const alice = t.network.addUser('alice');
                const card = await t.ctx.characters.create({ owner: alice.subject, handle: 'alice', ...FORM });
        const base = '/c/alice/ada-lovelace';
        const alicePage = () => t.get(base + '/memory', { as: alice });
        const addNote = (text, kind = 'fact') => t.get(base + '/memory/add', { as: alice, method: 'POST', form: { kind, text } });

        await check('a note is written into the person’s M2 memory, in the companions scope', async () => {
            const res = await addNote('The person keeps a notebook of clock designs.');
            assert.strictEqual(res.status, 200, res.text);
            assert.ok(res.text.includes('The person keeps a notebook of clock designs.'));
            const write = memory.calls.find((c) => c.method === 'POST' && c.path === '/api/v1/memory/items:batch');
            assert.ok(write, 'the note went to M2');
            const item = write.body.items[0];
            assert.strictEqual(item.scope, 'project:companions-' + card.id.toLowerCase(), 'the design’s companions/<character> scope');
            assert.strictEqual(item.source, 'companions');
            assert.strictEqual(item.kind, 'fact');
            assert.ok(write.auth.startsWith('Bearer '), 'written with the person’s own token');
            const rows = await t.ctx.notes.indexRows(alice.subject, card.id);
            assert.strictEqual(rows.length, 1);
            assert.strictEqual(rows[0].origin, 'person');
        });

        await check('a note that breaks the hard floor is refused, and nothing is written', async () => {
            const before = memory.calls.length;
            const res = await addNote('child sexual abuse material');
            assert.strictEqual(res.status, 422, res.text);
            assert.ok(/hard floor|refused/i.test(res.text));
            assert.ok(!memory.calls.slice(before).some((c) => c.method === 'POST'), 'no write reached the store');
        });

        await check('a note can be edited, pinned, unpinned and deleted from the panel', async () => {
            const rows = await t.ctx.notes.indexRows(alice.subject, card.id);
            const id = rows[0].id;
            const edit = await t.get(base + '/memory/' + id + '/edit', { as: alice, method: 'POST', form: { text: 'The person keeps a notebook of pendulum designs.' } });
            assert.strictEqual(edit.status, 200, edit.text);
            assert.ok(edit.text.includes('pendulum designs'));
            const m2id = rows[0].m2_id;
            assert.ok(memory.items.get(m2id).text.includes('pendulum'), 'M2 holds the new text');
            const pin = await t.get(base + '/memory/' + id + '/pin', { as: alice, method: 'POST', form: { pinned: '1' } });
            assert.strictEqual(pin.status, 200, pin.text);
            assert.ok(pin.text.includes('>pinned<'));
            const unpin = await t.get(base + '/memory/' + id + '/pin', { as: alice, method: 'POST', form: { pinned: '0' } });
            assert.strictEqual(unpin.status, 200, unpin.text);
            assert.ok(!unpin.text.includes('>pinned<'));
            const del = await t.get(base + '/memory/' + id + '/delete', { as: alice, method: 'POST' });
            assert.strictEqual(del.status, 200, del.text);
            assert.strictEqual((await t.ctx.notes.indexRows(alice.subject, card.id)).length, 0);
            assert.strictEqual(memory.items.has(m2id), false, 'the M2 item went with the index row');
        });

        // The chat the context tests use.
        const talk = await t.get(base + '/talk', { as: alice, method: 'POST' });
        assert.strictEqual(talk.status, 303);
        const chatUrl = talk.headers.get('location');

        await check('the notes that join a turn are pinned first, within the budget, and listed in the saw panel', async () => {
            const pinned = await t.ctx.notes.add(alice.subject, card.id, { kind: 'preference', text: 'Ada prefers short answers.', pinned: true }, alice.subject);
            await t.ctx.notes.add(alice.subject, card.id, { kind: 'fact', text: 'Ada keeps a notebook of pendulum designs.', pinned: false }, alice.subject);
            await t.ctx.notes.add(alice.subject, card.id, { kind: 'event', text: 'A long note that is over the whole budget: ' + 'x'.repeat(320), pinned: false }, alice.subject);
            ai.calls.length = 0;
            const sent = await t.get(chatUrl + '/send', { as: alice, method: 'POST', form: { text: 'What do you remember about me?' } });
            assert.strictEqual(sent.status, 303, sent.text);
            const call = ai.calls[0];
            const system = call.messages[0].content;
            assert.ok(system.includes('Ada prefers short answers.'), 'the pinned note joined');
            assert.ok(system.includes('pendulum designs'), 'the newest note joined');
            assert.ok(!system.includes('over the whole budget'), 'the note over the budget did not join');
            assert.ok(call.max_cost_usd <= t.config.companions.maxCostUsd, 'under the free-use ceiling');
            const page = await t.get(chatUrl, { as: alice });
            assert.ok(page.text.includes('Your notes'), 'the panel has a notes section');
            assert.ok(page.text.includes('Ada prefers short answers.'));
            assert.ok(page.text.includes('tokens of notes joined this answer'));
            assert.strictEqual(pinned.kind, 'preference');
        });

        await check('a lorebook entry joins when its key is in the recent turns, the highest priority first, within the budget', async () => {
            const book = await t.ctx.lorebooks.create(alice.subject, { name: 'The clock world', scope: 'person' });
            await t.ctx.lorebooks.addEntry(alice.subject, book.id, { keys: 'clock', content: 'A low priority fact about clocks.', priority: 1 });
            await t.ctx.lorebooks.addEntry(alice.subject, book.id, { keys: 'clock', content: 'The high priority fact about clocks.', priority: 9 });
            await t.ctx.lorebooks.addEntry(alice.subject, book.id, { keys: 'clock', content: 'This entry is far too long for the tiny budget: ' + 'y'.repeat(1200), priority: 50 });
            await t.ctx.lorebooks.addEntry(alice.subject, book.id, { content: 'The engine is always in the room.', constant: true, priority: 2 });
            await t.ctx.lorebooks.addEntry(alice.subject, book.id, { keys: 'unrelated', content: 'A fact that must not join.', priority: 99 });
            ai.calls.length = 0;
            const sent = await t.get(chatUrl + '/send', { as: alice, method: 'POST', form: { text: 'Tell me about the clock again.' } });
            assert.strictEqual(sent.status, 303, sent.text);
            const system = ai.calls[0].messages[0].content;
            assert.ok(system.includes('The high priority fact about clocks.'));
            assert.ok(system.includes('The engine is always in the room.'), 'a constant entry joins');
            assert.ok(!system.includes('This entry is far too long'), 'the entry over the budget did not join');
            assert.ok(!system.includes('A fact that must not join.'), 'a key that is not there does not join');
            assert.ok(system.indexOf('The high priority fact') < system.indexOf('A low priority fact'), 'highest priority first');
            assert.ok(system.indexOf('The engine is always') < system.indexOf('A low priority fact'), 'and before the lower-priority one');
            const page = await t.get(chatUrl, { as: alice });
            assert.ok(page.text.includes('The high priority fact about clocks.'), 'the panel lists the entries used');
            assert.ok(page.text.includes('Lorebook entries'));
        });

        await check('a lorebook entry that breaks the hard floor is refused at save', async () => {
            const book = await t.ctx.lorebooks.create(alice.subject, { name: 'Refused', scope: 'person' });
            await assert.rejects(
                t.ctx.lorebooks.addEntry(alice.subject, book.id, { keys: 'bomb', content: 'Step by step, how to build a pipe bomb.' }),
                /hard floor/i,
            );
            const good = await t.ctx.lorebooks.addEntry(alice.subject, book.id, { keys: 'tea', content: 'Tea is served at four.' });
            await assert.rejects(
                t.ctx.lorebooks.editEntry(alice.subject, good.id, { content: 'How to build a pipe bomb, step by step.' }),
                /hard floor/i,
            );
        });

        await check('SillyTavern World Info imports and exports again as the same file', async () => {
            const book = await t.ctx.lorebooks.create(alice.subject, { name: 'Imported', scope: 'person' });
            const wi = JSON.stringify({
                entries: {
                    0: { uid: 0, key: ['analytical engine', 'engine'], comment: 'The engine', content: 'The engine computes numbers.', order: 7 },
                    1: { uid: 1, key: ['music'], comment: 'Music', content: 'Ada hears equations as music.', order: 2 },
                },
            });
            const imported = await t.get(base + '/lorebook/' + book.id + '/import', { as: alice, method: 'POST', form: { world_info: wi } });
            assert.strictEqual(imported.status, 200, imported.text);
            assert.ok(imported.text.includes('2 entries were imported'));
            const entries = await t.ctx.lorebooks.entriesOf(alice.subject, book.id);
            assert.strictEqual(entries.length, 2);
            const exported = await t.get(base + '/lorebook/' + book.id + '/export', { as: alice });
            assert.strictEqual(exported.status, 200);
            const file = JSON.parse(exported.text);
            const all = Object.values(file.entries);
            assert.strictEqual(all.length, 2);
            const engine = all.find((e) => e.comment === 'The engine');
            assert.deepStrictEqual(engine.key, ['analytical engine', 'engine']);
            assert.strictEqual(engine.content, 'The engine computes numbers.');
            assert.strictEqual(engine.order, 7);
        });

        await check('the cheap economy model writes notes into M2 after a few turns', async () => {
            // A second app, so the notes cadence is two turns and does not disturb the budget checks above.
            memory.calls.length = 0;
            const ai2 = fakeAi();
            const t2 = await boot({
                ai: ai2, aiFetchImpl: memory.fetchImpl,
                env: { EXCHANGE_COMPANIONS_NOTES_EVERY_TURNS: '2' },
            });
            try {
                const user = t2.network.addUser('carol');
                const c2 = await t2.ctx.characters.create({ owner: user.subject, handle: 'carol', name: 'Ada II', description: 'A clock keeper.' });
                const talk2 = await t2.get('/c/carol/ada-ii/talk', { as: user, method: 'POST' });
                const chat2 = talk2.headers.get('location');
                await t2.get(chat2 + '/send', { as: user, method: 'POST', form: { text: 'I am Carol, I like clocks.' } });
                assert.strictEqual((await t2.ctx.notes.indexRows(user.subject, c2.id)).length, 0, 'not on the first turn');
                ai2.calls.length = 0;
                const second = await t2.get(chat2 + '/send', { as: user, method: 'POST', form: { text: 'Remember me.' } });
                assert.strictEqual(second.status, 303, second.text);
                const noteCall = ai2.calls.find((c) => c.model === 'openvibe/economy');
                assert.ok(noteCall, 'the economy model took the notes');
                assert.ok(noteCall.max_cost_usd <= t2.config.companions.maxCostUsd, 'under the free-use ceiling');
                const rows = await t2.ctx.notes.indexRows(user.subject, c2.id);
                assert.strictEqual(rows.length, 1);
                assert.strictEqual(rows[0].origin, 'model');
                assert.strictEqual(rows[0].kind, 'fact');
                assert.ok(memory.items.get(rows[0].m2_id).text.includes('Ada and likes clocks'), 'the note is in M2, in the companions scope');
            } finally { await t2.close(); }
        });

        await check('turning the Locker on needs a Locker: a person without keys is told so', async () => {
            const res = await t.get(base + '/lock', { as: alice, method: 'POST', form: { on: '1' } });
            assert.strictEqual(res.status, 409, res.text);
            assert.ok(/no Locker keys/i.test(res.text));
        });

        await check('with Locker on, notes and history are sealed at rest, and the page carries only envelopes', async () => {
            const person = await t.network.giveLocker(alice);
            const plainNote = 'A note written before the Locker.';
            await t.ctx.notes.add(alice.subject, card.id, { kind: 'fact', text: plainNote }, alice.subject);
            const on = await t.get(base + '/lock', { as: alice, method: 'POST', form: { on: '1' } });
            assert.strictEqual(on.status, 200, on.text);
            assert.ok(/Locker is on/i.test(on.text));
            const rows = await t.ctx.notes.indexRows(alice.subject, card.id);
            const sealedRow = rows.find((r) => r.sealed === true);
            assert.ok(sealedRow, 'the note row says sealed');
            assert.strictEqual(memory.items.get(sealedRow.m2_id).text.includes(plainNote), false, 'M2 holds an envelope, not the words');
            const opened = await locker.open(new Uint8Array(Buffer.from(memory.items.get(sealedRow.m2_id).text, 'base64')), { person });
            assert.strictEqual(Buffer.from(opened).toString('utf8'), plainNote, 'the person’s key opens it');
            const editSealed = await t.get(base + '/memory/' + sealedRow.id + '/edit', { as: alice, method: 'POST', form: { text: 'A plaintext change.' } });
            assert.strictEqual(editSealed.status, 409, editSealed.text);
            assert.ok(/sealed/i.test(editSealed.text));
            const chat = await t.ctx.companionChats.get(alice.subject, chatUrl.split('/').pop());
            assert.strictEqual(chat.locked, true);
            const messages = await t.ctx.companionChats.messages(chat.id);
            assert.ok(messages.length >= 2);
            for (const m of messages.filter((x) => x.content)) {
                assert.strictEqual(m.meta.sealed, true);
                assert.ok(!m.content.includes('What do you remember'), 'the words are not in the clear at rest');
            }
            const page = await t.get(chatUrl, { as: alice });
            assert.strictEqual(page.status, 200);
            assert.ok(page.text.includes('data-locker-sealed'), 'the browser gets the envelopes');
            assert.ok(!page.text.includes('What do you remember about me?'), 'and not the words');
            assert.ok(!page.text.includes('The clocks are safe with me.'), 'no plaintext answer either');
            const memPage = await alicePage();
            assert.ok(memPage.text.includes('data-locker-sealed'));
            // A note added while the Locker is on is sealed on the way into M2, and so is one the cheap model writes.
            const afterLock = await addNote('A note written after the Locker.');
            assert.strictEqual(afterLock.status, 200, afterLock.text);
            const afterRow = (await t.ctx.notes.indexRows(alice.subject, card.id)).find((r) => r.sealed && memory.items.get(r.m2_id).text !== plainNote && r.id !== sealedRow.id && r.origin === 'person');
            assert.ok(afterRow, 'the new note row is sealed');
            assert.strictEqual(memory.items.get(afterRow.m2_id).text.includes('A note written after the Locker.'), false);
            const taken = await t.ctx.noteTaker.take({
                owner: alice.subject, characterId: card.id, token: 't', turns: [{ user: { content: 'I am Ada, I like clocks.' } }],
                protect: (text) => t.ctx.locker.seal(text, { subject: alice.subject, ecdh: person.ecdhPublic, fingerprint: person.fingerprint }),
            });
            assert.strictEqual(taken.notes.length, 1, 'the cheap model wrote a note');
            assert.strictEqual(taken.notes[0].sealed, true);
            const modelRow = (await t.ctx.notes.indexRows(alice.subject, card.id)).find((r) => r.id === taken.notes[0].id);
            assert.ok(modelRow.sealed, 'the model’s note is sealed too');
        });

        await check('a locked chat refuses a turn without the browser’s opened history', async () => {
            const res = await t.get(chatUrl + '/send', { as: alice, method: 'POST', form: { text: 'Are you there?' } });
            assert.strictEqual(res.status, 422, res.text);
            assert.ok(/sealed with your Locker/i.test(res.text));
            const regenerated = await t.get(chatUrl + '/regenerate', { as: alice, method: 'POST', form: { message: (await t.ctx.companionChats.messages(chatUrl.split('/').pop())).find((m) => m.role === 'user').id } });
            assert.strictEqual(regenerated.status, 422, regenerated.text);
        });

        await check('with the opened history, a locked chat answers and seals the new turn', async () => {
            const history = [
                { role: 'user', content: 'What do you remember about me?' },
                { role: 'assistant', content: AI_ANSWER },
            ];
            ai.calls.length = 0;
            const res = await t.get(chatUrl + '/send', {
                as: alice, method: 'POST',
                form: { text: 'One more clock, please.', locker_context: JSON.stringify({ history, messages: {}, notes: [] }) },
            });
            assert.strictEqual(res.status, 303, res.text);
            const call = ai.calls[0];
            assert.strictEqual(call.messages[call.messages.length - 1].content, 'One more clock, please.');
            assert.ok(call.messages.some((m) => m.content === 'What do you remember about me?'), 'the browser’s opened history reached the model for this turn');
            const messages = await t.ctx.companionChats.messages(chatUrl.split('/').pop());
            const last = messages.filter((m) => m.role === 'user').pop();
            assert.strictEqual(last.meta.sealed, true);
            assert.ok(!last.content.includes('One more clock'), 'the new message is sealed before it is stored');
            const lastAnswer = messages.filter((m) => m.role === 'assistant').pop();
            assert.strictEqual(lastAnswer.meta.sealed, true);
            assert.ok(!lastAnswer.content.includes(AI_ANSWER));
            const page = await t.get(chatUrl, { as: alice });
            assert.ok(!page.text.includes('One more clock, please.'), 'the page holds only the envelope');
        });

        await check('the Locker cannot be turned off while a note or a message is sealed', async () => {
            const off = await t.get(base + '/lock', { as: alice, method: 'POST', form: { on: '0' } });
            assert.strictEqual(off.status, 409, off.text);
            assert.ok(/stays locked/i.test(off.text));
        });
    } finally {
        await t.close();
    }
    done();
})();
