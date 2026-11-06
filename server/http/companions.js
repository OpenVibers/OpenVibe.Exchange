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
const ovServe = require('openvibe-shared/serve');
const thread = require('openvibe-shared/thread');
const { asyncRouter } = require('./router');
const { sameOrigin } = require('./principal');
const { esc, raw } = require('../render/html');
const { send } = require('../render/layout');
const views = require('../views/companions');
const exchangeViews = require('../views/exchange');
const floor = require('../companions/floor');
const codec = require('../companions/codec');
const { tokensOf, KINDS: NOTE_KINDS } = require('../companions/memory');
const { readTurns } = require('../companions/store');
const multer = require('multer');

const handleOf = (name) => String(name || 'someone').toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'someone';
const tagsOf = (s) => String(s || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 5);

function createCompanionRoutes(ctx) {
    const { config, ai, adult, adultAccount, characters, companionChats, sharing, memory, notes, lorebooks, locker, noteTaker, log } = ctx;
    const db = ctx.s && ctx.s.db;
    const r = asyncRouter();
    // A card may arrive as a file (a PNG with the card inside, or plain JSON).
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
    r.use(express.urlencoded({ extended: false, limit: '256kb' }));

    const page = (req, res, o, status = 200) => send(res, status, { viewer: req.viewer, config, path: req.originalUrl, ...o });
    const signedIn = (req) => Boolean(req.viewer && req.viewer.kind === 'user' && req.viewer.subject);
    const owner = (req) => req.viewer.subject;
    const shareHead = `<link rel="stylesheet" href="${ovServe.url('ov-share.css')}"><script src="${ovServe.url('ov-share.js')}" defer></script>`;
    /** Specific people, and this reader is not on the list: the audience, never the card's text. */
    function gatePage(req, res, id) {
        const signedInAs = signedIn(req) ? (req.viewer.username || '') : '';
        const signInUrl = `/auth/login?next=${encodeURIComponent(req.originalUrl)}`;
        return page(req, res, {
            title: 'Shared with specific people', index: false, head: shareHead,
            // The gate draws itself from this markup (openvibe-shared 4.123.0's [data-ov-share-gate]): no inline
            // script, so a strict CSP needs nothing, and every value is escaped like any other attribute.
            body: raw(`<div class="ex-wrap ex-narrow"><div id="share-gate" data-ov-share-gate data-kind="character" data-id="${esc(id)}" data-signed-in-as="${esc(signedInAs)}" data-sign-in-url="${esc(signInUrl)}">This character is shared with specific people. Sign in with the OpenVibe account it was shared with, or ask its creator for access.</div></div>`),
        }, 404);
    }
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

    const tokenOf = (req) => req.token || (req.viewer && req.viewer.token) || null;

    /** The person's Locker public keys, or null when they have no Locker (or it cannot be read). */
    async function lockerKeys(req) {
        try {
            return await locker.keysFor(owner(req), tokenOf(req));
        } catch (err) {
            log.warn('[Companions] the Locker keys could not be read:', String((err && err.message) || err).slice(0, 200));
            return null;
        }
    }

    /** The character's lock row: when it is there, the notes and the chats of the character are sealed. */
    async function lockRow(characterId, subject) {
        if (!subject) return null;
        return await db.prepare('SELECT * FROM exchange_companion_locks WHERE owner = ? AND character_id = ?')
            .get(subject, String(characterId)) || null;
    }

    /** Seal a text with the person's Locker keys, for a locked character. */
    function protectWith(keys) {
        if (!keys) return null;
        return (text) => locker.seal(String(text == null ? '' : text), keys);
    }

    /**
     * The bundle a locked chat's browser sends with a turn: the turns it opened, the texts of the messages it may
     * regenerate, and the notes it opened. The server has no other way to see them: at rest they are envelopes.
     */
    function parseLockerContext(req) {
        const raw = req.body && req.body.locker_context;
        if (!raw) return null;
        let body = null;
        try { body = JSON.parse(String(raw)); } catch (e) { return null; }
        if (!body || typeof body !== 'object') return null;
        const history = (Array.isArray(body.history) ? body.history : [])
            .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
            .slice(-200)
            .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }));
        const messages = {};
        if (body.messages && typeof body.messages === 'object' && !Array.isArray(body.messages)) {
            for (const [id, text] of Object.entries(body.messages)) {
                if (typeof text === 'string') messages[String(id)] = text.slice(0, 8000);
            }
        }
        const noteList = (Array.isArray(body.notes) ? body.notes : [])
            .filter((n) => n && typeof n.text === 'string' && n.text.trim())
            .map((n) => ({
                id: String(n.id || '').slice(0, 80),
                m2_id: String(n.m2_id || '').slice(0, 80),
                kind: ['fact', 'preference', 'event'].includes(String(n.kind)) ? String(n.kind) : 'fact',
                text: String(n.text).slice(0, 2000),
                pinned: n.pinned === true,
            }));
        return { history, messages, notes: noteList };
    }

    /** The turns the model sees in a locked chat, within the context size, newest last. */
    function lockedHistory(bundle, contextSize) {
        const limit = Math.max(2000, Number(contextSize) || 0);
        const out = [];
        let chars = 0;
        const list = (bundle && bundle.history) || [];
        for (let i = list.length - 1; i >= 0; i--) {
            const m = list[i];
            if (out.length && chars + m.content.length > limit) break;
            chars += m.content.length;
            out.unshift({ role: m.role, content: m.content });
        }
        return out;
    }

    /** The decrypted notes a locked chat's browser sent, pinned first, within the note budget. */
    function lockedNotes(bundle, budgetTokens) {
        const ordered = [...((bundle && bundle.notes) || [])].sort((a, b) => Number(b.pinned) - Number(a.pinned));
        const used = [];
        let usedTokens = 0;
        for (const note of ordered) {
            const cost = tokensOf(note.kind + ': ' + note.text);
            if (usedTokens + cost > budgetTokens) continue;
            used.push(note);
            usedTokens += cost;
        }
        return { notes: used, usedTokens, budgetTokens };
    }

    /** The notes that join a context, read from M2 in a plain (unlocked) chat. */
    async function contextNotes(req, card) {
        const budgetTokens = config.companions.memoryBudgetTokens;
        try {
            return await notes.forContext(owner(req), card.id, tokenOf(req), { budgetTokens });
        } catch (err) {
            log.warn('[Companions] the notes could not be read:', String((err && err.message) || err).slice(0, 200));
            return { notes: [], usedTokens: 0, budgetTokens };
        }
    }

    /** The lorebook entries that join a turn, highest priority first, within the lorebook budget. */
    async function contextEntries(card, chat, subject, recentText) {
        try {
            const books = await lorebooks.booksFor(subject, { characterId: card.id, chatId: chat.id });
            return lorebooks.forContext(books, recentText, { budgetTokens: config.companions.lorebookBudgetTokens });
        } catch (err) {
            log.warn('[Companions] the lorebooks could not be read:', String((err && err.message) || err).slice(0, 200));
            return { entries: [], usedTokens: 0, budgetTokens: config.companions.lorebookBudgetTokens };
        }
    }

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
            body: raw(views.galleryPage({
                items: gallery.items, total: gallery.total, q, tags, sort, tagList, viewer: req.viewer, adult: adultOk, mine,
                defaults: signedIn(req) ? exchangeViews.audienceDefaults({
                    kind: 'character', label: 'characters', action: '/companions/defaults', signedIn: true,
                    current: await sharing.defaultOf(owner(req), 'character').catch(() => 'private'),
                }) : '',
            })),
        });
    });

    /** The creator's default for new cards ("New characters: Only me"), and what to do with the existing ones. */
    r.post('/companions/defaults', async (req, res) => {
        if (!signedIn(req)) return res.redirect(303, '/auth/login?next=%2Fcompanions');
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const body = req.body || {};
        const audience = ['private', 'people', 'link', 'public'].includes(body.audience) ? body.audience : 'private';
        await sharing.setDefault(owner(req), 'character', audience, { applyAll: String(body.apply_all || '') === '1' }).catch((err) => log.warn('[Companions] the card default was not saved:', err.message));
        return res.redirect(303, '/companions');
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
            await sharing.register({ subject: owner(req) }, 'character', made.id, await sharing.defaultOf(owner(req), 'character').catch(() => 'private'));
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
            await sharing.setAudience({ subject: owner(req) }, 'character', card.id, audience);
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
            await sharing.register({ subject: owner(req) }, 'character', copy.id, await sharing.defaultOf(owner(req), 'character').catch(() => 'private'));
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
        const canSee = await sharing.canView(req.viewer, 'character', card.id).catch(() => false);
        if (!canSee && !mine) {
            res.set('X-Robots-Tag', 'noindex, nofollow');
            const audience = await sharing.audienceOf('character', card.id).catch(() => null);
            if (audience === 'people') return gatePage(req, res, card.id);
            return page(req, res, { title: 'Private', index: false, body: raw('<div class="ex-wrap ex-narrow">' + kit.empty({ icon: 'shield', title: 'This character is private', text: 'Its creator has not shared it yet.' }) + '</div>') }, 403);
        }
        await characters.addView(card.id, signedIn(req) ? owner(req) : null);
        const [tags, remixes] = await Promise.all([characters.tagsOf(card.id), characters.countRemixes(card.id)]);
        return page(req, res, {
            index: card.rating !== 'adult',
            title: card.name,
            description: String(card.description || card.name).slice(0, 160),
            head: shareHead,
            body: raw(views.characterPage({
                card, tags, viewer: req.viewer, mine, remixes, allowRemix: card.allow_remix,
                share: mine ? `<button type="button" class="ex-btn" data-ov-share-sheet data-kind="character" data-id="${esc(card.id)}" data-title="${esc(card.name)}">Share</button>` : '',
            })),
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
        // A character whose Locker is on gets every new chat locked from its first message.
        const lock = await lockRow(card.id, owner(req)).catch(() => null);
        if (lock) {
            await db.prepare('UPDATE exchange_companion_chats SET locked = true, locker_fingerprint = ? WHERE id = ? AND owner = ?')
                .run(lock.fingerprint || null, chat.id, owner(req));
        }
        return res.redirect(303, '/talk/' + chat.id);
    });

    // ── Memory and lorebooks: the panels of a character ─────────────────────
    /** The card a page is about, with the same sharing and 18+ rules as its own page. */
    async function cardFor(req, res) {
        const card = await characters.bySlug(req.params.handle, req.params.character);
        if (!card) {
            page(req, res, { title: 'Not found', index: false, body: raw('<div class="ex-wrap ex-narrow">' + kit.empty({ icon: 'search', title: 'No such character', text: 'There is no card at this address.' }) + '</div>') }, 404);
            return null;
        }
        const adultOk = await isAdult(req);
        if (card.rating === 'adult' && !adultOk) {
            res.set('X-Robots-Tag', 'noindex, nofollow');
            page(req, res, { title: '18+', index: false, body: raw(views.adultGate()) }, 403);
            return null;
        }
        const mine = signedIn(req) && card.owner === owner(req);
        const canSee = await sharing.canView(req.viewer, 'character', card.id).catch(() => false);
        if (!canSee && !mine) {
            res.set('X-Robots-Tag', 'noindex, nofollow');
            page(req, res, { title: 'Private', index: false, body: raw('<div class="ex-wrap ex-narrow">' + kit.empty({ icon: 'shield', title: 'This character is private', text: 'Its creator has not shared it yet.' }) + '</div>') }, 403);
            return null;
        }
        return card;
    }

    async function memoryView(req, res, card, { problem = null, notice = null, status = 200 } = {}) {
        const lock = await lockRow(card.id, owner(req)).catch(() => null);
        let list = [];
        let readProblem = problem;
        try {
            list = await notes.list(owner(req), card.id, tokenOf(req));
        } catch (err) {
            readProblem = readProblem || ('Your memory could not be read: ' + String((err && err.message) || err).slice(0, 200));
        }
        return page(req, res, {
            title: 'Memory: ' + card.name, index: false,
            head: lock ? '<link rel="stylesheet" href="' + require('openvibe-shared/serve').url('ov-locker.css') + '"><script src="' + require('openvibe-shared/serve').url('ov-locker.js') + '" defer></script><script src="/js/companions-locker.js" defer></script>' : '',
            body: raw(views.memoryPage({ card, notes: list, locked: Boolean(lock), lock, problem: readProblem, notice })),
        }, status);
    }

    r.get('/c/:handle/:character/memory', async (req, res) => {
        if (!signedIn(req)) return signInPage(req, res, { title: 'Sign in to see your memory', text: 'The notes live in your account, not in the character.', next: req.originalUrl });
        const card = await cardFor(req, res);
        if (!card) return undefined;
        return memoryView(req, res, card);
    });

    r.post('/c/:handle/:character/memory/add', async (req, res) => {
        if (!signedIn(req)) return signInPage(req, res, { title: 'Sign in to keep a note', text: 'The notes live in your account.', next: req.originalUrl });
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const card = await cardFor(req, res);
        if (!card) return undefined;
        const lock = await lockRow(card.id, owner(req)).catch(() => null);
        const keys = lock ? await lockerKeys(req) : null;
        if (lock && !keys) return memoryView(req, res, card, { problem: 'This character is sealed with your Locker, and your keys could not be read. Nothing was written.', status: 409 });
        try {
            await notes.add(owner(req), card.id, {
                kind: (req.body && req.body.kind) || 'fact',
                text: (req.body && req.body.text) || '',
                origin: 'person',
            }, tokenOf(req), protectWith(keys));
            return memoryView(req, res, card, { notice: 'The note was saved.' });
        } catch (err) {
            return memoryView(req, res, card, { problem: String((err && err.message) || err).slice(0, 300), status: 422 });
        }
    });

    async function oneNote(req, res, card, act) {
        if (!signedIn(req)) return signInPage(req, res, { title: 'Sign in first', text: 'The notes live in your account.', next: req.originalUrl });
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        try {
            await act();
            return memoryView(req, res, card, { notice: 'Saved.' });
        } catch (err) {
            return memoryView(req, res, card, { problem: String((err && err.message) || err).slice(0, 300), status: Number(err && err.status) || 422 });
        }
    }

    r.post('/c/:handle/:character/memory/:note/edit', async (req, res) => {
        const card = await cardFor(req, res);
        if (!card) return undefined;
        return oneNote(req, res, card, () => notes.edit(owner(req), req.params.note, { text: (req.body && req.body.text) || '' }, tokenOf(req)));
    });

    r.post('/c/:handle/:character/memory/:note/pin', async (req, res) => {
        const card = await cardFor(req, res);
        if (!card) return undefined;
        return oneNote(req, res, card, () => notes.pin(owner(req), req.params.note, String((req.body && req.body.pinned) || '') === '1'));
    });

    r.post('/c/:handle/:character/memory/:note/delete', async (req, res) => {
        const card = await cardFor(req, res);
        if (!card) return undefined;
        return oneNote(req, res, card, () => notes.remove(owner(req), req.params.note, tokenOf(req)));
    });

    /**
     * Turn the Locker on or off for a character. On: every note and every message of every chat with
     * the character is sealed with the person's keys, then the chats are marked locked. Off: only when
     * nothing is sealed, because the server cannot open what it never had the key for.
     */
    r.post('/c/:handle/:character/lock', async (req, res) => {
        if (!signedIn(req)) return signInPage(req, res, { title: 'Sign in first', text: 'The Locker is yours.', next: req.originalUrl });
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const card = await cardFor(req, res);
        if (!card) return undefined;
        const on = String((req.body && req.body.on) || '') === '1';
        const subject = owner(req);
        const token = tokenOf(req);
        if (!on) {
            const sealedNotes = Number(await db.value('SELECT COUNT(*)::int AS n FROM exchange_companion_notes WHERE owner = $1 AND character_id = $2 AND sealed = true', [subject, card.id])) || 0;
            const sealedMessages = Number(await db.value("SELECT COUNT(*)::int AS n FROM exchange_companion_messages m JOIN exchange_companion_chats c ON c.id = m.chat_id WHERE c.owner = $1 AND c.character_id = $2 AND m.meta LIKE '%\"sealed\":true%'", [subject, card.id])) || 0;
            if (sealedNotes || sealedMessages) {
                return memoryView(req, res, card, { problem: 'This character stays locked: ' + (sealedNotes + sealedMessages) + ' notes and messages are sealed, and only your keys open them. OpenVibe cannot turn them back into text.', status: 409 });
            }
            await db.prepare('DELETE FROM exchange_companion_locks WHERE owner = ? AND character_id = ?').run(subject, card.id);
            await db.prepare('UPDATE exchange_companion_chats SET locked = false, locker_fingerprint = NULL WHERE owner = ? AND character_id = ?').run(subject, card.id);
            return memoryView(req, res, card, { notice: 'The Locker is off for this character.' });
        }
        const keys = await lockerKeys(req);
        if (!keys) return memoryView(req, res, card, { problem: 'You have no Locker keys yet. Set up your Locker first, then turn it on here.', status: 409 });
        try {
            // The notes: everything not sealed yet is sealed now.
            const list = await notes.list(subject, card.id, token);
            for (const note of list) {
                if (note.sealed) continue;
                const sealed = await locker.seal(note.text, keys);
                await memory.patch(token, note.m2_id, { text: sealed });
                await db.prepare('UPDATE exchange_companion_notes SET sealed = true, updated_at = now() WHERE id = ? AND owner = ?').run(note.id, subject);
            }
            // The chats: every message in the character's chats, and the chats are marked locked.
            const chats = await db.prepare('SELECT id FROM exchange_companion_chats WHERE owner = ? AND character_id = ?').all(subject, card.id);
            for (const chat of chats) {
                const messages = await companionChats.messages(chat.id);
                for (const message of messages) {
                    if (message.content == null || (message.meta && message.meta.sealed)) continue;
                    const sealed = await locker.seal(message.content, keys);
                    await db.prepare('UPDATE exchange_companion_messages SET content = ?, meta = ? WHERE id = ? AND owner = ?')
                        .run(sealed, JSON.stringify({ ...(message.meta || {}), sealed: true }), message.id, subject);
                }
            }
            await db.prepare('INSERT INTO exchange_companion_locks (owner, character_id, fingerprint) VALUES (?, ?, ?) ON CONFLICT (owner, character_id) DO UPDATE SET fingerprint = excluded.fingerprint, updated_at = now()')
                .run(subject, card.id, keys.fingerprint || null);
            await db.prepare('UPDATE exchange_companion_chats SET locked = true, locker_fingerprint = ? WHERE owner = ? AND character_id = ?')
                .run(keys.fingerprint || null, subject, card.id);
            return memoryView(req, res, card, { notice: 'The Locker is on. The notes and the chats of this character are sealed with your keys.' });
        } catch (err) {
            log.warn('[Companions] the character could not be locked:', String((err && err.message) || err).slice(0, 200));
            return memoryView(req, res, card, { problem: 'The Locker could not be turned on: ' + String((err && err.message) || err).slice(0, 200), status: 409 });
        }
    });

    async function lorebookView(req, res, card, { problem = null, notice = null, status = 200 } = {}) {
        const chatId = String((req.query && req.query.chat) || (req.body && req.body.chat_id) || '');
        const chat = chatId ? await companionChats.get(owner(req), chatId).catch(() => null) : null;
        const scopedChat = chat && chat.character_id === card.id ? chat : null;
        const books = await lorebooks.booksFor(owner(req), { characterId: card.id, chatId: scopedChat ? scopedChat.id : null }).catch(() => []);
        return page(req, res, {
            title: 'Lorebooks: ' + card.name, index: false,
            body: raw(views.lorebookPage({ card, books, chat: scopedChat, problem, notice })),
        }, status);
    }

    /** The book, if it is the person's and belongs to this character (or their world). */
    async function bookFor(ownerSubject, card, bookId, chatId = '') {
        const book = await lorebooks.book(ownerSubject, bookId).catch(() => null);
        if (!book) return null;
        if (book.scope === 'person') return book;
        if (book.scope === 'character' && book.character_id === card.id) return book;
        if (book.scope === 'chat' && chatId && book.chat_id === chatId) return book;
        return null;
    }

    r.get('/c/:handle/:character/lorebook', async (req, res) => {
        if (!signedIn(req)) return signInPage(req, res, { title: 'Sign in to keep a lorebook', text: 'Lorebooks live in your account.', next: req.originalUrl });
        const card = await cardFor(req, res);
        if (!card) return undefined;
        return lorebookView(req, res, card);
    });

    r.post('/c/:handle/:character/lorebook', async (req, res) => {
        if (!signedIn(req)) return signInPage(req, res, { title: 'Sign in first', text: 'Lorebooks live in your account.', next: req.originalUrl });
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const card = await cardFor(req, res);
        if (!card) return undefined;
        let scope = ['person', 'character', 'chat'].includes(String((req.body && req.body.scope) || '')) ? String(req.body.scope) : 'person';
        let chatId = String((req.body && req.body.chat_id) || '') || null;
        if (scope === 'chat') {
            const chat = chatId ? await companionChats.get(owner(req), chatId).catch(() => null) : null;
            if (!chat || chat.character_id !== card.id) return lorebookView(req, res, card, { problem: 'A chat lorebook needs one of your chats with this character.', status: 422 });
        } else {
            chatId = null;
        }
        try {
            await lorebooks.create(owner(req), { name: (req.body && req.body.name) || 'A lorebook', scope, characterId: card.id, chatId });
            const query = scope === 'chat' ? '?chat=' + encodeURIComponent(chatId) : '';
            return res.redirect(303, '/c/' + encodeURIComponent(card.handle) + '/' + encodeURIComponent(card.slug) + '/lorebook' + query);
        } catch (err) {
            return lorebookView(req, res, card, { problem: String((err && err.message) || err).slice(0, 300), status: 422 });
        }
    });

    async function onBook(req, res, act) {
        if (!signedIn(req)) return signInPage(req, res, { title: 'Sign in first', text: 'Lorebooks live in your account.', next: req.originalUrl });
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const card = await cardFor(req, res);
        if (!card) return undefined;
        const chatId = String((req.query && req.query.chat) || (req.body && req.body.chat_id) || '');
        const book = await bookFor(owner(req), card, req.params.book, chatId);
        if (!book) return lorebookView(req, res, card, { problem: 'No such lorebook.', status: 404 });
        try {
            const out = await act(book);
            if (out && out.redirect) return res.redirect(303, out.redirect);
            return lorebookView(req, res, card, { notice: out && out.notice ? out.notice : 'Saved.' });
        } catch (err) {
            return lorebookView(req, res, card, { problem: String((err && err.message) || err).slice(0, 300), status: Number(err && err.status) || 422 });
        }
    }

    r.post('/c/:handle/:character/lorebook/:book/entries', async (req, res) => onBook(req, res, async (book) => {
        await lorebooks.addEntry(owner(req), book.id, {
            name: (req.body && req.body.name) || '',
            keys: (req.body && req.body.keys) || '',
            content: (req.body && req.body.content) || '',
            priority: (req.body && req.body.priority) || 0,
            constant: Boolean(req.body && req.body.constant),
        });
        return { notice: 'The entry was added.' };
    }));

    r.post('/c/:handle/:character/lorebook/:book/entry/:entry', async (req, res) => onBook(req, res, async () => {
        await lorebooks.editEntry(owner(req), req.params.entry, {
            name: (req.body && req.body.name) || '',
            keys: (req.body && req.body.keys) || '',
            content: (req.body && req.body.content) || '',
            priority: (req.body && req.body.priority) || 0,
            constant: Boolean(req.body && req.body.constant),
        });
        return { notice: 'The entry was saved.' };
    }));

    r.post('/c/:handle/:character/lorebook/:book/entry/:entry/delete', async (req, res) => onBook(req, res, async () => {
        await lorebooks.removeEntry(owner(req), req.params.entry);
        return { notice: 'The entry was deleted.' };
    }));

    r.post('/c/:handle/:character/lorebook/:book/delete', async (req, res) => onBook(req, res, async (book) => {
        await lorebooks.removeBook(owner(req), book.id);
        return { notice: 'The lorebook was deleted.' };
    }));

    r.post('/c/:handle/:character/lorebook/:book/import', upload.single('file'), async (req, res) => onBook(req, res, async (book) => {
        const text = req.file && req.file.buffer && req.file.buffer.length ? req.file.buffer.toString('utf8') : String((req.body && req.body.world_info) || '');
        const made = await lorebooks.importWorldInfo(owner(req), book.id, text);
        return { notice: made.length + ' entries were imported.' };
    }));

    r.get('/c/:handle/:character/lorebook/:book/export', async (req, res) => {
        if (!signedIn(req)) return signInPage(req, res, { title: 'Sign in first', text: 'Lorebooks live in your account.', next: req.originalUrl });
        const card = await characters.bySlug(req.params.handle, req.params.character);
        if (!card) return res.redirect(303, '/companions');
        const book = await bookFor(owner(req), card, req.params.book, String((req.query && req.query.chat) || ''));
        if (!book) return res.redirect(303, '/c/' + encodeURIComponent(card.handle) + '/' + encodeURIComponent(card.slug) + '/lorebook');
        const entries = await lorebooks.entriesOf(owner(req), book.id);
        const out = lorebooks.toWorldInfo([{ ...book, entries }]);
        res.set('Content-Type', 'application/json; charset=utf-8');
        res.set('Content-Disposition', 'attachment; filename="' + String(book.name || 'lorebook').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) + '.worldinfo.json"');
        return res.send(JSON.stringify(out, null, 2));
    });

    // ── Chats: one character, a branching tree, the folded receipt ────────
    function systemPromptFor(card, chat, { notes: notesIn = [], entries = [] } = {}) {
        const lines = ['You are ' + card.name + '.'];
        if (card.description) lines.push(card.description);
        if (card.personality) lines.push('Personality: ' + card.personality);
        if (card.scenario) lines.push('Scenario: ' + card.scenario);
        if (chat.persona) lines.push('The person you talk with plays: ' + chat.persona);
        if (card.first_message) lines.push('Begin with: ' + card.first_message);
        if (notesIn.length) {
            // The person's own memory, within its budget, pinned notes first: the character knows it.
            lines.push('What you remember about the person (their own notes, which they can read and edit):');
            for (const note of notesIn) lines.push('- (' + note.kind + ') ' + note.text);
        }
        if (entries.length) {
            // The lorebook, within its budget, highest priority first.
            lines.push('World info for this conversation (use it when it fits the scene):');
            for (const entry of entries) lines.push('- ' + entry.content);
        }
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
        // A sealed message has no text here to edit: its words are in the person's browser, not on the server.
        if (turn.user.meta && turn.user.meta.sealed) return '';
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
            + ((turn.user.meta && turn.user.meta.sealed)
                ? '<p class="ovt-bubble">' + views.sealedText(turn.user.content, { role: 'user', key: 'm:' + turn.user.id, message: turn.user.id }) + '</p>'
                : '<p class="ovt-bubble">' + esc(turn.user.content) + '</p>')
            + '<div class="ex-acts ex-acts-you">' + editAction(chat, turn) + '</div>'
            + '</div>';
        const answer = turn.answer
            ? '<article class="ex-answer-col">'
                + thread.answer({
                    html: (turn.answer.meta && turn.answer.meta.sealed)
                        ? views.sealedText(turn.answer.content, { role: 'assistant', key: 'm:' + turn.answer.id, message: turn.answer.id })
                        : esc(turn.answer.content || '').split(String.fromCharCode(10)).join('<br>'),
                    meta: [], copy: false,
                })
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

    /** What the model saw: the card, the settings, the notes, the lorebook, the context, the receipt. Nothing hidden. */
    function sawPanel(chat, card, turns) {
        const last = turns.length ? turns[turns.length - 1] : null;
        const saw = (last && last.answer && last.answer.meta && last.answer.meta.saw) || null;
        const locked = Boolean(chat.locked || (saw && saw.locked));
        const rows = [];
        rows.push({ title: 'Character', sub: card.name });
        rows.push({ title: 'Model', sub: saw && saw.model ? saw.model : (chat.model || 'the router picks one') });
        rows.push({ title: 'Temperature', sub: chat.temperature == null ? 'the model default' : String(chat.temperature) });
        rows.push({ title: 'Context size', sub: chat.context_size ? chat.context_size + ' characters of history' : 'the model decides' });
        if (chat.persona) rows.push({ title: 'Your persona', sub: chat.persona });
        if (chat.locked) rows.push({ title: 'Locker', sub: 'on: the history and the notes are sealed at rest' + (chat.locker_fingerprint ? ' (' + chat.locker_fingerprint + ')' : '') });
        const notesIn = saw && Array.isArray(saw.notes) ? saw.notes : [];
        const entriesIn = saw && Array.isArray(saw.lorebook) ? saw.lorebook : [];
        const notesHtml = notesIn.length
            ? '<ul class="ex-saw-list">' + notesIn.map((n) => '<li><b>' + esc(n.kind) + '</b>' + (n.pinned ? ' <span class="ex-chip is-on">pinned</span>' : '') + ' ' + ((n.text && !locked) ? esc(String(n.text).slice(0, 300)) : '<span class="ex-muted">sealed</span>') + ' <span class="ex-muted">(' + Number(n.tokens || 0) + ' tokens)</span></li>').join('') + '</ul>'
                + '<p class="ex-muted">' + Number(saw.notes_used_tokens || 0) + ' of ' + Number(saw.notes_budget_tokens || 0) + ' tokens of notes joined this answer.</p>'
            : '<p class="ex-muted">No notes joined this answer.</p>';
        const entriesHtml = entriesIn.length
            ? '<ul class="ex-saw-list">' + entriesIn.map((e) => '<li><b>' + esc(e.name || 'An entry') + '</b>'
                + (e.keys && e.keys.length ? ' <span class="ex-muted">(' + esc(e.keys.join(', ')) + ')</span>' : '')
                + ((e.text && !locked) ? ': ' + esc(String(e.text).slice(0, 300)) : ' <span class="ex-muted">sealed</span>')
                + ' <span class="ex-muted">priority ' + Number(e.priority || 0) + ' · ' + Number(e.tokens || 0) + ' tokens</span></li>').join('') + '</ul>'
                + '<p class="ex-muted">' + Number(saw.lorebook_used_tokens || 0) + ' of ' + Number(saw.lorebook_budget_tokens || 0) + ' tokens of entries joined this answer.</p>'
            : '<p class="ex-muted">No lorebook entries joined this answer.</p>';
        const context = saw && Array.isArray(saw.context) ? saw.context : [];
        const contextHtml = locked
            ? '<p class="ex-muted">This chat is sealed with your Locker: its history was opened in your browser and sent for this answer only. OpenVibe holds no readable copy.</p>'
            : context.length
                ? '<ol class="ex-saw-context">' + context.map((m) => '<li><b>' + esc(m.role) + '</b> ' + esc(String(m.content).slice(0, 400)) + '</li>').join('') + '</ol>'
                : '<p class="ex-muted">Nothing yet.</p>';
        const systemHtml = locked
            ? '<p class="ex-muted">The system prompt was built from the card and the notes your browser sent. The sealed copy on the server never held it.</p>'
            : saw && saw.system ? '<pre class="ex-saw-system">' + esc(saw.system) + '</pre>' : '<p class="ex-muted">Nothing yet.</p>';
        return thread.panel({
            id: 'ovt-panel',
            title: 'What the model saw',
            sections: [
                { title: 'The card', rows },
                { title: 'Your notes', html: notesHtml },
                { title: 'Lorebook entries', html: entriesHtml },
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
    function chatSettings(chat, models, card) {
        const selected = chat.model;
        const options = models.slice(0, 40).map((m) => '<option value="' + esc(m.slug) + '"' + (selected === m.slug ? ' selected' : '') + '>' + esc(m.name + (m.uncensored ? ' · 18+' : '')) + '</option>').join('');
        const found = models.find((m) => m.slug === chat.model);
        const label = found ? found.name : (chat.model || chat.preset || 'Auto');
        const base = '/c/' + encodeURIComponent(card.handle) + '/' + encodeURIComponent(card.slug);
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
            + '<div class="ex-chat-links">'
            + '<a class="ex-chip" href="' + esc(base + '/memory') + '">Memory' + (chat.locked ? ' · locked' : '') + '</a>'
            + '<a class="ex-chip" href="' + esc(base + '/lorebook?chat=' + encodeURIComponent(chat.id)) + '">Lorebook</a>'
            + (chat.locked ? '<span class="ex-chip">🔒 with your Locker</span>' : '')
            + '</div>'
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
            + chatSettings(chat, models, card)
            + '<a class="ovt-btn ex-chat-new" href="/companions" aria-label="Characters">' + thread.icon('plus') + '</a>'
            + '<button type="button" class="ovt-btn ovt-panel-open" data-ovt-panel-open aria-controls="ovt-panel" aria-expanded="false" aria-label="What the model saw" title="What the model saw">' + thread.icon('panel') + '</button>'
            + '</header>';
    }

    function composerFor(chat, card, problem) {
        const lockedHead = chat.locked
            ? '<div id="ex-locker-note" data-locker-chat><p class="ex-muted">🔒 This chat is sealed with your Locker. Unlock it in this browser to read the older turns.</p></div>'
            : '';
        return thread.composer({
            action: '/talk/' + encodeURIComponent(chat.id) + '/send',
            name: 'text',
            placeholder: 'Say something…',
            id: 'ovt-composer',
            top: lockedHead + (problem ? kit.notice({ kind: 'error', text: problem }) : ''),
            maxlength: config.chat.maxChars,
            note: chat.locked
                ? 'Sealed with your Locker. Unlock it in this browser to read the older turns; what you send is sealed before it is stored, and the opened history is sent for this answer only.'
                : 'Your own daily allowance. The hard floor holds on every model and every character.',
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
        const lockerScripts = chat.locked
            ? '<link rel="stylesheet" href="' + require('openvibe-shared/serve').url('ov-locker.css') + '">'
                + '<script src="' + require('openvibe-shared/serve').url('ov-locker.js') + '" defer></script>'
                + '<script src="/js/companions-locker.js" defer></script>'
            : '';
        return page(req, res, {
            title: card.name, index: false, class: 'ex-chat ex-companion-chat', app: true,
            bodyClass: 'ex-app ex-companion-shell' + (chat.locked ? ' ex-chat-locked' : ''),
            head: '<link rel="stylesheet" href="' + require('openvibe-shared/serve').url('thread.css') + '"><script src="' + require('openvibe-shared/serve').url('ov-thread.js') + '" defer></script>' + lockerScripts,
            body: raw(body),
        }, status);
    }

    /** Save the settings the composer carries, and answer. */
    /** Turn a flat list of messages into the pairs the note taker reads. */
    function pairsOf(flat) {
        const out = [];
        for (let i = 0; i < flat.length; i++) {
            if (flat[i].role !== 'user') continue;
            const answer = flat[i + 1] && flat[i + 1].role === 'assistant' ? flat[i + 1] : null;
            out.push({ user: { content: flat[i].content }, answer: answer ? { content: answer.content } : null });
            if (answer) i++;
        }
        return out;
    }

    async function answerTurn(req, res, chat, card, { userMessage, turnId, variant, plainText = null, lockerBundle = null, keys = null }) {
        const subject = owner(req);
        const token = tokenOf(req);
        const locked = chat.locked === true;
        const settings = await companionChats.settings(subject, chat.id, {
            // The model the person chose in the header travels with the message; an empty choice is "let the router
            // pick", and it is remembered as such.
            model: req.body && 'model' in req.body ? (String(req.body.model || '').slice(0, 120) || null) : chat.model,
            preset: req.body && req.body.preset !== undefined ? String(req.body.preset || '').slice(0, 120) : chat.preset,
            temperature: req.body && req.body.temperature !== undefined ? (req.body.temperature === '' ? null : Number(req.body.temperature)) : chat.temperature,
            context_size: req.body && req.body.context_size !== undefined ? (req.body.context_size === '' ? null : Number(req.body.context_size)) : chat.context_size,
            persona: req.body && req.body.persona !== undefined ? String(req.body.persona || '').slice(0, 2000) : chat.persona,
        });
        const userText = plainText != null ? String(plainText) : String(userMessage.content == null ? '' : userMessage.content);
        const messages = await companionChats.messages(chat.id);
        const turns = readTurns(messages, req.query || {});
        let history;
        let noteResult;
        if (locked) {
            if (!lockerBundle) return renderChat(req, res, chat, card, { problem: 'This chat is sealed with your Locker. Unlock it in this browser and send again: the older turns never reach the server in the clear.', status: 422 });
            if (!keys) return renderChat(req, res, chat, card, { problem: 'Your Locker keys could not be read, so the answer could not be sealed. Nothing was saved.', status: 409 });
            history = lockedHistory(lockerBundle, settings.context_size);
            noteResult = lockedNotes(lockerBundle, config.companions.memoryBudgetTokens);
        } else {
            const context = contextTurns(turns, settings.context_size);
            history = [];
            for (const t of context) {
                // The message being answered is already in the tree: it is added once, at the end, and the turn it
                // belongs to is left out here, so the model never sees the same message twice.
                if (t.user.id === userMessage.id) continue;
                history.push({ role: 'user', content: t.user.content });
                if (t.answer && t.answer.content) history.push({ role: 'assistant', content: t.answer.content });
            }
            noteResult = await contextNotes(req, card);
        }
        const asked = history.concat([{ role: 'user', content: userText }]);
        const recent = asked.slice(-8).map((m) => m.content).join(String.fromCharCode(10));
        const entryResult = await contextEntries(card, chat, subject, recent);
        const system = systemPromptFor(card, settings, { notes: noteResult.notes, entries: entryResult.entries });
        const notesSaw = noteResult.notes.map((n) => ({
            id: n.id || n.m2_id || null, kind: n.kind, pinned: n.pinned === true,
            tokens: tokensOf(n.kind + ': ' + n.text), text: locked ? null : n.text,
        }));
        const entriesSaw = entryResult.entries.map((e) => ({
            id: e.id, name: e.name || '', keys: e.keys || [], priority: Number(e.priority) || 0,
            tokens: tokensOf(e.content), text: locked ? null : e.content,
        }));
        const sawBase = {
            locked, temperature: settings.temperature,
            notes: notesSaw, notes_used_tokens: noteResult.usedTokens, notes_budget_tokens: noteResult.budgetTokens,
            lorebook: entriesSaw, lorebook_used_tokens: entryResult.usedTokens, lorebook_budget_tokens: entryResult.budgetTokens,
        };
        const adultOk = await isAdult(req);
        const model = await modelIdOf(settings.model || card.model);
        try {
            const out = await ai.chat({
                model,
                messages: [{ role: 'system', content: system }].concat(asked),
                temperature: settings.temperature,
                subject,
                policy: card.rating === 'adult' && adultOk ? 'uncensored' : 'standard',
                preset: settings.preset || null,
                max_cost_usd: config.companions.maxCostUsd,
            });
            const answer = out.content || '(no text)';
            const check = floor.check(answer);
            if (!check.ok) {
                // The answer breaks the floor: it is never delivered, the chat ends, the account is reviewed.
                await companionChats.append({
                    owner: subject, chatId: chat.id, role: 'assistant', content: null,
                    turnId, variant, parentId: userMessage.id, model: settings.model || null,
                    meta: { error: 'floor', rule: check.rule, label: check.label, review: true, sealed: locked, saw: { ...sawBase, model, system: locked ? null : system, context: locked ? [] : asked } },
                });
                await db.prepare('UPDATE exchange_companion_chats SET ended_at = now() WHERE id = ? AND owner = ?').run(chat.id, subject);
                log.warn('[Companions] the answer broke the hard floor (' + check.rule + '); the chat ended and the account is reviewed.');
                return renderChat(req, res, chat, card, { problem: 'That answer broke the hard floor, so it was not delivered. The chat has ended and the account is reviewed.', status: 403 });
            }
            const stored = locked ? await locker.seal(answer, keys) : answer;
            await companionChats.append({
                owner: subject, chatId: chat.id, role: 'assistant', content: stored,
                turnId, variant, parentId: userMessage.id, model: settings.model || null,
                meta: {
                    run_id: out.run_id, provider: out.provider, answered_model: out.model, cost_usd: out.cost_usd,
                    tokens_in: out.tokens_in, tokens_out: out.tokens_out, latency_ms: out.latency_ms, why: out.why,
                    sealed: locked,
                    saw: { ...sawBase, model: out.model || model, system: locked ? null : system, context: locked ? [] : asked },
                },
            });
            // After every few turns, the cheap model writes short notes into the person's own memory.
            try {
                const after = await companionChats.messages(chat.id);
                const turnCount = new Set(after.filter((m) => m.role === 'user').map((m) => m.turn_id)).size;
                if (noteTaker.due(turnCount)) {
                    const noteTurns = locked
                        ? pairsOf(history.concat([{ role: 'user', content: userText }, { role: 'assistant', content: answer }]))
                        : readTurns(after, req.query || {}).slice(-4);
                    await noteTaker.take({ owner: subject, characterId: card.id, token, turns: noteTurns, protect: locked ? protectWith(keys) : null });
                }
            } catch (err) {
                log.warn('[Companions] the notes were not taken:', String((err && err.message) || err).slice(0, 200));
            }
        } catch (err) {
            await companionChats.append({
                owner: subject, chatId: chat.id, role: 'assistant', content: null,
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
        const locked = chat.locked === true;
        let lockerBundle = null;
        let keys = null;
        if (locked) {
            lockerBundle = parseLockerContext(req);
            if (!lockerBundle) return renderChat(req, res, chat, card, { problem: 'This chat is sealed with your Locker. Unlock it in this browser and send again: the older turns never reach the server in the clear.', status: 422 });
            keys = await lockerKeys(req);
            if (!keys) return renderChat(req, res, chat, card, { problem: 'Your Locker keys could not be read, so nothing was saved. Try again in a moment.', status: 409 });
        }
        const turnId = ctx.s.newId('ext');
        await companionChats.append({
            owner: owner(req), chatId: chat.id, role: 'user',
            content: locked ? await locker.seal(text, keys) : text,
            turnId, variant: 0, parentId: null, meta: locked ? { sealed: true } : {},
        });
        const saved = await companionChats.messages(chat.id);
        const mine = saved.filter((m) => m.turn_id === turnId && m.role === 'user');
        const user = mine[mine.length - 1];
        return answerTurn(req, res, chat, card, { userMessage: user, turnId, variant: 0, plainText: text, lockerBundle, keys });
    });

    /** Edit a message: the edit becomes another branch of the same turn, and the tree keeps both. */
    r.post('/talk/:id/edit', async (req, res) => {
        if (!signedIn(req)) return signInPage(req, res, { title: 'Sign in to talk', text: 'Your chat stays in your account.', next: req.originalUrl });
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const chat = await companionChats.get(owner(req), req.params.id);
        if (!chat) return page(req, res, { title: 'Not found', index: false, body: raw('<div class="ex-wrap ex-narrow">' + kit.empty({ icon: 'chat', title: 'No such chat' }) + '</div>') }, 404);
        const card = await characters.get(owner(req), chat.character_id);
        if (!card) return page(req, res, { title: 'Not found', index: false, body: raw('<div class="ex-wrap ex-narrow">' + kit.empty({ icon: 'chat', title: 'No such character' }) + '</div>') }, 404);
        if (chat.locked) return renderChat(req, res, chat, card, { problem: 'This chat is sealed with your Locker: a sealed message is edited in your browser, not here. Regenerate or send a new message instead.', status: 403 });
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
        return answerTurn(req, res, chat, card, { userMessage: user, turnId: original.turn_id, variant, plainText: text });
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
        let plainText = null;
        let lockerBundle = null;
        let keys = null;
        if (chat.locked) {
            lockerBundle = parseLockerContext(req);
            if (!lockerBundle) return renderChat(req, res, chat, card, { problem: 'This chat is sealed with your Locker. Unlock it in this browser and regenerate again.', status: 422 });
            plainText = lockerBundle.messages[original.id] || null;
            if (!plainText) return renderChat(req, res, chat, card, { problem: 'That message could not be opened in your browser, so it cannot be regenerated.', status: 422 });
            keys = await lockerKeys(req);
            if (!keys) return renderChat(req, res, chat, card, { problem: 'Your Locker keys could not be read, so the answer could not be sealed. Nothing was saved.', status: 409 });
        }
        const variant = await companionChats.nextVariant(chat.id, original.turn_id, original.id);
        return answerTurn(req, res, chat, card, { userMessage: original, turnId: original.turn_id, variant, plainText, lockerBundle, keys });
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
