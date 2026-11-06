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

function cardTile(card) {
    const tags = (card.tags || []).slice(0, 4);
    const face = card.avatar_url
        ? '<img class="ex-card-face" src="' + esc(card.avatar_url) + '" alt="" loading="lazy" width="64" height="64">'
        : '<span class="ex-card-face ex-card-face-blank" aria-hidden="true"></span>';
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
function galleryPage({ items = [], total = 0, q = '', tags = [], sort = 'new', tagList = [], viewer = null, adult = false, mine = [], problem = null } = {}) {
    const shown = items.slice(0, 12);
    const rest = items.slice(12);
    const hidden = Math.max(0, total - shown.length);
    const sortForm = '<form class="ex-sorts" method="get" action="/companions">'
        + '<input type="hidden" name="q" value="' + esc(q) + '">'
        + '<input type="hidden" name="tags" value="' + esc(tags.join(',')) + '">'
        + SORTS.map((s) => '<button type="submit" name="sort" value="' + esc(s.id) + '" class="ex-sort' + (sort === s.id ? ' is-on' : '') + '">' + esc(s.label) + '</button>').join('')
        + '</form>';
    const searchForm = '<form class="ex-search" method="get" action="/companions">'
        + '<input type="hidden" name="sort" value="' + esc(sort) + '">'
        + '<label class="ovt-sr" for="ex-q">Search characters</label>'
        + '<input id="ex-q" type="search" name="q" value="' + esc(q) + '" placeholder="Search characters" maxlength="80">'
        + '<label class="ovt-sr" for="ex-tags">Tags</label>'
        + '<input id="ex-tags" type="text" name="tags" value="' + esc(tags.join(',')) + '" placeholder="Tags, comma separated" maxlength="120">'
        + '<button type="submit" class="ex-btn">Search</button>'
        + '</form>';
    const tagChips = tagList.length
        ? '<ul class="ex-taglist">' + tagList.map((t) => '<li><a class="ex-chip' + (tags.includes(t.tag) ? ' is-on' : '') + '" href="/companions?tags=' + encodeURIComponent(t.tag) + '&sort=' + esc(sort) + '">' + esc(t.tag) + ' <span class="ex-chip-n">' + t.n + '</span></a></li>').join('') + '</ul>'
        : '';
    const empty = items.length ? '' : '<div class="ex-empty">' + kit.empty({ icon: 'person', title: 'No characters yet', text: 'The gallery is empty. Make the first one, or import a card you brought from elsewhere.' }) + '</div>';
    return '<div class="ex-wrap">'
        + '<header class="ex-companions-head"><h1>Characters</h1>'
        + '<p class="ex-lede">Cards people made, on OpenVibe.Exchange. Bring one in as a Character Card V2 or V3, talk to it, and take it with you again.</p></header>'
        + (problem ? kit.notice({ kind: 'error', text: problem }) : '')
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
function characterPage({ card, tags = [], viewer = null, mine = false, problem = null, remixes = 0, notice = null, allowRemix = true } = {}) {
    const list = (tags.length ? tags : (card.tags || [])).map((t) => '<a class="ex-chip" href="/companions?tags=' + encodeURIComponent(t) + '">' + esc(t) + '</a>').join('');
    const talk = '<form method="post" action="' + esc(pathOf(card)) + '/talk"><button type="submit" class="ex-btn ex-btn-primary">Talk to ' + esc(card.name) + '</button></form>';
    const remix = (mine || !allowRemix) ? '' : '<form method="post" action="' + esc(pathOf(card)) + '/remix" class="ex-inline"><button type="submit" class="ex-btn">Remix this character</button></form>';
    return '<div class="ex-wrap ex-companion-page">'
        + '<article class="ex-companion">'
        + '<header class="ex-companion-head">'
        + (card.avatar_url ? '<img class="ex-companion-avatar" src="' + esc(card.avatar_url) + '" alt="" width="96" height="96">' : '<span class="ex-companion-avatar ex-card-face-blank" aria-hidden="true"></span>')
        + '<div><h1>' + esc(card.name) + '</h1>'
        + '<p class="ex-companion-by">by <span>' + esc(card.handle) + '</span>' + (card.rating === 'adult' ? ' <span class="ex-chip ex-chip-18">18+</span>' : '') + '</p></div></header>'
        + (problem ? kit.notice({ kind: 'error', text: problem }) : '')
        + (notice ? kit.notice({ kind: 'info', text: notice }) : '')
        + (card.description ? '<p class="ex-companion-desc">' + esc(card.description) + '</p>' : '')
        + (list ? '<p class="ex-companion-tags">' + list + '</p>' : '')
        + '<div class="ex-companion-acts">' + talk + remix + '</div>'
        + section('Personality', card.personality)
        + section('Scenario', card.scenario)
        + section('First message', card.first_message)
        + section('Example dialogue', card.example_dialogue)
        + (card.model ? '<p class="ex-companion-model">Works best on <b>' + esc(card.model) + '</b>. You can pick any model or preset when you talk.</p>' : '')
        + '<p class="ex-companion-meta">' + remixes + ' remix' + (remixes === 1 ? '' : 'es')
        + ' · <a href="/companions/' + esc(card.id) + '/export?format=json">Export JSON</a>'
        + ' · <a href="/companions/' + esc(card.id) + '/export?format=png">Export PNG</a></p>'
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
        + '<p class="ex-hint">A card rated 18+ whose stated age is under 18 is refused at save. The hard floor applies to every card: no sexual content involving minors, no non-consensual sexual content of real people, no help with weapons of mass harm or attacks on others.</p>'
        + field('avatar_url', 'Avatar image URL (optional)', c.avatar_url, 'maxlength="400"')
        + field('model', 'Model this card recommends (optional)', c.model, 'maxlength="120"')
        + '<label class="ex-label" for="ex-import">Import a card instead (JSON or PNG)</label>'
        + '<input id="ex-import" type="file" name="import" accept=".json,.png,application/json,image/png">'
        + '<button type="submit" class="ex-btn ex-btn-primary">Save the card</button>'
        + '</form></div>';
}

module.exports = { galleryPage, characterPage, cardForm, adultGate, cardTile, pathOf, SORTS };
