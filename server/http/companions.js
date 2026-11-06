'use strict';

/**
 * Companions on Exchange (Opus design, 2026-11-06): character cards, the gallery, sharing, and one-character
 * chats with a branching tree.
 *
 *   /companions                  the gallery: search, tags, three sorts, a counted fold
 *   /companions/new              make a card (or import a V2/V3 card)
 *   /companions/:id/edit         edit a card
 *   /companions/:id/share        the sharing audience and the remixing switch
 *   /companions/:id/remix        a copy that credits the original
 *   /companions/:id/export       the card out, as JSON or as a PNG with the card inside
 *   /c/:handle/:character        a character's page
 *   /talk/:chat                  a chat, on openvibe-shared's thread UI
 *
 * Everything is a plain POST form or a real link: the site works without JavaScript.
 *
 * The hard floor (server/companions/floor.js) is checked on the card at save, on the input and on the output.
 * A breach on the output ends the chat and the account is reviewed.
 */
const express = require('express');
const kit = require('openvibe-shared/kit');
const thread = require('openvibe-shared/thread');
const { asyncRouter } = require('./router');
const { sameOrigin } = require('./principal');
const { esc, raw } = require('../render/html');
const { send } = require('../render/layout');
const views = require('../views/companions');
const floor = require('../companions/floor');
const codec = require('../companions/codec');
const { readTurns } = require('../companions/store');
const multer = require('multer');

const handleOf = (name) => String(name || 'someone').toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'someone';
const tagsOf = (s) => String(s || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 5);

