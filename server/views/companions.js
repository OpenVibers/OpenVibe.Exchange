'use strict';

/**
 * The companions pages (Opus design, 2026-11-06): the gallery, a character page, and the card form.
 * Every page is plain HTML with real links and plain POST forms: the site works without JavaScript.
 */
const kit = require('openvibe-shared/kit');
const { esc } = require('../render/html');

const SORTS = [
    { id: 'new', label: 'New' },
    { id: 'week', label: 'Popular this week' },
    { id: 'remixed', label: 'Most remixed' },
];

const pathOf = (card) => '/c/' + encodeURIComponent(card.handle) + '/' + encodeURIComponent(card.slug);

/**
 * A monogram for a character without an avatar: the first letter, on a colour picked from the name, so the same name
 * always gets the same colour and a stranger's card is never an empty square. The colours are the kit's own palette
 * tokens, so a monogram wears every theme, light and dark.
 */
const MONO_TOKENS = ['--ovk-accent', '--ovk-ok', '--ovk-warn', '--ovk-bad'];

function monoToken(name) {
    const s = String(name || '').trim().toLowerCase();
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return MONO_TOKENS[(h >>> 0) % MONO_TOKENS.length];
}

/** The monogram itself: the letter, on the colour the name picks. */
function monogram(name, cls = 'ex-mono') {
    const s = String(name || '').trim();
    const letter = (s[0] || '?').toUpperCase();
    return '<span class="' + cls + '" style="--ex-mono: var(' + monoToken(s) + ')" aria-hidden="true">' + esc(letter) + '</span>';
}

function cardTile(card) {
    const tags = (card.tags || []).slice(0, 4);
    const face = card.avatar_url
        ? '<img class="ex-card-face" src="' + esc(card.avatar_url) + '" alt="" loading="lazy" width="64" height="64">'
        : monogram(card.name, 'ex-card-face ex-mono');
    return '<li class="ex-card-tile">'
        + '<a class="ex-card-tile-link" href="' + esc(pathOf(card)) + '">'
        + face
        + '<span class="ex-card-tile-body">'
        + '<b class="ex-card-tile-name">' + esc(card.name) + '</b>'
        + '<span class="ex-card-tile-by">' + esc(card.handle) + '</span>'
        + (card.description ? '<span class="ex-card-tile-desc">' + esc(String(card.description).slice(0, 140)) + '</span>' : '')
        + '</span></a>'
        + '<p class="ex-card-tile-tags">'
        + (card.rating === 'adult' ? '<span class="ex-chip ex-chip-18">18+</span>' : '')
        + tags.map((t) => '<a class="ex-chip" href="/companions?tags=' + encodeURIComponent(t) + '">' + esc(t) + '</a>').join('')
        + '</p></li>';
}

