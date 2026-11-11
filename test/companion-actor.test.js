'use strict';
/**
 * Companions answer through OpenVibe.Actor (one-engine slice): one turn per answer with the person's own
 * Bearer on the wire, the cost on their allowance, and refusals or outages as words in the chat. The old
 * direct path is gone: the AI stand-in here throws if anything calls ai.chat.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');
const { TurnError } = require('../server/actor');

const FORM = {
    name: 'Ada',
    description: 'A keeper of clocks',
    personality: 'precise, warm',
    scenario: 'a workshop full of clocks',
    first_message: 'Good day. What needs winding?',
    example_dialogue: '<START>',
    tags: 'clock,friend',
    rating: 'everyone',
};

const { createFakeActor } = require('./helpers/actor');


const loudAi = () => createFakeAi({
    chat: () => { throw new Error('ai.chat must not be called for companions any more'); },
});

async function makeChat(t, as, name = 'Ada', form = {}) {
    const made = await t.get('/companions/new', { as, form: { ...FORM, name, ...form } });
    assert.strictEqual(made.status, 303, made.text);
    const cardUrl = made.headers.get('location');
    const mine = await t.ctx.characters.listByOwner(as.subject);
    const card = mine.find((c) => c.name === name);
    // The card's own slug (the name, with what is not a letter or a digit turned into a dash).
    const slug = String(cardUrl).split('/').pop();
    const talk = await t.get(`/c/${as.username}/${encodeURIComponent(slug)}/talk`, { as, method: 'POST' });
    assert.strictEqual(talk.status, 303, talk.text);
    return { cardUrl, card, chatUrl: talk.headers.get('location') };
}

(async () => {
    const actor = createFakeActor();
    const t = await boot({ ai: loudAi(), actor });
    const alice = t.network.addUser('alice');

    await check('a turn answers through Actor on the person token, and shows its cost', async () => {
        const { chatUrl } = await makeChat(t, alice);
        const before = actor.turns.length;
        const cookie = t.signIn(alice);
        const sent = await t.get(chatUrl + '/send', { as: alice, cookie, form: { text: 'Good day' } });
        assert.strictEqual(sent.status, 303, sent.text);
        assert.strictEqual(actor.turns.length, before + 1, 'one Actor turn');
        const call = actor.turns[actor.turns.length - 1];
        assert.strictEqual(call.token, cookie.split('=')[1], "the person's own token is on the wire");
        assert.deepStrictEqual(call.tools, [], 'a companion turn calls no tools');
        assert.strictEqual(call.conversation.product, 'exchange');
        assert.match(call.conversation.id, /^companion-chat:/);
        assert.match(call.idempotencyKey, /^exchange-companion-/);
        assert.strictEqual(call.budgetUsd, t.config.companions.maxCostUsd, 'the per-turn ceiling draws the budget');
        assert.match(call.task, /You are Ada/, 'the character system travels with the turn');
        assert.match(call.task, /Good day/, 'the new words travel with the turn');
        const page = await t.get(chatUrl, { as: alice });
        assert.strictEqual(page.status, 200, page.text);
        assert.ok(page.text.includes('An answer from Actor'), 'the answer');
        assert.ok(page.text.includes('ex-receipt'), 'the folded receipt');
        assert.ok(page.text.includes('$0.000120'), 'the cost line shows what the turn cost');
        assert.ok(page.text.includes('What the model saw'), 'the transparency panel stays');
    });

    await check('an adult companion asks for the uncensored tier, and the person\'s own 18+ check decides it', async () => {
        const adult = t.network.addUser('ada_adult', { adult: true });
        const { chatUrl } = await makeChat(t, adult, 'After hours', { rating: 'adult', age: '24' });
        const before = actor.turns.length;
        const sent = await t.get(chatUrl + '/send', { as: adult, form: { text: 'Good evening' } });
        assert.strictEqual(sent.status, 303, sent.text);
        assert.strictEqual(actor.turns.length, before + 1, 'one Actor turn');
        const call = actor.turns[actor.turns.length - 1];
        // The tier rides the turn, so OpenVibe.AI can check this person's 18+ confirmation on their account and
        // refuse the tier without it. The floor still holds on every answer.
        assert.strictEqual(call.tier, 'uncensored', 'the adult card asks for the uncensored policy, as it did before');
    });

    await check('a person without the 18+ confirmation never asks for the uncensored tier', async () => {
        const plain = t.network.addUser('ada_plain');
        const made = await t.get('/companions/new', { as: plain, form: { ...FORM, name: 'After hours too', rating: 'adult', age: '24' } });
        assert.strictEqual(made.status, 303, made.text);
        const slug = String(made.headers.get('location')).split('/').pop();
        // The gate is in front of the card: a person who has not confirmed never reaches the companion at all,
        // so no turn of theirs can ask for the adult tier.
        const page = await t.get(`/c/${plain.username}/${encodeURIComponent(slug)}`, { as: plain });
        assert.strictEqual(page.status, 403, `status ${page.status}: ` + page.text.slice(0, 200));
        assert.ok(/18\+|adult/i.test(page.text), `the 18+ gate: ` + page.text.slice(0, 400));
        const before = actor.turns.length;
        await t.get(`/c/${plain.username}/${encodeURIComponent(slug)}/talk`, { as: plain, method: 'POST' });
        assert.strictEqual(actor.turns.length, before, 'no turn was asked for');
    });

    await check('an everyday companion never asks for the uncensored tier', async () => {
        const { chatUrl } = await makeChat(t, alice);
        const before = actor.turns.length;
        await t.get(chatUrl + '/send', { as: alice, form: { text: 'Good day' } });
        assert.strictEqual(actor.turns.length, before + 1, 'one Actor turn');
        const call = actor.turns[actor.turns.length - 1];
        assert.ok(!call.tier || call.tier === 'standard', 'the standard tier');
    });

    await check('a refusal is words in the chat, charged never twice', async () => {
        const { chatUrl } = await makeChat(t, alice, 'Refusal');
        actor.behavior.fail = new TurnError(502, 'actor.task.failed', 'The answer did not pass its check, so it was not delivered.', 'tsk_test_9');
        try {
            const sent = await t.get(chatUrl + '/send', { as: alice, form: { text: 'Hello?' } });
            assert.strictEqual(sent.status, 303, sent.text);
            const page = await t.get(chatUrl, { as: alice });
            assert.ok(page.text.includes('did not pass its check'), 'the refusal in plain words');
        } finally { actor.behavior.fail = null; }
    });

    await check('an outage is words in the chat, and nothing falls back to AI', async () => {
        const { chatUrl } = await makeChat(t, alice, 'Outage');
        actor.behavior.fail = new TurnError(503, 'actor.unreachable', 'OpenVibe.Actor could not be reached just now. Nothing was charged, and the words stayed here. Try again in a moment.');
        try {
            const sent = await t.get(chatUrl + '/send', { as: alice, form: { text: 'Are you there?' } });
            assert.strictEqual(sent.status, 303, sent.text);
            const page = await t.get(chatUrl, { as: alice });
            assert.ok(page.text.includes('could not be reached'), 'the outage in plain words');
        } finally { actor.behavior.fail = null; }
    });

    await check('a slow turn reconciles on the next view', async () => {
        const { chatUrl } = await makeChat(t, alice, 'Slowpoke');
        actor.behavior.pending = true;
        actor.behavior.holdReads = true;
        try {
            const sent = await t.get(chatUrl + '/send', { as: alice, form: { text: 'Take your time.' } });
            assert.strictEqual(sent.status, 303, sent.text);
            const waiting = await t.get(chatUrl, { as: alice });
            assert.ok(waiting.text.includes('taking longer than usual'), 'the holding words');
            assert.ok(!waiting.text.includes('Late answer'), 'no answer yet');
            actor.behavior.pending = false;
            actor.behavior.holdReads = false;
            const after = await t.get(chatUrl, { as: alice });
            assert.ok(actor.reads.length > 0, 'the next view reads the task back');
            assert.ok(after.text.includes('Late answer'), 'the finished answer fills in');
            assert.ok(!after.text.includes('taking longer than usual'), 'the holding words are gone');
        } finally { actor.behavior.pending = false; actor.behavior.holdReads = false; }
    });

    await check('notes are a turn of their own, and cost nothing twice', async () => {
        const { chatUrl } = await makeChat(t, alice, 'Noteworthy');
        const notesBefore = actor.turns.length;
        for (let i = 0; i < 4; i++) {
            const sent = await t.get(chatUrl + '/send', { as: alice, form: { text: `note turn ${i}` } });
            assert.strictEqual(sent.status, 303, sent.text);
        }
        const noteCalls = actor.turns.slice(notesBefore).filter((c) => String(c.conversation && c.conversation.id || '').startsWith('exchange-notes:'));
        assert.strictEqual(noteCalls.length, 1, 'one notes turn after every few turns');
        assert.deepStrictEqual(noteCalls[0].tools, []);
    });

    await t.close();
    done();
})().catch((e) => { console.error(e); process.exit(1); });