function createCompanionRoutes(ctx) {
    const { config, ai, adult, adultAccount, characters, companionChats, sharing, log } = ctx;
    const r = asyncRouter();
    // A card may arrive as a file (a PNG with the card inside, or plain JSON).
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
    r.use(express.urlencoded({ extended: false, limit: '256kb' }));

    const page = (req, res, o, status = 200) => send(res, status, { viewer: req.viewer, config, path: req.originalUrl, ...o });
    const signedIn = (req) => Boolean(req.viewer && req.viewer.kind === 'user' && req.viewer.subject);
    const owner = (req) => req.viewer.subject;
    const handle = (req) => handleOf(req.viewer && (req.viewer.username || req.viewer.displayName));
    const notFromHere = (req, res) => page(req, res, {
        title: 'Not from this site', index: false,
        body: raw('<div class="ex-wrap ex-narrow">' + kit.empty({ icon: 'shield', title: 'That came from somewhere else', text: 'Use the form on OpenVibe.Exchange.' }) + '</div>'),
    }, 403);
    const signInPage = (req, res, { title, text, next }) => page(req, res, {
        title, index: false,
        body: raw('<div class="ex-wrap ex-narrow">' + kit.empty({ icon: 'person', title, text, action: { href: '/auth/login?next=' + encodeURIComponent(next || req.originalUrl), label: 'Sign in with OpenVibe' } }) + '</div>'),
    }, 401);
    /**
     * The 18+ gate: has this person confirmed, on their account, that they are 18 or older?
     *
     * Network owns the confirmation (Network PR #587): the flag sits on the account row, and OpenVibe.AI reads
     * the same flag for the uncensored tier. Network grants Exchange no identity.subject.resolve, so the read
     * goes out with the person's own session token - the token this site already holds - against Network's
     * GET /api/v1/me/adult. Exchange's own row (exchange_adult_confirmations, what /uncensored writes) still
     * counts, so a person who confirmed here before Network shipped the flag keeps their access.
     *
     * Both fail closed: an unreadable flag is never a yes.
     */
    const isAdult = async (req) => {
        if (!signedIn(req)) return false;
        if (adultAccount) {
            try {
                const token = (req.token || (req.viewer && req.viewer.token) || null);
                if (await adultAccount.adultFor(owner(req), token)) return true;
            } catch (err) {
                log.warn('[Companions] the 18+ confirmation could not be read:', err.message);
            }
        }
        return await adult.confirmed(owner(req));
    };

    /** The card's fields, out of a form body or an imported card. */
    function cardOf(body, imported = null) {
        const b = body || {};
        const src = imported || b;
        const pick = (a, c) => (imported ? (src[c] == null ? '' : String(src[c])) : (b[a] == null ? '' : String(b[a])));
        const tags = imported
            ? (Array.isArray(src.tags) ? src.tags : [])
            : String(b.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
        return {
            name: pick('name', 'name').slice(0, 80),
            slug: String(b.slug || '').slice(0, 60),
            description: pick('description', 'description'),
            personality: pick('personality', 'personality'),
            scenario: pick('scenario', 'scenario'),
            first_message: pick('first_message', 'first_message'),
            example_dialogue: pick('example_dialogue', 'example_dialogue'),
            avatar_url: String(b.avatar_url || (imported ? '' : '')).slice(0, 400),
            rating: (imported ? (src.rating === 'adult' ? 'adult' : 'everyone') : (b.rating === 'adult' ? 'adult' : 'everyone')),
            age: b.age != null && String(b.age).trim() !== '' ? Number(b.age) : (imported && src.age != null ? Number(src.age) : null),
            model: String(b.model || '').slice(0, 120),
            tags,
        };
    }

    // ── The gallery ───────────────────────────────────────────────────────
    r.get('/companions', async (req, res) => {
        const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : '';
        const tags = tagsOf(req.query.tags);
        const sort = ['new', 'week', 'remixed'].includes(req.query.sort) ? req.query.sort : 'new';
        const adultOk = await isAdult(req);
        const [gallery, tagList, mine] = await Promise.all([
            characters.gallery({ sort, q, tags, limit: 48, allowAdult: adultOk }),
            characters.allTags(24),
            signedIn(req) ? characters.listByOwner(owner(req)) : [],
        ]);
        if (adultOk) res.set('X-Robots-Tag', 'noindex, nofollow');
        return page(req, res, {
            index: true,
            title: q ? 'Characters: ' + q : 'Characters',
            description: 'Character cards on OpenVibe.Exchange: bring a card in as Character Card V2 or V3, talk to it, and take it with you again.',
            body: raw(views.galleryPage({ items: gallery.items, total: gallery.total, q, tags, sort, tagList, viewer: req.viewer, adult: adultOk, mine })),
        });
    });

    // ── Make a card ──────────────────────────────────────────────────────
    r.get('/companions/new', (req, res) => {
        if (!signedIn(req)) return signInPage(req, res, { title: 'Sign in to make a character', text: 'Your cards stay in your account until you share them.', next: '/companions/new' });
        return page(req, res, { title: 'Make a character', index: false, body: raw(views.cardForm({ action: '/companions/new', title: 'Make a character' })) });
    });

    /** The import route reads a multipart body, so it must come before the urlencoded parser sees it. */
    async function saveCard(req, res, { existing = null } = {}) {
        if (!signedIn(req)) return signInPage(req, res, { title: 'Sign in first', text: 'Your cards stay in your account until you share them.', next: '/companions/new' });
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        let imported = null;
        if (req.file && req.file.buffer && req.file.buffer.length) {
            try {
                imported = codec.importCard(req.file.buffer, { filename: req.file.originalname }).card;
            } catch (err) {
                const problem = 'That file is not a character card: ' + err.message;
                if (existing) {
                    const card = await characters.get(owner(req), existing.id);
                    return page(req, res, { title: 'Edit the card', index: false, body: raw(views.cardForm({ card, action: '/companions/' + existing.id + '/edit', title: 'Edit the card', problem })) }, 422);
                }
                return page(req, res, { title: 'Make a character', index: false, body: raw(views.cardForm({ action: '/companions/new', title: 'Make a character', problem })) }, 422);
            }
        }
        const card = cardOf(req.body, imported);
        if (!card.name) {
            const problem = 'A card needs a name.';
            const back = existing ? await characters.get(owner(req), existing.id) : null;
            return page(req, res, { title: 'The card', index: false, body: raw(views.cardForm({ card: back, action: existing ? '/companions/' + existing.id + '/edit' : '/companions/new', title: existing ? 'Edit the card' : 'Make a character', problem })) }, 422);
        }
        const check = floor.checkCard(card);
        if (!check.ok) {
            const problem = 'This card is refused: ' + check.detail + ' (the hard floor, ' + check.label + ').';
            const back = existing ? await characters.get(owner(req), existing.id) : null;
            return page(req, res, { title: 'The card', index: false, body: raw(views.cardForm({ card: back || card, action: existing ? '/companions/' + existing.id + '/edit' : '/companions/new', title: existing ? 'Edit the card' : 'Make a character', problem })) }, 422);
        }
        if (existing) {
            const updated = await characters.update(owner(req), existing.id, card);
            return res.redirect(303, '/c/' + encodeURIComponent(updated.handle) + '/' + encodeURIComponent(updated.slug));
        }
        const made = await characters.create({ owner: owner(req), handle: handle(req), ...card });
        try {
            await sharing.register({ subject: owner(req) }, made.id, 'private');
        } catch (err) {
            log.warn('[Companions] the card was saved but not registered with the sharing system:', err.message);
        }
        return res.redirect(303, '/c/' + encodeURIComponent(made.handle) + '/' + encodeURIComponent(made.slug));
    }

    r.post('/companions/new', upload.single('import'), (req, res) => saveCard(req, res));

    // ── Edit, share, delete, remix, export ───────────────────────────────
    r.get('/companions/:id/edit', async (req, res) => {
        if (!signedIn(req)) return signInPage(req, res, { title: 'Sign in to edit', text: 'Your cards stay in your account.', next: '/companions/' + req.params.id + '/edit' });
        const card = await characters.get(owner(req), req.params.id);
        if (!card) return page(req, res, { title: 'Not found', index: false, body: raw('<div class="ex-wrap ex-narrow">' + kit.empty({ icon: 'search', title: 'No such card', text: 'It may have been deleted.' }) + '</div>') }, 404);
        return page(req, res, { title: 'Edit the card', index: false, body: raw(views.cardForm({ card, action: '/companions/' + card.id + '/edit', title: 'Edit the card' })) });
    });

    r.post('/companions/:id/edit', upload.single('import'), (req, res) => {
        const existing = { id: String(req.params.id || '') };
        return saveCard(req, res, { existing });
    });

    r.post('/companions/:id/share', async (req, res) => {
        if (!signedIn(req)) return signInPage(req, res, { title: 'Sign in first', text: 'Only the creator can share a card.', next: '/companions' });
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const card = await characters.get(owner(req), req.params.id);
        if (!card) return res.redirect(303, '/companions');
        const audience = ['private', 'unlisted', 'public'].includes(req.body && req.body.audience) ? req.body.audience : 'private';
        const allowRemix = !!(req.body && req.body.allow_remix);
        try {
            await sharing.setAudience({ subject: owner(req) }, card.id, audience);
        } catch (err) {
            log.warn('[Companions] the audience could not be changed:', err.message);
        }
        await characters.update(owner(req), card.id, { audience, allow_remix: allowRemix });
        return res.redirect(303, '/c/' + encodeURIComponent(card.handle) + '/' + encodeURIComponent(card.slug));
    });

    r.post('/companions/:id/delete', async (req, res) => {
        if (!signedIn(req)) return res.redirect(303, '/companions');
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const card = await characters.get(owner(req), req.params.id);
        if (card) await characters.update(owner(req), card.id, { audience: 'private' });
        return res.redirect(303, '/companions');
    });

    r.post('/c/:handle/:character/remix', async (req, res) => {
        if (!signedIn(req)) return signInPage(req, res, { title: 'Sign in to remix', text: 'A remix is a copy of somebody else&#39;s card, with their name on it.', next: '/companions' });
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const original = await characters.bySlug(req.params.handle, req.params.character);
        if (!original) return res.redirect(303, '/companions');
        if (!original.allow_remix) return page(req, res, { title: original.name, index: false, body: raw(views.characterPage({ card: original, allowRemix: false, problem: 'The creator has switched remixing off for this character.' })) }, 403);
        const copy = await characters.create({
            owner: owner(req), handle: handle(req), name: original.name, slug: original.slug,
            description: original.description, personality: original.personality, scenario: original.scenario,
            first_message: original.first_message, example_dialogue: original.example_dialogue,
            avatar_url: original.avatar_url, rating: original.rating, age: original.age, model: original.model,
            tags: original.tags, remix_of: original.id, original_author: original.handle,
        });
        try {
            await sharing.register({ subject: owner(req) }, copy.id, 'private');
        } catch (err) {
            log.warn('[Companions] the remix was saved but not registered with the sharing system:', err.message);
        }
        return res.redirect(303, '/c/' + encodeURIComponent(copy.handle) + '/' + encodeURIComponent(copy.slug));
    });

    r.get('/companions/:id/export', async (req, res) => {
        const id = String(req.params.id || '');
        const card = await characters.get(owner(req), id).catch(() => null);
        const found = card || await characters.bySlug((req.query.handle || ''), (req.query.slug || ''));
        const target = found || (await characters.get(owner(req), id)) || null;
        if (!target) return page(req, res, { title: 'Not found', index: false, body: raw('<div class="ex-wrap ex-narrow">' + kit.empty({ icon: 'search', title: 'No such card' }) + '</div>') }, 404);
        const format = req.query.format === 'png' ? 'png' : 'json';
        const out = codec.exportCard(target, { format, spec: format === 'png' ? 'v3' : 'v3' });
        res.set('Content-Type', out.contentType);
        res.set('Content-Disposition', 'attachment; filename="' + out.filename + '"');
        return res.send(out.buffer);
    });

    // ── A character page ─────────────────────────────────────────────────
    r.get('/c/:handle/:character', async (req, res) => {
        const card = await characters.bySlug(req.params.handle, req.params.character);
        if (!card) return page(req, res, { title: 'Not found', index: false, body: raw('<div class="ex-wrap ex-narrow">' + kit.empty({ icon: 'search', title: 'No such character', text: 'There is no card at this address.' }) + '</div>') }, 404);
        const adultOk = await isAdult(req);
        if (card.rating === 'adult' && !adultOk) {
            res.set('X-Robots-Tag', 'noindex, nofollow');
            return page(req, res, { title: '18+', index: false, body: raw(views.adultGate()) }, 403);
        }
        const mine = signedIn(req) && card.owner === owner(req);
        const canSee = await sharing.canView(req.viewer, card.id).catch(() => false);
        if (!canSee && !mine) {
            res.set('X-Robots-Tag', 'noindex, nofollow');
            return page(req, res, { title: 'Private', index: false, body: raw('<div class="ex-wrap ex-narrow">' + kit.empty({ icon: 'shield', title: 'This character is private', text: 'Its creator has not shared it yet.' }) + '</div>') }, 403);
        }
        await characters.addView(card.id, signedIn(req) ? owner(req) : null);
        const [tags, remixes] = await Promise.all([characters.tagsOf(card.id), characters.countRemixes(card.id)]);
        return page(req, res, {
            index: card.rating !== 'adult',
            title: card.name,
            description: String(card.description || card.name).slice(0, 160),
            body: raw(views.characterPage({ card, tags, viewer: req.viewer, mine, remixes, allowRemix: card.allow_remix })),
        });
    });

    r.post('/c/:handle/:character/talk', async (req, res) => {
        if (!signedIn(req)) return signInPage(req, res, { title: 'Sign in to talk', text: 'Your chat stays in your account.', next: req.originalUrl });
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const card = await characters.bySlug(req.params.handle, req.params.character);
        if (!card) return res.redirect(303, '/companions');
        const adultOk = await isAdult(req);
        if (card.rating === 'adult' && !adultOk) return page(req, res, { title: '18+', index: false, body: raw(views.adultGate()) }, 403);
        const chat = await companionChats.create({ owner: owner(req), characterId: card.id, title: card.name, settings: { model: card.model || null } });
        return res.redirect(303, '/talk/' + chat.id);
    });

    // ── Chats: one character, a branching tree, the folded receipt ────────
    function systemPromptFor(card, chat) {
        const lines = ['You are ' + card.name + '.'];
        if (card.description) lines.push(card.description);
        if (card.personality) lines.push('Personality: ' + card.personality);
        if (card.scenario) lines.push('Scenario: ' + card.scenario);
        if (chat.persona) lines.push('The person you talk with plays: ' + chat.persona);
        if (card.first_message) lines.push('Begin with: ' + card.first_message);
        lines.push('Stay in character and answer as the character would. The hard floor holds on every model: no sexual content involving minors, no non-consensual sexual content (fiction included) or incest, no help with weapons of mass harm or attacks on others.');
        return lines.join(String.fromCharCode(10));
    }

    /** The turns of the current path, newest last, within the context size the person asked for. */
    function contextTurns(turns, contextSize) {
        const limit = Math.max(2000, Number(contextSize) || 0);
        const out = [];
        let chars = 0;
        for (let i = turns.length - 1; i >= 0; i--) {
            const t = turns[i];
            const size = String(t.user.content || '').length + String((t.answer && t.answer.content) || '').length;
            if (out.length && chars + size > limit) break;
            chars += size;
            out.unshift(t);
        }
        return out;
    }

    async function modelIdOf(slug) {
        if (!slug) return 'openvibe/auto';
        const catalog = await ai.catalog();
        const model = (catalog.models || []).find((m) => m.slug === slug);
        if (!model) return 'openvibe/auto';
        const best = (model.offers || []).find((o) => o.id) || (model.offers || [])[0];
        return (best && best.id) || 'openvibe/auto';
    }

    async function chatModels() {
        const catalog = await ai.catalog();
        const notChat = new Set(['embedding', 'embeddings', 'stt', 'asr', 'tts', 'speech', 'image', 'images', 'rerank', 'moderation']);
        return (catalog.models || []).filter((m) => !notChat.has(String(m.kind || m.type || 'chat').toLowerCase()));
    }

    /** The receipt, folded: what it cost, how long it took, and why that offer. */
    function receiptFor(answer) {
        const meta = (answer && answer.meta) || {};
        const cost = meta.cost_usd;
        const latency = meta.latency_ms;
        return '<details class="ex-receipt"><summary>Receipt</summary><dl>'
            + '<dt>Model</dt><dd>' + esc(meta.answered_model || answer.model || 'OpenVibe') + '</dd>'
            + '<dt>Price</dt><dd>' + (cost == null ? '—' : Number(cost) === 0 ? 'free' : '$' + Number(cost).toFixed(6)) + '</dd>'
            + '<dt>Tokens</dt><dd>' + (meta.tokens_in != null || meta.tokens_out != null ? Number(meta.tokens_in || 0).toLocaleString('en-US') + ' in · ' + Number(meta.tokens_out || 0).toLocaleString('en-US') + ' out' : '—') + '</dd>'
            + '<dt>Latency</dt><dd>' + (latency == null ? '—' : Number(latency).toLocaleString('en-US') + ' ms') + '</dd>'
            + '<dt>Why this offer</dt><dd>' + (Array.isArray(meta.why) && meta.why.length ? esc(meta.why.join(' · ')) : 'The router picked the healthiest offer for your floor, ceiling and policy.') + '</dd>'
            + '</dl></details>';
    }

    /**
     * The turn's branch line: every version of the message with the answers that belong to it. An edit adds a
     * version, a regenerate adds an answer, and the line keeps them all, so the arrows walk the tree in place.
     */
    function branchPairs(turn) {
        const pairs = [];
        const all = turn.allAnswers || turn.answers || [];
        for (const u of turn.users) {
            const answers = all.filter((a) => a.parent_id === u.id).sort((a, b) => a.variant - b.variant);
            if (!answers.length) pairs.push({ user: u, answer: null });
            else for (const a of answers) pairs.push({ user: u, answer: a });
        }
        return pairs;
    }

    /** The arrows: 1/2 with a chevron on each side. They are links, so they work without script. */
    function branchNav(chatId, turn, query) {
        const pairs = branchPairs(turn);
        if (pairs.length < 2) return '';
        let at = pairs.findIndex((p) => p.user.id === turn.user.id && (turn.answer ? !!(p.answer && p.answer.id === turn.answer.id) : !p.answer));
        if (at < 0) at = pairs.length - 1;
        const url = (p) => branchUrl(chatId, query, turn.id, p);
        const prev = at > 0
            ? '<a class="ex-branch-arrow" href="' + esc(url(pairs[at - 1])) + '" rel="nofollow" aria-label="The previous branch">\u2039</a>'
            : '<span class="ex-branch-arrow is-off" aria-hidden="true">\u2039</span>';
        const next = at < pairs.length - 1
            ? '<a class="ex-branch-arrow" href="' + esc(url(pairs[at + 1])) + '" rel="nofollow" aria-label="The next branch">\u203a</a>'
            : '<span class="ex-branch-arrow is-off" aria-hidden="true">\u203a</span>';
        return '<span class="ex-branch-nav" title="Branch ' + (at + 1) + ' of ' + pairs.length + '">' + prev
            + '<span class="ex-branch-count">' + (at + 1) + '/' + pairs.length + '</span>' + next + '</span>';
    }

    /** The address of one branch: the version of the message and the answer that goes with it. */
    function branchUrl(chatId, query, turnId, pair) {
        const next = new URLSearchParams();
        for (const [k, v] of Object.entries(query || {})) {
            if (k === 'v_' + turnId || k.startsWith('a_')) continue;
            if (v != null && v !== '') next.set(k, String(v));
        }
        next.set('v_' + turnId, String(pair.user.variant));
        if (pair.answer) next.set('a_' + pair.user.id, String(pair.answer.variant));
        return '/talk/' + encodeURIComponent(chatId) + '?' + next.toString();
    }

    /** Edit, in place: the message becomes a box, and the box becomes a new branch of the message when it is saved. */
    function editAction(chat, turn) {
        const id = 'ex-edit-' + turn.id;
        return '<details class="ex-menu">'
            + '<summary class="ex-act"><span class="ex-lbl-open">Edit</span><span class="ex-lbl-shut">Cancel</span></summary>'
            + '<form class="ex-menu-body" method="post" action="/talk/' + encodeURIComponent(chat.id) + '/edit">'
            + '<input type="hidden" name="message" value="' + esc(turn.user.id) + '">'
            + '<input type="hidden" name="turn" value="' + esc(turn.id) + '">'
            + '<label class="ovt-sr" for="' + esc(id) + '">Edit this message</label>'
            + '<textarea id="' + esc(id) + '" name="text" rows="3" maxlength="4000">' + esc(turn.user.content) + '</textarea>'
            + '<button type="submit" class="ex-act ex-act-strong">Save</button>'
            + '</form></details>';
    }

    /**
     * One turn: what the person wrote (once, as a bubble), the answer, and the quiet actions under each. The
     * actions are small, and they show on hover or focus; on a touch screen they are always there.
     */
    function turnHtml(chat, card, turn, query) {
        const face = thread.face({ name: card.name, color: 'var(' + views.monoToken(card.name) + ')' });
        const you = '<div class="ovt-you">'
            + '<p class="ovt-bubble">' + esc(turn.user.content) + '</p>'
            + '<div class="ex-acts ex-acts-you">' + editAction(chat, turn) + '</div>'
            + '</div>';
        const answer = turn.answer
            ? '<article class="ex-answer-col">'
                + thread.answer({ html: esc(turn.answer.content || '').split(String.fromCharCode(10)).join('<br>'), meta: [], copy: false })
                + receiptFor(turn.answer)
                + '</article>'
            : '';
        const acts = turn.answer
            ? '<div class="ex-acts ex-acts-bot">'
                + '<form class="ex-act-form" method="post" action="/talk/' + encodeURIComponent(chat.id) + '/regenerate">'
                + '<input type="hidden" name="message" value="' + esc(turn.user.id) + '">'
                + '<button type="submit" class="ex-act">Regenerate</button></form>'
                + '<button type="button" class="ex-act" data-ovt-copy hidden>Copy</button>'
                + branchNav(chat.id, turn, query)
                + '</div>'
            : '';
        const bot = turn.answer ? '<div class="ovt-bot">' + face + '<div class="ovt-reply">' + answer + acts + '</div></div>' : '';
        return '<li class="ovt-turn ex-turn" id="t-' + esc(turn.id) + '" data-turn="' + esc(turn.id) + '">' + you + bot + '</li>';
    }

    /** What the model saw: the card, the settings, the context, the receipt. Nothing hidden. */
    function sawPanel(chat, card, turns) {
        const last = turns.length ? turns[turns.length - 1] : null;
        const saw = (last && last.answer && last.answer.meta && last.answer.meta.saw) || null;
        const rows = [];
        rows.push({ title: 'Character', sub: card.name });
        rows.push({ title: 'Model', sub: saw && saw.model ? saw.model : (chat.model || 'the router picks one') });
        rows.push({ title: 'Temperature', sub: chat.temperature == null ? 'the model default' : String(chat.temperature) });
        rows.push({ title: 'Context size', sub: chat.context_size ? chat.context_size + ' characters of history' : 'the model decides' });
        if (chat.persona) rows.push({ title: 'Your persona', sub: chat.persona });
        const context = saw && Array.isArray(saw.context) ? saw.context : [];
        const contextHtml = context.length
            ? '<ol class="ex-saw-context">' + context.map((m) => '<li><b>' + esc(m.role) + '</b> ' + esc(String(m.content).slice(0, 400)) + '</li>').join('') + '</ol>'
            : '<p class="ex-muted">Nothing yet.</p>';
        const systemHtml = saw && saw.system ? '<pre class="ex-saw-system">' + esc(saw.system) + '</pre>' : '<p class="ex-muted">Nothing yet.</p>';
        return thread.panel({
            id: 'ovt-panel',
            title: 'What the model saw',
            sections: [
                { title: 'The card', rows },
                { title: 'The system prompt', html: systemHtml },
                { title: 'The context sent', html: contextHtml },
            ],
        });
    }

    /**
     * The settings, behind the chip in the header: the model or the preset, the temperature, the context size and the
     * persona the person plays. The fields belong to the composer's form (form="ovt-composer"), so they travel with
     * every message, and the chip opens them without a line of script.
     */
    function chatSettings(chat, models) {
        const selected = chat.model;
        const options = models.slice(0, 40).map((m) => '<option value="' + esc(m.slug) + '"' + (selected === m.slug ? ' selected' : '') + '>' + esc(m.name + (m.uncensored ? ' · 18+' : '')) + '</option>').join('');
        const found = models.find((m) => m.slug === chat.model);
        const label = found ? found.name : (chat.model || chat.preset || 'Auto');
        return '<details class="ex-chat-settings">'
            + '<summary class="ex-chip ex-chat-chip" title="The model, the preset, the temperature, the context and the persona">'
            + '<span class="ex-chat-chip-label">' + esc(label) + '</span>'
            + '<span class="ex-chat-chip-caret" aria-hidden="true">▾</span>'
            + '</summary>'
            + '<div class="ex-chat-settings-body">'
            + '<label class="ex-label" for="ex-model">Model</label>'
            + '<select id="ex-model" name="model" form="ovt-composer"><option value="">Let the router choose</option>' + options + '</select>'
            + '<label class="ex-label" for="ex-preset">Preset (optional)</label>'
            + '<input id="ex-preset" name="preset" form="ovt-composer" type="text" value="' + esc(chat.preset || '') + '" maxlength="120" placeholder="the preset name">'
            + '<label class="ex-label" for="ex-temp">Temperature</label>'
            + '<input id="ex-temp" name="temperature" form="ovt-composer" type="number" min="0" max="2" step="0.1" value="' + (chat.temperature == null ? '' : esc(chat.temperature)) + '">'
            + '<label class="ex-label" for="ex-context">Context size (characters of history)</label>'
            + '<input id="ex-context" name="context_size" form="ovt-composer" type="number" min="2000" max="200000" step="1000" value="' + (chat.context_size == null ? '' : esc(chat.context_size)) + '">'
            + '<label class="ex-label" for="ex-persona">The persona you play</label>'
            + '<textarea id="ex-persona" name="persona" form="ovt-composer" rows="2" maxlength="2000">' + esc(chat.persona || '') + '</textarea>'
            + '</div></details>';
    }

    /** The chat's header: the character's face (or its monogram), its name, and the model it talks on, as a chip. */
    function chatHead(card, chat, models) {
        const face = card.avatar_url
            ? '<img class="ex-chat-face" src="' + esc(card.avatar_url) + '" alt="" width="32" height="32">'
            : views.monogram(card.name, 'ex-chat-face ex-mono');
        return '<header class="ovt-head ex-chat-head" data-ovt-head>'
            + kit.sidebarButton({ id: 'ovt-chats', label: 'Your chats' })
            + '<div class="ex-chat-id">' + face + '<h1 class="ovt-title ex-chat-title">' + esc(card.name) + '</h1></div>'
            + chatSettings(chat, models)
            + '<a class="ovt-btn ex-chat-new" href="/companions" aria-label="Characters">' + thread.icon('plus') + '</a>'
            + '<button type="button" class="ovt-btn ovt-panel-open" data-ovt-panel-open aria-controls="ovt-panel" aria-expanded="false" aria-label="What the model saw" title="What the model saw">' + thread.icon('panel') + '</button>'
            + '</header>';
    }

    function composerFor(chat, card, problem) {
        return thread.composer({
            action: '/talk/' + encodeURIComponent(chat.id) + '/send',
            name: 'text',
            placeholder: 'Say something…',
            id: 'ovt-composer',
            top: problem ? kit.notice({ kind: 'error', text: problem }) : '',
            maxlength: config.chat.maxChars,
            note: 'Your own daily allowance. The hard floor holds on every model and every character.',
        });
    }

    async function renderChat(req, res, chat, card, { problem = null, status = 200 } = {}) {
        const messages = await companionChats.messages(chat.id);
        const query = req.query || {};
        const turns = readTurns(messages, query);
        const models = await chatModels();
        const list = await companionChats.list(owner(req));
        const items = list.map((c) => ({ href: '/talk/' + c.id, title: c.character_name || c.title, current: c.id === chat.id, at: c.updated_at }));
        const sidebar = thread.sidebar({
            newHref: '/companions', newLabel: 'Characters', findAction: '/companions', findPlaceholder: 'Find a character',
            groups: thread.group(items, (c) => c.at || Date.now()),
            nav: [{ href: '/companions', label: 'Characters', icon: 'person' }, { href: '/models', label: 'Models', icon: 'spark' }],
        });
        const empty = '<div class="ovt-welcome"><h2>' + esc(card.name) + '</h2><p>' + esc(card.description || 'Say something to begin.') + '</p></div>';
        const body = thread.page({
            sidebar,
            head: chatHead(card, chat, models),
            turns: turns.map((t) => turnHtml(chat, card, t, query)),
            empty,
            composer: chat.ended_at ? '' : composerFor(chat, card, problem),
            panel: sawPanel(chat, card, turns),
        });
        return page(req, res, {
            title: card.name, index: false, class: 'ex-chat ex-companion-chat', app: true,
            bodyClass: 'ex-app ex-companion-shell',
            head: '<link rel="stylesheet" href="' + require('openvibe-shared/serve').url('thread.css') + '"><script src="' + require('openvibe-shared/serve').url('ov-thread.js') + '" defer></script>',
            body: raw(body),
        }, status);
    }

    /** Save the settings the composer carries, and answer. */
    async function answerTurn(req, res, chat, card, { userMessage, turnId, variant }) {
        const settings = await companionChats.settings(owner(req), chat.id, {
            // The model the person chose in the header travels with the message; an empty choice is "let the router
            // pick", and it is remembered as such.
            model: req.body && 'model' in req.body ? (String(req.body.model || '').slice(0, 120) || null) : chat.model,
            preset: req.body && req.body.preset !== undefined ? String(req.body.preset || '').slice(0, 120) : chat.preset,
            temperature: req.body && req.body.temperature !== undefined ? (req.body.temperature === '' ? null : Number(req.body.temperature)) : chat.temperature,
            context_size: req.body && req.body.context_size !== undefined ? (req.body.context_size === '' ? null : Number(req.body.context_size)) : chat.context_size,
            persona: req.body && req.body.persona !== undefined ? String(req.body.persona || '').slice(0, 2000) : chat.persona,
        });
        const messages = await companionChats.messages(chat.id);
        const turns = readTurns(messages, req.query || {});
        const history = contextTurns(turns, settings.context_size);
        const seen = [];
        for (const t of history) {
            // The message being answered is already in the tree: it is added once, at the end, and the turn it
            // belongs to is left out here, so the model never sees the same message twice.
            if (t.user.id === userMessage.id) continue;
            seen.push({ role: 'user', content: t.user.content });
            if (t.answer && t.answer.content) seen.push({ role: 'assistant', content: t.answer.content });
        }
        const system = systemPromptFor(card, settings);
        const asked = seen.concat([{ role: 'user', content: userMessage.content }]);
        const adultOk = await isAdult(req);
        const model = await modelIdOf(settings.model || card.model);
        try {
            const out = await ai.chat({
                model,
                messages: [{ role: 'system', content: system }].concat(asked),
                temperature: settings.temperature,
                subject: owner(req),
                policy: card.rating === 'adult' && adultOk ? 'uncensored' : 'standard',
                preset: settings.preset || null,
                max_cost_usd: config.companions.maxCostUsd,
            });
            const answer = out.content || '(no text)';
            const check = floor.check(answer);
            if (!check.ok) {
                // The answer breaks the floor: it is never delivered, the chat ends, the account is reviewed.
                await companionChats.append({
                    owner: owner(req), chatId: chat.id, role: 'assistant', content: null,
                    turnId, variant, parentId: userMessage.id, model: settings.model || null,
                    meta: { error: 'floor', rule: check.rule, label: check.label, review: true, saw: { system, context: asked, model } },
                });
                await ctx.s.db.prepare('UPDATE exchange_companion_chats SET ended_at = now() WHERE id = ? AND owner = ?').run(chat.id, owner(req));
                log.warn('[Companions] the answer broke the hard floor (' + check.rule + '); the chat ended and the account is reviewed.');
                return renderChat(req, res, chat, card, { problem: 'That answer broke the hard floor, so it was not delivered. The chat has ended and the account is reviewed.', status: 403 });
            }
            await companionChats.append({
                owner: owner(req), chatId: chat.id, role: 'assistant', content: answer,
                turnId, variant, parentId: userMessage.id, model: settings.model || null,
                meta: {
                    run_id: out.run_id, provider: out.provider, answered_model: out.model, cost_usd: out.cost_usd,
                    tokens_in: out.tokens_in, tokens_out: out.tokens_out, latency_ms: out.latency_ms, why: out.why,
                    saw: { system, context: asked, model: out.model || model, temperature: settings.temperature },
                },
            });
        } catch (err) {
            await companionChats.append({
                owner: owner(req), chatId: chat.id, role: 'assistant', content: null,
                turnId, variant, parentId: userMessage.id, model: settings.model || null,
                meta: { error: String(err.message || 'the model did not answer').slice(0, 400), code: err.code || null },
            });
        }
        return res.redirect(303, '/talk/' + chat.id);
    }

    r.get('/talk/:id', async (req, res) => {
        if (!signedIn(req)) return signInPage(req, res, { title: 'Sign in to talk', text: 'Your chat stays in your account.', next: req.originalUrl });
        const chat = await companionChats.get(owner(req), req.params.id);
        if (!chat) return page(req, res, { title: 'Not found', index: false, body: raw('<div class="ex-wrap ex-narrow">' + kit.empty({ icon: 'chat', title: 'No such chat', text: 'It may have been deleted.' }) + '</div>') }, 404);
        const card = await characters.get(owner(req), chat.character_id);
        if (!card) return page(req, res, { title: 'Not found', index: false, body: raw('<div class="ex-wrap ex-narrow">' + kit.empty({ icon: 'chat', title: 'No such character' }) + '</div>') }, 404);
        return renderChat(req, res, chat, card);
    });

    r.post('/talk/:id/send', async (req, res) => {
        if (!signedIn(req)) return signInPage(req, res, { title: 'Sign in to talk', text: 'Your chat stays in your account.', next: req.originalUrl });
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const chat = await companionChats.get(owner(req), req.params.id);
        if (!chat) return page(req, res, { title: 'Not found', index: false, body: raw('<div class="ex-wrap ex-narrow">' + kit.empty({ icon: 'chat', title: 'No such chat' }) + '</div>') }, 404);
        const card = await characters.get(owner(req), chat.character_id);
        if (!card) return page(req, res, { title: 'Not found', index: false, body: raw('<div class="ex-wrap ex-narrow">' + kit.empty({ icon: 'chat', title: 'No such character' }) + '</div>') }, 404);
        if (chat.ended_at) return renderChat(req, res, chat, card, { problem: 'This chat ended.', status: 403 });
        const text = String((req.body && req.body.text) || '').slice(0, config.chat.maxChars).trim();
        if (!text) return renderChat(req, res, chat, card, { problem: 'Write something to send.', status: 422 });
        const input = floor.check(text);
        if (!input.ok) return renderChat(req, res, chat, card, { problem: 'That request is refused: ' + input.detail + ' (' + input.label + ').', status: 422 });
        const used = await companionChats.countToday(owner(req));
        if (used >= config.companions.perDay) {
            return renderChat(req, res, chat, card, { problem: 'That is today&#39;s ' + config.companions.perDay + ' answers. The allowance resets at midnight UTC.', status: 429 });
        }
        const turnId = ctx.s.newId('ext');
        const userMessage = { id: ctx.s.newId('exm'), content: text };
        await companionChats.append({
            owner: owner(req), chatId: chat.id, role: 'user', content: text,
            turnId, variant: 0, parentId: null, meta: {},
        });
        const saved = await companionChats.messages(chat.id);
        const mine = saved.filter((m) => m.turn_id === turnId && m.role === 'user');
        const user = mine[mine.length - 1];
        return answerTurn(req, res, chat, card, { userMessage: user, turnId, variant: 0 });
    });

    /** Edit a message: the edit becomes another branch of the same turn, and the tree keeps both. */
    r.post('/talk/:id/edit', async (req, res) => {
        if (!signedIn(req)) return signInPage(req, res, { title: 'Sign in to talk', text: 'Your chat stays in your account.', next: req.originalUrl });
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const chat = await companionChats.get(owner(req), req.params.id);
        if (!chat) return page(req, res, { title: 'Not found', index: false, body: raw('<div class="ex-wrap ex-narrow">' + kit.empty({ icon: 'chat', title: 'No such chat' }) + '</div>') }, 404);
        const card = await characters.get(owner(req), chat.character_id);
        if (!card) return page(req, res, { title: 'Not found', index: false, body: raw('<div class="ex-wrap ex-narrow">' + kit.empty({ icon: 'chat', title: 'No such character' }) + '</div>') }, 404);
        const messageId = String((req.body && req.body.message) || '');
        const messages = await companionChats.messages(chat.id);
        const original = messages.find((m) => m.id === messageId && m.role === 'user');
        if (!original) return renderChat(req, res, chat, card, { problem: 'That message is not in this chat.', status: 404 });
        const text = String((req.body && req.body.text) || '').slice(0, config.chat.maxChars).trim();
        if (!text) return renderChat(req, res, chat, card, { problem: 'Write something to send.', status: 422 });
        const check = floor.check(text);
        if (!check.ok) return renderChat(req, res, chat, card, { problem: 'That request is refused: ' + check.detail + ' (' + check.label + ').', status: 422 });
        const variant = await companionChats.nextVariant(chat.id, original.turn_id);
        await companionChats.append({
            owner: owner(req), chatId: chat.id, role: 'user', content: text,
            turnId: original.turn_id, variant, parentId: null, meta: { edited_from: original.id },
        });
        const after = await companionChats.messages(chat.id);
        const mine = after.filter((m) => m.turn_id === original.turn_id && m.role === 'user');
        const user = mine[mine.length - 1];
        return answerTurn(req, res, chat, card, { userMessage: user, turnId: original.turn_id, variant });
    });

    /** Regenerate: another answer to the same message, kept as a branch. */
    r.post('/talk/:id/regenerate', async (req, res) => {
        if (!signedIn(req)) return signInPage(req, res, { title: 'Sign in to talk', text: 'Your chat stays in your account.', next: req.originalUrl });
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const chat = await companionChats.get(owner(req), req.params.id);
        if (!chat) return page(req, res, { title: 'Not found', index: false, body: raw('<div class="ex-wrap ex-narrow">' + kit.empty({ icon: 'chat', title: 'No such chat' }) + '</div>') }, 404);
        const card = await characters.get(owner(req), chat.character_id);
        if (!card) return page(req, res, { title: 'Not found', index: false, body: raw('<div class="ex-wrap ex-narrow">' + kit.empty({ icon: 'chat', title: 'No such character' }) + '</div>') }, 404);
        const messageId = String((req.body && req.body.message) || '');
        const messages = await companionChats.messages(chat.id);
        const original = messages.find((m) => m.id === messageId && m.role === 'user');
        if (!original) return renderChat(req, res, chat, card, { problem: 'That message is not in this chat.', status: 404 });
        const variant = await companionChats.nextVariant(chat.id, original.turn_id, original.id);
        return answerTurn(req, res, chat, card, { userMessage: original, turnId: original.turn_id, variant });
    });

    r.post('/talk/:id/delete', async (req, res) => {
        if (!signedIn(req)) return res.redirect(303, '/companions');
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        await companionChats.remove(owner(req), req.params.id);
        return res.redirect(303, '/companions');
    });

    return r;
}

module.exports = { createCompanionRoutes };