/** The gallery: search, tags, the three sorts, and a counted fold. Never tabs. */
function galleryPage({ items = [], total = 0, q = '', tags = [], sort = 'new', tagList = [], viewer = null, adult = false, mine = [], problem = null, defaults = '' } = {}) {
    const shown = items.slice(0, 12);
    const rest = items.slice(12);
    const hidden = Math.max(0, total - shown.length);
    const sortForm = '<form class="ex-sorts" method="get" action="/companions">'
        + '<input type="hidden" name="q" value="' + esc(q) + '">'
        + '<input type="hidden" name="tags" value="' + esc(tags.join(',')) + '">'
        + SORTS.map((s) => '<button type="submit" name="sort" value="' + esc(s.id) + '" class="ex-sort' + (sort === s.id ? ' is-on' : '') + '">' + esc(s.label) + '</button>').join('')
        + '</form>';
    const defaultsHtml = defaults || '';
    const searchForm = '<form class="ex-search" method="get" action="/companions">'
        + '<input type="hidden" name="sort" value="' + esc(sort) + '">'
        + '<label class="ovk-sr" for="ex-q">Search characters</label>'
        + '<input id="ex-q" type="search" name="q" value="' + esc(q) + '" placeholder="Search characters" maxlength="80">'
        + '<label class="ovk-sr" for="ex-tags">Tags</label>'
        + '<input id="ex-tags" type="text" name="tags" value="' + esc(tags.join(',')) + '" placeholder="Tags, comma separated" maxlength="120">'
        + '<button type="submit" class="ex-btn">Search</button>'
        + '</form>';
    const tagChips = tagList.length
        ? '<ul class="ex-taglist">' + tagList.map((t) => '<li><a class="ex-chip' + (tags.includes(t.tag) ? ' is-on' : '') + '" href="/companions?tags=' + encodeURIComponent(t.tag) + '&sort=' + esc(sort) + '">' + esc(t.tag) + ' <span class="ex-chip-n">' + t.n + '</span></a></li>').join('') + '</ul>'
        : '';
    const empty = items.length ? '' : '<div class="ex-empty">' + kit.empty({ icon: 'person', title: 'No characters yet', text: 'The gallery is empty. Make the first one above, or import a Character Card V2 or V3 you brought from elsewhere.' }) + '</div>';
    return '<div class="ex-wrap">'
        + '<header class="ex-companions-head"><h1>Characters</h1>'
        + '<p class="ex-lede">Cards people made, on OpenVibe.Exchange. Bring one in as a Character Card V2 or V3, talk to it, and take it with you again.</p>'
        // Making or importing a card is always one tap away, not only from "Your characters" once you have one.
        + '<p class="ex-head-actions"><a class="ovk-btn ovk-btn--primary" href="/companions/new">Make or import a character</a></p></header>'
        + (problem ? kit.notice({ kind: 'error', text: problem }) : '')
        + defaultsHtml
        + '<div class="ex-gallery-bar">' + searchForm + sortForm + '</div>'
        + (tagChips ? '<div class="ex-gallery-tags">' + tagChips + '</div>' : '')
        + (empty || '<ul class="ex-card-grid">' + shown.map((c) => cardTile(c)).join('') + '</ul>')
        + (rest.length ? '<details class="ex-more"><summary>More (' + (hidden || rest.length) + ')</summary><ul class="ex-card-grid">' + rest.map((c) => cardTile(c)).join('') + '</ul></details>' : '')
        + (mine.length ? '<section class="ex-mine"><h2>Your characters</h2><ul class="ex-card-grid">' + mine.map((c) => cardTile(c)).join('') + '</ul><p><a class="ex-btn" href="/companions/new">Make a character</a></p></section>' : '')
        + '</div>';
}

function section(title, body) {
    if (!body) return '';
    const br = String.fromCharCode(10);
    return '<section class="ex-companion-section"><h2>' + esc(title) + '</h2><p>' + esc(body).split(br).join('<br>') + '</p></section>';
}

/** A character page. */
function characterPage({ card, tags = [], viewer = null, mine = false, problem = null, remixes = 0, notice = null, allowRemix = true, share = '' } = {}) {
    const list = (tags.length ? tags : (card.tags || [])).map((t) => '<a class="ex-chip" href="/companions?tags=' + encodeURIComponent(t) + '">' + esc(t) + '</a>').join('');
    const talk = '<form method="post" action="' + esc(pathOf(card)) + '/talk"><button type="submit" class="ex-btn ex-btn-primary">Talk to ' + esc(card.name) + '</button></form>';
    const remix = (mine || !allowRemix) ? '' : '<form method="post" action="' + esc(pathOf(card)) + '/remix" class="ex-inline"><button type="submit" class="ex-btn">Remix this character</button></form>';
    return '<div class="ex-wrap ex-companion-page">'
        + '<article class="ex-companion">'
        + '<header class="ex-companion-head">'
        + (card.avatar_url ? '<img class="ex-companion-avatar" src="' + esc(card.avatar_url) + '" alt="" width="96" height="96">' : monogram(card.name, 'ex-companion-avatar ex-mono'))
        + '<div><h1>' + esc(card.name) + '</h1>'
        + '<p class="ex-companion-by">by <span>' + esc(card.handle) + '</span>' + (card.rating === 'adult' ? ' <span class="ex-chip ex-chip-18">18+</span>' : '') + '</p></div></header>'
        + (problem ? kit.notice({ kind: 'error', text: problem }) : '')
        + (notice ? kit.notice({ kind: 'info', text: notice }) : '')
        + (card.description ? '<p class="ex-companion-desc">' + esc(card.description) + '</p>' : '')
        + (list ? '<p class="ex-companion-tags">' + list + '</p>' : '')
        + '<div class="ex-companion-acts">' + talk + remix + (share || '')
        + '<a class="ex-btn" href="' + esc(pathOf(card) + '/memory') + '">Memory</a>'
        + '<a class="ex-btn" href="' + esc(pathOf(card) + '/lorebook') + '">Lorebooks</a></div>'
        + section('Personality', card.personality)
        + section('Scenario', card.scenario)
        + section('First message', card.first_message)
        + section('Example dialogue', card.example_dialogue)
        + (card.model ? '<p class="ex-companion-model">Works best on <b>' + esc(card.model) + '</b>. You can pick any model or preset when you talk.</p>' : '')
        + (card.voice ? '<p class="ex-companion-voice">Speaks in the voice <b>' + esc(card.voice) + '</b>: its answers are read aloud in it.</p>' : '')
        + '<p class="ex-companion-meta">' + remixes + ' remix' + (remixes === 1 ? '' : 'es')
        + ' · <a class="ex-companion-export" href="/companions/' + esc(card.id) + '/export?format=json">Export JSON</a>'
        + ' · <a class="ex-companion-export" href="/companions/' + esc(card.id) + '/export?format=png">Export PNG</a></p>'
        + '</article></div>';
}

