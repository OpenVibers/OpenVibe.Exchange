'use strict';
/**
 * Steps 5 and 6 of Opus's design (2026-11-06): group chats, the voice, and the images.
 *
 *   - a group chat keeps each character's own memory and its own voice;
 *   - an answer is read aloud once, in the right voice, and the rate limit is the person's own;
 *   - the image switch is off, and it refuses with a clear reason (no provider is ever called).
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');
const { createFakeActor } = require('./helpers/actor');

(async () => {
    const ai = createFakeAi();
    const actor = createFakeActor();
    const ttsCalls = [];
    const otherCalls = [];
    let ttsStatus = 200;

    // The M2 memory stand-in: the notes of every character, in that character's own scope.
    const memItems = new Map();
    const memoryFetch = async (url, opts = {}) => {
        const u = new URL(String(url));
        const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body });
        if (u.pathname === '/api/v1/memory/items' && (opts.method || 'GET') === 'GET') {
            const scope = u.searchParams.get('scope');
            return ok({ items: [...memItems.values()].filter((i) => i.scope === scope) });
        }
        if (u.pathname === '/api/v1/memory/items:batch') {
            const body = JSON.parse(opts.body || '{}');
            const written = [];
            for (const it of (body.items || [])) {
                const id = 'mem_' + (memItems.size + 1);
                const item = Object.assign({}, it, { id, status: 'active' });
                memItems.set(id, item);
                written.push(item);
            }
            return ok({ items: written });
        }
        return ok({ items: [] });
    };

    // OpenVibe.Chat, the voice: the sound of an answer in the character's own voice.
    const fetchImpl = async (url, opts = {}) => {
        const u = String(url);
        if (u.includes('/api/tts/speak')) {
            const body = JSON.parse(opts.body || '{}');
            ttsCalls.push({ url: u, body, auth: String((opts.headers && opts.headers.Authorization) || '') });
            const answer = (code) => ({ ok: false, status: code, text: async () => JSON.stringify({ error: 'Too many lines spoken right now', code: 'voice_rate_limited' }), json: async () => ({ error: 'Too many lines spoken right now', code: 'voice_rate_limited' }) });
            if (ttsStatus === 429) return answer(429);
            const good = { audio: 'QUFB', mime_type: 'audio/mpeg', rate: 48000, voice_id: body.voice || 'default' };
            return { ok: true, status: 200, text: async () => JSON.stringify(good), json: async () => good };
        }
        otherCalls.push(u);
        return await globalThis.fetch(url, opts);
    };

    const t = await boot({ ai, actor, aiFetchImpl: memoryFetch, fetchImpl });
    const alice = t.network.addUser('alice');
    const bob = t.network.addUser('bob');

    try {
        let ada = null;
        let brenda = null;
        let groupId = null;

        await check('two cards, each with its own voice', async () => {
            await t.get('/companions/new', { as: alice, form: { name: 'Ada', description: 'A keeper of clocks', personality: 'precise, warm', scenario: 'a workshop', rating: 'everyone', voice: 'gary' } });
            await t.get('/companions/new', { as: alice, form: { name: 'Brenda', description: 'A boatbuilder', personality: 'blunt', scenario: 'a yard', rating: 'everyone', voice: 'brenda' } });
            const mine = await t.ctx.characters.listByOwner(alice.subject);
            ada = mine.find((c) => c.name === 'Ada');
            brenda = mine.find((c) => c.name === 'Brenda');
            assert.ok(ada && brenda, 'both cards are made');
            assert.strictEqual(ada.voice, 'gary');
            assert.strictEqual(brenda.voice, 'brenda');
        });

        await check('a group chat needs two of the person\'s own characters', async () => {
            const one = await t.get('/groups/new', { as: alice, form: { members: ada.id } });
            assert.strictEqual(one.status, 422);
            assert.ok(one.text.includes('at least two'), one.text.slice(0, 300));
        });

        await check('each character keeps its own memory: the notes are in its own scope', async () => {
            const token = t.network.userToken(alice);
            await t.ctx.notes.add(alice.subject, ada.id, { kind: 'fact', text: 'Ada knows the person keeps clocks' }, token);
            await t.ctx.notes.add(alice.subject, brenda.id, { kind: 'fact', text: 'Brenda knows the person likes sailing' }, token);
            const adaNotes = await t.ctx.notes.list(alice.subject, ada.id, token);
            assert.strictEqual(adaNotes.length, 1);
            assert.ok(adaNotes[0].text.includes('keeps clocks'));
        });

        await check('a group chat is made, and it is not another person\'s', async () => {
            const body = 'title=The+morning+crew&mode=round_robin&turns=1'
                + '&members=' + encodeURIComponent(ada.id) + '&members=' + encodeURIComponent(brenda.id);
            const made = await t.get('/groups/new', { as: alice, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
            assert.strictEqual(made.status, 303, made.text.slice(0, 300));
            groupId = String(made.headers.get('location')).split('/').pop();
            const page = await t.get('/talk/group/' + groupId, { as: alice });
            assert.strictEqual(page.status, 200, page.text.slice(0, 300));
            assert.ok(page.text.includes('The morning crew'));
            const other = await t.get('/talk/group/' + groupId, { as: bob });
            assert.strictEqual(other.status, 404, 'another account finds no such group chat');
        });

        await check('the characters take their turns, each in its own voice and its own memory', async () => {
            actor.turns.length = 0;
            ttsCalls.length = 0;
            const sent = await t.get('/talk/group/' + groupId + '/send', { as: alice, form: { text: 'Good morning, everyone' } });
            assert.strictEqual(sent.status, 303, sent.text.slice(0, 300));
            const messages = await t.ctx.groups.messages(groupId);
            const answers = messages.filter((m) => m.role === 'assistant');
            assert.strictEqual(answers.length, 2, 'both characters answered, once each');
            const adaAnswer = answers.find((m) => m.character_id === ada.id);
            const brendaAnswer = answers.find((m) => m.character_id === brenda.id);
            assert.ok(adaAnswer && brendaAnswer);
            assert.strictEqual(adaAnswer.meta.voice, 'gary', 'Ada answers in her own voice');
            assert.strictEqual(brendaAnswer.meta.voice, 'brenda', 'Brenda answers in her own voice');
            // The notes that joined each answer are that character's own, and nobody else's.
            assert.ok(adaAnswer.meta.notes.some((n) => n.text.includes('keeps clocks')), 'Ada answers with her own note');
            assert.ok(!adaAnswer.meta.notes.some((n) => n.text.includes('sailing')), 'Brenda\'s note never joins Ada\'s answer');
            assert.ok(brendaAnswer.meta.notes.some((n) => n.text.includes('sailing')), 'Brenda answers with her own note');
            assert.ok(!brendaAnswer.meta.notes.some((n) => n.text.includes('keeps clocks')), 'Ada\'s note never joins Brenda\'s answer');
            // And the same, in the turn text that was sent.
            const adaCall = actor.turns.find((c) => String(c.task).includes('You are Ada.'));
            const brendaCall = actor.turns.find((c) => String(c.task).includes('You are Brenda.'));
            assert.ok(adaCall && brendaCall);
            assert.ok(String(adaCall.task).includes('keeps clocks'));
            assert.ok(!String(adaCall.task).includes('sailing'));
            assert.ok(String(brendaCall.task).includes('sailing'));
            assert.ok(!String(brendaCall.task).includes('keeps clocks'));
        });

        await check('the group page shows every character and every voice', async () => {
            const page = await t.get('/talk/group/' + groupId, { as: alice });
            assert.ok(page.text.includes('Ada') && page.text.includes('Brenda'));
            assert.ok(page.text.includes('voice: gary') && page.text.includes('voice: brenda'));
            assert.ok(page.text.includes('Good morning, everyone'));
        });

        await check('the one named answers, and only the one named', async () => {
            await t.get('/talk/group/' + groupId + '/settings', { as: alice, form: { mode: 'named', turns: '1', speak: '1' } });
            actor.turns.length = 0;
            const sent = await t.get('/talk/group/' + groupId + '/send', { as: alice, form: { text: 'Brenda, what do you think?' } });
            assert.strictEqual(sent.status, 303);
            const messages = await t.ctx.groups.messages(groupId);
            const last = messages.filter((m) => m.role === 'assistant').slice(-1)[0];
            assert.strictEqual(last.character_id, brenda.id, 'the character that was named answers');
        });

        let chatId = null;
        await check('an answer is read aloud once, in the card\'s own voice', async () => {
            const talk = await t.get('/c/alice/ada/talk', { as: alice, method: 'POST' });
            assert.strictEqual(talk.status, 303, talk.text.slice(0, 200));
            chatId = String(talk.headers.get('location')).split('/').pop();
            ttsCalls.length = 0;
            const voiceToken = t.network.userToken(alice);
            const sent = await t.get('/talk/' + chatId + '/send', { as: alice, cookie: `exchange_at=${voiceToken}`, form: { text: 'Hello Ada' } });
            assert.strictEqual(sent.status, 303);
            assert.strictEqual(ttsCalls.length, 1, 'the answer is read aloud exactly once');
            assert.strictEqual(ttsCalls[0].body.voice, 'gary', 'in the voice the card names');
            assert.strictEqual(ttsCalls[0].auth, 'Bearer ' + voiceToken, 'the call carries the person\'s own token');
            const page = await t.get('/talk/' + chatId, { as: alice });
            assert.strictEqual((page.text.match(/<audio/g) || []).length, 1, 'one sound on the page');
            assert.ok(page.text.includes('voice: gary'));
        });

        await check('the rate limit is the person\'s own, and the answer is still written', async () => {
            ttsStatus = 429;
            ttsCalls.length = 0;
            const sent = await t.get('/talk/' + chatId + '/send', { as: alice, form: { text: 'And again' } });
            assert.strictEqual(sent.status, 303);
            assert.strictEqual(ttsCalls.length, 1, 'the voice is asked once, and not again after the limit');
            const page = await t.get('/talk/' + chatId, { as: alice });
            assert.ok(page.text.includes('And again'), 'the answer is written');
            assert.strictEqual((page.text.match(/<audio/g) || []).length, 1, 'no second sound');
            ttsStatus = 200;
        });

        await check('the image switch is off, and it refuses with a clear reason', async () => {
            const before = otherCalls.length;
            const img = await t.get('/talk/' + chatId + '/image', { as: alice, method: 'POST' });
            assert.strictEqual(img.status, 422, img.text.slice(0, 200));
            assert.ok(img.text.includes('Images are switched off'), 'the reason is on the page');
            assert.ok(img.text.includes('no image provider'), 'the reason names the missing provider');
            assert.strictEqual(otherCalls.length, before, 'no provider was called');
        });

        await check('the group image switch is off too', async () => {
            const img = await t.get('/talk/group/' + groupId + '/image', { as: alice, method: 'POST' });
            assert.strictEqual(img.status, 422);
            assert.ok(img.text.includes('Images are switched off'));
        });
    } finally {
        await t.close();
    }
    done();
})().catch((e) => { console.error(e); process.exit(1); });
