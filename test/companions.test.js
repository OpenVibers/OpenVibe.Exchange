'use strict';
/**
 * Companions on Exchange (Opus design, 2026-11-06): the cards, the sharing, the gallery with the 18+ rules,
 * the hard floor on the card at save and on the chat in and out, and the branching chat.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');
const codec = require('../server/companions/codec');
const floor = require('../server/companions/floor');

/** The branch line under a turn: "2/3", the count of the branch on screen out of all of them. */
const branchCount = (html) => (html.match(/ex-branch-count">([^<]*)</) || [])[1] || null;

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

(async () => {
    const ai = createFakeAi();
    const t = await boot({ ai });
    const alice = t.network.addUser('alice');
    const bob = t.network.addUser('bob');
    let cardUrl = null;
    let cardId = null;
    let chatId = null;

    try {
        await check('the gallery is empty, and it is a public page', async () => {
            const r = await t.get('/companions');
            assert.strictEqual(r.status, 200, r.text);
            assert.ok(r.text.includes('Characters'));
            assert.ok(r.text.includes('No characters yet'));
        });

        await check('a card needs a name', async () => {
            const r = await t.get('/companions/new', { as: alice, form: { name: '' } });
            assert.strictEqual(r.status, 422);
            assert.ok(r.text.includes('A card needs a name'));
        });

        await check('a card is made, and it is private by default', async () => {
            const made = await t.get('/companions/new', { as: alice, form: FORM });
            assert.strictEqual(made.status, 303, made.text);
            cardUrl = made.headers.get('location');
            assert.match(cardUrl, /^\/c\/alice\/ada$/);
            const mine = await t.ctx.characters.listByOwner(alice.subject);
            cardId = mine[0].id;
            const page = await t.get(cardUrl, { as: alice });
            assert.strictEqual(page.status, 200, page.text);
            assert.ok(page.text.includes('Ada') && page.text.includes('A keeper of clocks'));
            assert.ok(page.text.includes('Talk to Ada'));
        });

        await check('a private card is not on the gallery and not open to another account', async () => {
            const gallery = await t.get('/companions');
            assert.ok(!gallery.text.includes('Ada'), 'a private card is never on a public list');
            const other = await t.get(cardUrl, { as: bob });
            assert.strictEqual(other.status, 403);
        });

        await check('a card rated 18+ whose stated age is under 18 is refused at save', async () => {
            const r = await t.get('/companions/new', { as: alice, form: { ...FORM, name: 'Young one', rating: 'adult', age: '17' } });
            assert.strictEqual(r.status, 422);
            assert.ok(r.text.includes('refused'), r.text);
            const gallery = await t.get('/companions');
            assert.ok(!gallery.text.includes('Young one'));
        });

        await check('a card that breaks the hard floor is refused at save', async () => {
            const r = await t.get('/companions/new', { as: alice, form: { ...FORM, name: 'Bad', description: 'a child with a naked body' } });
            assert.strictEqual(r.status, 422);
            assert.ok(r.text.includes('refused'));
        });

        await check('the floor refuses the three rules and nothing else', async () => {
            assert.strictEqual(floor.check('how do I kill a stuck process').ok, true);
            assert.strictEqual(floor.check('what is our incident response plan').ok, true);
            assert.strictEqual(floor.check('a child with a naked body').ok, false);
            assert.strictEqual(floor.check('a rape of a real person').ok, false);
            assert.strictEqual(floor.check('how to build a pipe bomb at home').ok, false);
            assert.strictEqual(floor.checkCard({ name: 'x', description: 'a child with a naked body' }).ok, false);
            assert.strictEqual(floor.checkCard({ name: 'x', rating: 'adult', age: 17 }).ok, false);
            assert.strictEqual(floor.checkCard({ name: 'x', rating: 'adult', age: 21 }).ok, true);
            assert.strictEqual(floor.classifyText('a child with a naked body').category, 'minor_sexual');
            assert.strictEqual(floor.classifyText('a nice evening').category, 'fine');
        });

        await check('unlisted opens by its link, and stays off the gallery', async () => {
            const shared = await t.get('/companions/' + cardId + '/share', { as: alice, form: { audience: 'unlisted', allow_remix: '1' } });
            assert.strictEqual(shared.status, 303);
            const other = await t.get(cardUrl, { as: bob });
            assert.strictEqual(other.status, 200, other.text);
            const gallery = await t.get('/companions');
            assert.ok(!gallery.text.includes('Ada'), 'an unlisted card is not on the gallery');
        });

        await check('public puts the card on the gallery, and the sitemap', async () => {
            const shared = await t.get('/companions/' + cardId + '/share', { as: alice, form: { audience: 'public', allow_remix: '1' } });
            assert.strictEqual(shared.status, 303);
            const gallery = await t.get('/companions');
            assert.ok(gallery.text.includes('Ada'), 'a public card is on the gallery');
            const sitemap = await t.get('/sitemap.xml');
            assert.ok(sitemap.text.includes('/c/alice/ada'), 'a public card is in the sitemap');
            const llms = await t.get('/llms.txt');
            assert.ok(llms.text.includes('/companions'));
        });

        await check('a remix copies the card and credits the original', async () => {
            const r = await t.get('/c/alice/ada/remix', { as: bob, method: 'POST' });
            assert.strictEqual(r.status, 303, r.text);
            const remixUrl = r.headers.get('location');
            assert.match(remixUrl, /^\/c\/bob\//);
            const page = await t.get(remixUrl, { as: bob });
            assert.ok(page.text.includes('Ada'));
        });

        await check('the creator can switch remixing off', async () => {
            const shared = await t.get('/companions/' + cardId + '/share', { as: alice, form: { audience: 'public' } });
            assert.strictEqual(shared.status, 303);
            const r = await t.get('/c/alice/ada/remix', { as: bob, method: 'POST' });
            assert.strictEqual(r.status, 403);
            assert.ok(r.text.includes('switched remixing off'));
        });

        await check('an 18+ card is gated, and never on a public list', async () => {
            const made = await t.get('/companions/new', { as: alice, form: { ...FORM, name: 'After hours', rating: 'adult', age: '24' } });
            assert.strictEqual(made.status, 303, made.text);
            const url = made.headers.get('location');
            const guest = await t.get(url);
            assert.strictEqual(guest.status, 403);
            assert.ok(guest.text.includes('18+'));
            assert.ok(!guest.text.includes('After hours'), 'the card itself is not shown');
            const other = await t.get(url, { as: bob });
            assert.strictEqual(other.status, 403);
            const gallery = await t.get('/companions');
            assert.ok(!gallery.text.includes('After hours'));
            const sitemap = await t.get('/sitemap.xml');
            assert.ok(!sitemap.text.includes(url), 'an 18+ card is never in the sitemap');
            const llms = await t.get('/llms-full.txt');
            assert.ok(!llms.text.includes(url));
        });

        await check('a person with the 18+ confirmation sees the 18+ card', async () => {
            const confirm = await t.get('/uncensored/confirm', { as: alice, form: { adult: 'yes' } });
            assert.strictEqual(confirm.status, 303);
            const made = await t.get('/companions/new', { as: alice, form: { ...FORM, name: 'After hours two', rating: 'adult', age: '24' } });
            const url = made.headers.get('location');
            const seen = await t.get(url, { as: alice });
            assert.strictEqual(seen.status, 200, seen.text);
            assert.ok(seen.text.includes('After hours two'));
            const gallery = await t.get('/companions', { as: alice });
            assert.ok(gallery.text.includes('After hours two'), 'a confirmed person sees 18+ cards on the gallery');
        });

        await check("the 18+ confirmation is read from the person's account on Network", async () => {
            // Network owns the confirmation (Network PR #587): the flag sits on the account row, and Exchange
            // reads it with the person's own session token. A person confirmed there, and confirmed nowhere
            // else, may open an 18+ card.
            const confirmed = t.network.addUser('carol', { adult: true });
            const made = await t.get('/companions/new', { as: alice, form: { ...FORM, name: 'After hours three', rating: 'adult', age: '24' } });
            assert.strictEqual(made.status, 303, made.text);
            const url = made.headers.get('location');
            const id = (await t.ctx.characters.listByOwner(alice.subject)).find((c) => c.name === 'After hours three').id;
            const shared = await t.get('/companions/' + id + '/share', { as: alice, form: { audience: 'public' } });
            assert.strictEqual(shared.status, 303);
            const guest = await t.get(url);
            assert.strictEqual(guest.status, 403);
            const other = await t.get(url, { as: bob });
            assert.strictEqual(other.status, 403, 'an account without the confirmation may not');
            const seen = await t.get(url, { as: confirmed });
            assert.strictEqual(seen.status, 200, seen.text);
            assert.ok(seen.text.includes('After hours three'));
            const gallery = await t.get('/companions', { as: confirmed });
            assert.ok(gallery.text.includes('After hours three'), 'a confirmed person sees 18+ cards on the gallery');
        });

        await check('an unreadable 18+ flag is never a yes', async () => {
            // The flag fails closed: if Network cannot answer, nobody is confirmed by it.
            const stranger = t.network.addUser('dave');
            const made = await t.get('/companions/new', { as: alice, form: { ...FORM, name: 'After hours four', rating: 'adult', age: '24' } });
            const url = made.headers.get('location');
            const seen = await t.get(url, { as: stranger });
            assert.strictEqual(seen.status, 403);
        });

        await check('confirming on /uncensored records the 18+ flag on the account', async () => {
            // The confirmation belongs to the account (Network PR #587). The page writes it there, and the
            // account's answer is what the companions read.
            const erin = t.network.addUser('erin');
            const confirm = await t.get('/uncensored/confirm', { as: erin, form: { adult: 'yes' } });
            assert.strictEqual(confirm.status, 303);
            assert.ok(t.network.user(erin).adult, 'the account carries the confirmation');
            const made = await t.get('/companions/new', { as: alice, form: { ...FORM, name: 'After hours five', rating: 'adult', age: '24' } });
            const url = made.headers.get('location');
            const id = (await t.ctx.characters.listByOwner(alice.subject)).find((c) => c.name === 'After hours five').id;
            await t.get('/companions/' + id + '/share', { as: alice, form: { audience: 'public' } });
            const seen = await t.get(url, { as: erin });
            assert.strictEqual(seen.status, 200, seen.text);
        });

        await check('the adults’ tier says what changed, and what the floor does to characters', async () => {
            const page = await t.get('/uncensored');
            assert.strictEqual(page.status, 200, page.text);
            assert.ok(page.text.includes('What changed'), 'the dated changelog is there');
            assert.ok(page.text.includes('2026-11-06'));
            assert.ok(page.text.includes('The floor on characters and chats'));
            assert.ok(page.text.includes('refused at save'));
        });

        await check('the card exports as V3 JSON, and imports back', async () => {
            const out = await t.get('/companions/' + cardId + '/export?format=json', { as: alice });
            assert.strictEqual(out.status, 200, out.text);
            const json = JSON.parse(out.text);
            assert.strictEqual(json.spec, 'chara_card_v3');
            assert.strictEqual(json.data.name, 'Ada');
            const back = codec.importCard(Buffer.from(out.text, 'utf8')).card;
            assert.strictEqual(back.name, 'Ada');
            assert.strictEqual(back.tags.join(','), 'clock,friend');
        });

        await check('the card exports as a PNG with the card inside, and imports back', async () => {
            const out = await t.get('/companions/' + cardId + '/export?format=png', { as: alice });
            assert.strictEqual(out.status, 200);
            assert.strictEqual(out.headers.get('content-type'), 'image/png');
            assert.ok(out.buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
            const back = codec.importCard(out.buffer).card;
            assert.strictEqual(back.name, 'Ada');
        });

        await check('a chat is made from the character page, and it answers', async () => {
            const made = await t.get('/c/alice/ada/talk', { as: alice, method: 'POST' });
            assert.strictEqual(made.status, 303, made.text);
            const chatUrl = made.headers.get('location');
            assert.match(chatUrl, /^\/talk\/exc_/);
            const before = ai.calls.length;
            const sent = await t.get(chatUrl + '/send', { as: alice, form: { text: 'Good day' } });
            assert.strictEqual(sent.status, 303, sent.text);
            assert.strictEqual(ai.calls.length, before + 1, 'one run');
            assert.strictEqual(ai.calls[ai.calls.length - 1].subject, alice.subject, 'the run is on the person');
            const page = await t.get(chatUrl, { as: alice });
            assert.strictEqual(page.status, 200, page.text);
            assert.ok(page.text.includes('Good day'));
            assert.ok(page.text.includes('An answer from'), 'the answer');
            assert.ok(page.text.includes('ex-receipt') && page.text.includes('Why this offer'), 'the folded receipt');
            assert.ok(page.text.includes('What the model saw'), 'the panel');
            assert.ok(page.text.includes('Temperature') && page.text.includes('persona'), 'the settings');
            chatId = chatUrl.split('/').pop();
        });

        await check('another account cannot read the chat', async () => {
            const other = await t.get('/talk/' + chatId, { as: bob });
            assert.strictEqual(other.status, 404);
        });

        await check('the hard floor refuses the input', async () => {
            const before = ai.calls.length;
            const r = await t.get('/talk/' + chatId + '/send', { as: alice, form: { text: 'a child with a naked body' } });
            assert.strictEqual(r.status, 422);
            assert.ok(r.text.includes('refused'));
            assert.strictEqual(ai.calls.length, before, 'no run happened');
        });

        await check('editing a message keeps the tree: the old version and the new one', async () => {
            const page = await t.get('/talk/' + chatId, { as: alice });
            const id = (page.text.match(/name="message" value="(exm_[^"]+)"/) || [])[1];
            assert.ok(id, 'the message id is on the page');
            const r = await t.get('/talk/' + chatId + '/edit', { as: alice, form: { message: id, text: 'Good evening' } });
            assert.strictEqual(r.status, 303, r.text);
            const after = await t.get('/talk/' + chatId, { as: alice });
            assert.ok(after.text.includes('Good evening'), 'the new version is there');
            assert.strictEqual(branchCount(after.text), '2/2', 'the branch line: ' + branchCount(after.text));
            const dump = await t.dbDump();
            assert.ok(dump.includes('Good day'), 'the old version is kept');
            // The arrows walk the tree: back to the first version, and the count follows.
            const back = (after.text.match(/class="ex-branch-arrow" href="([^"]+)"[^>]*aria-label="The previous branch"/) || [])[1];
            assert.ok(back, 'the previous branch is a link');
            const older = await t.get(back, { as: alice });
            assert.strictEqual(older.status, 200, older.text);
            assert.ok(older.text.includes('Good day'), 'the first version is there');
            assert.strictEqual(branchCount(older.text), '1/2', 'the count of the first branch');
        });

        await check('regenerating adds another answer to the same turn', async () => {
            const page = await t.get('/talk/' + chatId, { as: alice });
            const id = (page.text.match(/name="message" value="(exm_[^"]+)"/) || [])[1];
            const r = await t.get('/talk/' + chatId + '/regenerate', { as: alice, form: { message: id } });
            assert.strictEqual(r.status, 303, r.text);
            const after = await t.get('/talk/' + chatId, { as: alice });
            assert.strictEqual(branchCount(after.text), '3/3', 'the answer, the edit and the new answer: ' + branchCount(after.text));
        });

        await check('a character without an avatar wears a monogram: the gallery, the page and the chat', async () => {
            const made = await t.get('/companions/new', { as: alice, form: { name: 'Zola', description: 'A card with no picture.', tags: 'history', rating: 'everyone' } });
            assert.strictEqual(made.status, 303, made.text);
            const zola = (await t.ctx.characters.listByOwner(alice.subject)).find((c) => c.name === 'Zola');
            assert.ok(zola, 'the card was made');
            await t.get('/companions/' + zola.id + '/share', { as: alice, form: { audience: 'public' } });
            const gallery = await t.get('/companions');
            assert.ok(/class="ex-card-face ex-mono"[^>]*>Z</.test(gallery.text), 'the gallery tile wears the monogram');
            const card = await t.get('/c/alice/zola', { as: alice });
            assert.strictEqual(card.status, 200, card.text);
            assert.ok(/class="ex-companion-avatar ex-mono"[^>]*>Z</.test(card.text), 'the character page wears the monogram');
            assert.ok(/--ex-mono: var\(--ovk-[a-z]+\)/.test(card.text), 'the colour is a palette token');
            const chat = await t.get('/talk/' + chatId, { as: alice });
            assert.ok(/class="ex-chat-face ex-mono"[^>]*>A</.test(chat.text), 'the chat header wears the monogram');
        });

        await check('the chat page has one header, and the thread starts under it', async () => {
            const chat = await t.get('/talk/' + chatId, { as: alice });
            assert.strictEqual((chat.text.match(/<header class="ovt-head/g) || []).length, 1, 'one header');
            assert.ok(chat.text.includes('ex-companion-shell'), 'the chat is its own window');
            const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'css', 'exchange.css'), 'utf8');
            assert.ok(/ex-companion-shell #navbar-mount[^{]*\{[^}]*display:\s*none/.test(css), 'the site bar is not on the chat page');
        });

        await check('the quiet actions sit under the messages', async () => {
            const chat = await t.get('/talk/' + chatId, { as: alice });
            assert.ok(chat.text.includes('>Edit</span>'), 'Edit under the person');
            assert.ok(chat.text.includes('>Regenerate</button>'), 'Regenerate under the answer');
            assert.ok(chat.text.includes('data-ovt-copy'), 'Copy under the answer');
            assert.ok(chat.text.includes('ex-branch-arrow'), 'the branch arrows');
            assert.ok(chat.text.includes('ex-receipt'), 'the folded receipt');
            assert.ok(/<textarea[^>]*name="text"/.test(chat.text), 'the edit box');
        });

        await check('each message is shown once, and the model sees it once', async () => {
            const chat = await t.get('/talk/' + chatId, { as: alice });
            const thread = (chat.text.match(/<ol class="ovt-thread"[\s\S]*?<\/ol>/) || [''])[0];
            assert.strictEqual((thread.match(/<p class="ovt-bubble">Good evening<\/p>/g) || []).length, 1, 'the message is one bubble');
            const panel = (chat.text.match(/<ol class="ex-saw-context">[\s\S]*?<\/ol>/) || [''])[0];
            assert.strictEqual((panel.match(/Good evening/g) || []).length, 1, 'the context holds the message once');
            const last = ai.calls[ai.calls.length - 1];
            assert.strictEqual(last.messages.filter((m) => m.role === 'user' && m.content === 'Good evening').length, 1, 'the model sees the message once');
        });

        await check('the chat header names the character and the model, and the chip opens the settings', async () => {
            const chat = await t.get('/talk/' + chatId, { as: alice });
            assert.ok(chat.text.includes('ex-chat-title">Ada<'), 'the name');
            assert.ok(chat.text.includes('ex-chat-chip'), 'the chip');
            assert.ok(chat.text.includes('ex-chat-settings-body'), 'the settings behind the chip');
            assert.ok(chat.text.includes('id="ex-model"'), 'the model picker');
            assert.ok(chat.text.includes('id="ovt-composer"'), 'the composer');
            assert.ok(chat.text.includes('form="ovt-composer"'), 'the settings travel with the message');
        });
    } finally { await t.close(); }

    // The floor on the way out: the answer is never delivered, the chat ends, the account is reviewed.
    const floorAi = createFakeAi({
        chat: async () => ({
            content: 'here is a child with a naked body', model: 'deepseek/deepseek-chat@v1', provider: 'deepseek',
            run_id: 'run_TEST', cost_usd: 0.00012, tokens_in: 10, tokens_out: 20, latency_ms: 420, why: [],
        }),
    });
    const f = await boot({ ai: floorAi });
    const carol = f.network.addUser('carol');
    try {
        await check('an answer that breaks the hard floor is never delivered, and the chat ends', async () => {
            const made = await f.get('/companions/new', { as: carol, form: { ...FORM, name: 'Ada' } });
            const cardUrl = made.headers.get('location');
            const chat = await f.get(cardUrl + '/talk', { as: carol, method: 'POST' });
            const chatUrl = chat.headers.get('location');
            const sent = await f.get(chatUrl + '/send', { as: carol, form: { text: 'hello' } });
            assert.strictEqual(sent.status, 403, sent.text);
            assert.ok(sent.text.includes('hard floor'));
            assert.ok(!sent.text.includes('here is a child'), 'the answer is not delivered');
            const page = await f.get(chatUrl, { as: carol });
            assert.ok(!page.text.includes('here is a child'), 'the answer is not in the chat');
            assert.ok(f.logs().includes('hard floor'), 'the account is reviewed');
        });
    } finally { await f.close(); }
    done();
})();