/** The gate for an 18+ card: the person must be signed in with the 18+ confirmation. */
function adultGate() {
    return '<div class="ex-wrap ex-narrow">' + kit.empty({
        icon: 'shield',
        title: 'This character is 18+',
        text: 'Characters rated 18+ are shown only to people signed in who confirmed they are 18 or over. <a href="/uncensored">Confirm here</a>.',
        action: { href: '/auth/login?next=%2Funcensored', label: 'Sign in with OpenVibe' },
    }) + '</div>';
}

/** The card form: create and edit are the same form. */
function cardForm({ card = null, action = '/companions/new', title = 'Make a character', problem = null } = {}) {
    const c = card || {};
    const field = (name, label, value, extra) => '<label class="ex-label" for="ex-' + name + '">' + esc(label) + '</label>'
        + '<input id="ex-' + name + '" name="' + name + '" type="text" value="' + esc(value || '') + '" ' + (extra || '') + '>';
    const area = (name, label, value, rows) => '<label class="ex-label" for="ex-' + name + '">' + esc(label) + '</label>'
        + '<textarea id="ex-' + name + '" name="' + name + '" rows="' + (rows || 3) + '">' + esc(value || '') + '</textarea>';
    return '<div class="ex-wrap ex-narrow">'
        + '<h1>' + esc(title) + '</h1>'
        + (problem ? kit.notice({ kind: 'error', text: problem }) : '')
        + '<form class="ex-form" method="post" action="' + esc(action) + '" enctype="multipart/form-data">'
        + field('name', 'Name', c.name, 'required maxlength="80"')
        + field('slug', 'Address (optional)', c.slug, 'maxlength="60" placeholder="your-character"')
        + area('description', 'Short description', c.description, 2)
        + area('personality', 'Personality', c.personality, 3)
        + area('scenario', 'Scenario', c.scenario, 3)
        + area('first_message', 'First message', c.first_message, 3)
        + area('example_dialogue', 'Example dialogue', c.example_dialogue, 4)
        + field('tags', 'Tags (comma separated)', (c.tags || []).join(', '), 'maxlength="200"')
        + field('age', 'Age (optional)', c.age, 'maxlength="3"')
        + '<label class="ex-label" for="ex-rating">Content rating</label>'
        + '<select id="ex-rating" name="rating">'
        + '<option value="everyone"' + (c.rating === 'adult' ? '' : ' selected') + '>Everyone</option>'
        + '<option value="adult"' + (c.rating === 'adult' ? ' selected' : '') + '>18+</option>'
        + '</select>'
        + '<p class="ex-hint">A card rated 18+ whose stated age is under 18 is refused at save. The hard floor applies to every card: no sexual content involving minors, no non-consensual sexual content (fiction included) or incest, no help with weapons of mass harm or attacks on others.</p>'
        + field('avatar_url', 'Avatar image URL (optional)', c.avatar_url, 'maxlength="400"')
        + field('model', 'Model this card recommends (optional)', c.model, 'maxlength="120"')
        + field('voice', 'Voice (optional)', c.voice, 'maxlength="120" placeholder="the voice this character speaks in"')
        + '<p class="ex-hint">A voice is a voice id of OpenVibe.Chat (for example <b>gary</b>). When the card names one, its answers are read aloud in it.</p>'
        + '<label class="ex-label" for="ex-import">Import a card instead (JSON or PNG)</label>'
        + '<input id="ex-import" type="file" name="import" accept=".json,.png,application/json,image/png">'
        + '<button type="submit" class="ex-btn ex-btn-primary">Save the card</button>'
        + '</form></div>';
}

/**
 * A sealed text: the envelope is all the server has, so the page carries it to the browser, which
 * opens it with the person's Locker keys. Without JavaScript the page says it is sealed and nothing more.
 */
function sealedText(text, { role = null, key = '', message = null, note = null, kind = null, pinned = null } = {}) {
    return '<span class="ex-sealed" data-locker-sealed="' + esc(text) + '"'
        + ' data-locker-key="' + esc(key) + '"'
        + (role ? ' data-locker-role="' + esc(role) + '"' : '')
        + (message ? ' data-locker-message="' + esc(message) + '"' : '')
        + (note ? ' data-locker-note="' + esc(note) + '"' : '')
        + (kind ? ' data-locker-kind="' + esc(kind) + '"' : '')
        + (pinned != null ? ' data-locker-pinned="' + (pinned ? '1' : '0') + '"' : '')
        + '>Sealed with your Locker</span>';
}

const stillLocked = (locked, lock) => locked
    ? '<p class="ex-locked">🔒 Sealed with your Locker' + (lock && lock.fingerprint ? ' (' + esc(lock.fingerprint) + ')' : '') + '. Only your keys open it.</p>'
    : '';

/** The Memory panel: the notes this character keeps, and the person's edits, pins and additions. */
const KIND_LABEL = { fact: 'Fact', preference: 'Preference', event: 'Event' };

function memoryPage({ card = {}, notes = [], locked = false, lock = null, problem = null, notice = null } = {}) {
    const kinds = ['fact', 'preference', 'event'];
    // The pinned notes are the ones the person wants read first: they come first here, as in the context.
    notes = [...notes].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
    const row = (note) => {
        const text = note.sealed
            ? sealedText(note.text, { note: note.m2_id, kind: note.kind, pinned: note.pinned })
            : esc(note.text);
        const edit = note.sealed ? '' : '<details class="ex-menu"><summary class="ex-act">Edit</summary>'
            + '<form class="ex-menu-body" method="post" action="' + esc('/c/' + card.handle + '/' + card.slug + '/memory/' + note.id + '/edit') + '">'
            + '<label class="ovk-sr" for="ex-note-' + esc(note.id) + '">The note</label>'
            + '<textarea id="ex-note-' + esc(note.id) + '" name="text" rows="3" maxlength="2000">' + esc(note.text) + '</textarea>'
            + '<button type="submit" class="ex-act ex-act-strong">Save</button></form></details>';
        const action = (path, label, extra = '') => '<form class="ex-act-form" method="post" action="' + esc(path) + '">'
            + (extra || '') + '<button type="submit" class="ex-act">' + esc(label) + '</button></form>';
        const base = '/c/' + card.handle + '/' + card.slug + '/memory/' + note.id;
        return '<li class="ex-note" data-note-id="' + esc(note.id) + '">'
            + '<div class="ex-note-head"><span class="ex-chip">' + esc(KIND_LABEL[note.kind] || note.kind) + '</span>'
            + (note.pinned ? '<span class="ex-chip is-on">Pinned</span>' : '')
            + '<span class="ex-muted">' + esc(note.origin === 'model' ? 'written by the character' : 'written by you') + '</span></div>'
            + '<p class="ex-note-text">' + text + '</p>'
            + '<div class="ex-note-acts">' + edit
            + action(base + '/pin', note.pinned ? 'Unpin' : 'Pin', '<input type="hidden" name="pinned" value="' + (note.pinned ? '0' : '1') + '">')
            + action(base + '/delete', 'Delete')
            + '</div></li>';
    };
    return '<div class="ex-wrap ex-narrow ex-memory-page">'
        + '<p><a class="ex-back" href="' + esc(pathOf(card)) + '">← Back to ' + esc(card.name) + '</a></p>'
        + '<h1>Memory</h1>'
        + '<p class="ex-lede">What <b>' + esc(card.name) + '</b> remembers about you. The notes are yours: edit them, pin the ones that matter, delete the rest, or add your own. They live in your OpenVibe memory, not in a plan.</p>'
        + (problem ? kit.notice({ kind: 'error', text: problem }) : '')
        + (notice ? kit.notice({ kind: 'info', text: notice }) : '')
        + '<section class="ex-memory-list"><h2>Your notes (' + notes.length + ')</h2>'
        + (notes.length ? '<ul class="ex-notes">' + notes.map(row).join('') + '</ul>' : '<p class="ex-muted">No notes yet. They appear here after a few turns, or add one below.</p>')
        + '</section>'
        + '<section class="ex-memory-add"><h2>Add a note</h2>'
        + '<form class="ex-form" method="post" action="' + esc('/c/' + card.handle + '/' + card.slug + '/memory/add') + '">'
        + '<label class="ex-label" for="ex-note-kind">Kind</label>'
        + '<select id="ex-note-kind" name="kind">' + kinds.map((k) => '<option value="' + k + '">' + (KIND_LABEL[k] || k) + '</option>').join('') + '</select>'
        + '<label class="ex-label" for="ex-note-text">The note</label>'
        + '<textarea id="ex-note-text" name="text" rows="3" maxlength="2000" required placeholder="A fact, a preference, or something that happened"></textarea>'
        + '<button type="submit" class="ex-btn ex-btn-primary">Add the note</button></form></section>'
        + '<section class="ex-memory-lock"><h2>The Locker</h2>'
        + (locked
            ? stillLocked(true, lock) + '<p class="ex-muted">The notes and the chats of this character are sealed with your keys. They are opened in your browser and sent for one turn only. OpenVibe cannot read them at rest.</p>'
                + '<form method="post" action="' + esc('/c/' + card.handle + '/' + card.slug + '/lock') + '"><input type="hidden" name="on" value="0"><button type="submit" class="ex-btn">Turn the Locker off</button></form>'
            : '<p class="ex-muted">With your Locker on, these notes and the chat history of this character are sealed with your keys before they are stored. Only your browser can read them. <a href="/locker">Set up your Locker</a> first if you have not.</p>'
                + '<form method="post" action="' + esc('/c/' + card.handle + '/' + card.slug + '/lock') + '"><input type="hidden" name="on" value="1"><button type="submit" class="ex-btn ex-btn-primary">Turn the Locker on</button></form>')
        + '</section>'
        + '</div>';
}

/** The lorebook panel: the entries that join the context, and the World Info file in and out. */
function lorebookPage({ card = {}, books = [], chat = null, problem = null, notice = null } = {}) {
    const kindName = { person: 'your world', character: 'this character', chat: 'this chat' };
    const entryRow = (book, entry) => {
        const base = '/c/' + card.handle + '/' + card.slug + '/lorebook/' + book.id + '/entry/' + entry.id;
        return '<li class="ex-entry" data-entry-id="' + esc(entry.id) + '">'
            + '<div class="ex-entry-head"><b>' + esc(entry.name || 'An entry') + '</b>'
            + '<span class="ex-chip">priority ' + esc(entry.priority) + '</span>'
            + (entry.constant ? '<span class="ex-chip is-on">always in</span>' : '')
            + (entry.enabled ? '' : '<span class="ex-chip">off</span>')
            + '</div>'
            + '<p class="ex-entry-keys">' + (entry.keys || []).map((k) => '<span class="ex-chip">' + esc(k) + '</span>').join(' ') + '</p>'
            + '<p class="ex-entry-text">' + esc(entry.content) + '</p>'
            + '<div class="ex-note-acts">'
            + '<details class="ex-menu"><summary class="ex-act">Edit</summary><form class="ex-menu-body" method="post" action="' + esc(base) + '">'
            + '<label class="ex-label" for="ex-e-name-' + esc(entry.id) + '">Name</label><input id="ex-e-name-' + esc(entry.id) + '" name="name" type="text" value="' + esc(entry.name || '') + '" maxlength="120">'
            + '<label class="ex-label" for="ex-e-keys-' + esc(entry.id) + '">Keys</label><input id="ex-e-keys-' + esc(entry.id) + '" name="keys" type="text" value="' + esc((entry.keys || []).join(', ')) + '">'
            + '<label class="ex-label" for="ex-e-content-' + esc(entry.id) + '">Content</label><textarea id="ex-e-content-' + esc(entry.id) + '" name="content" rows="4" maxlength="8000">' + esc(entry.content) + '</textarea>'
            + '<label class="ex-label" for="ex-e-priority-' + esc(entry.id) + '">Priority</label><input id="ex-e-priority-' + esc(entry.id) + '" name="priority" type="number" value="' + esc(entry.priority) + '">'
            + '<label class="ex-check"><input type="checkbox" name="constant" value="1"' + (entry.constant ? ' checked' : '') + '> Always in the context</label>'
            + '<button type="submit" class="ex-act ex-act-strong">Save</button></form></details>'
            + '<form class="ex-act-form" method="post" action="' + esc(base + '/delete') + '"><button type="submit" class="ex-act">Delete</button></form>'
            + '</div></li>';
    };
    const bookSection = (book) => {
        const base = '/c/' + card.handle + '/' + card.slug + '/lorebook/' + book.id;
        return '<section class="ex-lorebook" data-lorebook-id="' + esc(book.id) + '">'
            + '<header class="ex-lorebook-head"><h2>' + esc(book.name || 'A lorebook') + '</h2>'
            + '<span class="ex-chip">' + esc(kindName[book.scope] || book.scope) + '</span>'
            + '<a class="ex-chip" href="' + esc(base + '/export') + '">Export World Info</a>'
            + '<form class="ex-act-form" method="post" action="' + esc(base + '/delete') + '"><button type="submit" class="ex-act">Delete the book</button></form>'
            + '</header>'
            + ((book.entries || []).length ? '<ul class="ex-entries">' + book.entries.map((e) => entryRow(book, e)).join('') + '</ul>' : '<p class="ex-muted">No entries yet.</p>')
            + '<details class="ex-menu"><summary class="ex-act">Add an entry</summary><form class="ex-menu-body" method="post" action="' + esc(base + '/entries') + '">'
            + '<label class="ex-label" for="ex-a-name-' + esc(book.id) + '">Name (optional)</label><input id="ex-a-name-' + esc(book.id) + '" name="name" type="text" maxlength="120">'
            + '<label class="ex-label" for="ex-a-keys-' + esc(book.id) + '">Keys, comma separated</label><input id="ex-a-keys-' + esc(book.id) + '" name="keys" type="text" placeholder="the engine, ada">'
            + '<label class="ex-label" for="ex-a-content-' + esc(book.id) + '">Content</label><textarea id="ex-a-content-' + esc(book.id) + '" name="content" rows="4" maxlength="8000" required></textarea>'
            + '<label class="ex-label" for="ex-a-priority-' + esc(book.id) + '">Priority</label><input id="ex-a-priority-' + esc(book.id) + '" name="priority" type="number" value="0">'
            + '<label class="ex-check"><input type="checkbox" name="constant" value="1"> Always in the context</label>'
            + '<button type="submit" class="ex-act ex-act-strong">Add the entry</button></form></details>'
            + '<details class="ex-menu"><summary class="ex-act">Import World Info</summary><form class="ex-menu-body" method="post" enctype="multipart/form-data" action="' + esc(base + '/import') + '">'
            + '<label class="ex-label" for="ex-wi-' + esc(book.id) + '">Paste a SillyTavern World Info JSON, or choose the file</label>'
            + '<textarea id="ex-wi-' + esc(book.id) + '" name="world_info" rows="4"></textarea>'
            + '<input type="file" name="file" accept=".json,application/json">'
            + '<button type="submit" class="ex-act ex-act-strong">Import</button></form></details>'
            + '</section>';
    };
    return '<div class="ex-wrap ex-narrow ex-lorebook-page">'
        + '<p><a class="ex-back" href="' + esc(pathOf(card)) + '">← Back to ' + esc(card.name) + '</a></p>'
        + '<h1>Lorebooks</h1>'
        + '<p class="ex-lede">Entries that join the context when one of their keys appears in the recent turns, the highest priority first, within a token budget. Attach a book to your world, to <b>' + esc(card.name) + '</b>, or to this chat. The chat’s “What the model saw” panel lists the entries used for each answer.</p>'
        + (problem ? kit.notice({ kind: 'error', text: problem }) : '')
        + (notice ? kit.notice({ kind: 'info', text: notice }) : '')
        + (books.length ? books.map(bookSection).join('') : '<p class="ex-muted">No lorebooks yet. Make one below, or import a SillyTavern World Info file into it.</p>')
        + '<section class="ex-lorebook-new"><h2>Make a lorebook</h2><form class="ex-form" method="post" action="' + esc('/c/' + card.handle + '/' + card.slug + '/lorebook') + '">'
        + '<label class="ex-label" for="ex-book-name">Name</label><input id="ex-book-name" name="name" type="text" maxlength="120" required>'
        + '<label class="ex-label" for="ex-book-scope">Attach it to</label><select id="ex-book-scope" name="scope">'
        + '<option value="person">Your world (every chat)</option><option value="character">This character</option>'
        + (chat ? '<option value="chat">This chat</option>' : '') + '</select>'
        + (chat ? '<input type="hidden" name="chat_id" value="' + esc(chat.id) + '">' : '')
        + '<button type="submit" class="ex-btn ex-btn-primary">Make the lorebook</button></form></section>'
        + '</div>';
}

module.exports = { galleryPage, characterPage, cardForm, adultGate, cardTile, pathOf, monogram, monoToken, memoryPage, lorebookPage, sealedText, stillLocked, SORTS };
