'use strict';
/**
 * The group chat pages (Opus's design, 2026-11-06, step 5): the list of the person's groups, the form that
 * starts one, and the chat itself. Plain HTML, real links, plain POST forms: the site works without
 * JavaScript.
 */
const kit = require('openvibe-shared/kit');
const thread = require('openvibe-shared/thread');
const { esc } = require('../render/html');
const { MODE_LABEL } = require('../companions/group');

/** The characters of the person, as the checkboxes of the form. */
function memberChoices(characters, chosen = []) {
    if (!characters.length) return '<p class="ex-muted">You have no characters yet. <a href="/companions/new">Make one first</a>.</p>';
    return '<ul class="ex-member-choices">' + characters.map((c) => '<li><label class="ex-check">'
        + '<input type="checkbox" name="members" value="' + esc(c.id) + '"' + (chosen.includes(c.id) ? ' checked' : '') + '> '
        + esc(c.name) + ' <span class="ex-muted">(' + esc(c.handle) + ')</span></label></li>').join('') + '</ul>';
}

/** The list of the person's groups, and the form that starts one. */
function groupsPage({ groups = [], characters = [], problem = null, notice = null } = {}) {
    const rows = groups.map((g) => '<li class="ex-group-row"><a class="ex-group-link" href="/talk/group/' + encodeURIComponent(g.id) + '">'
        + '<b>' + esc(g.title || 'Group chat') + '</b></a>'
        + '<span class="ex-chip">' + esc(MODE_LABEL[g.mode] || g.mode) + '</span>'
        + '<span class="ex-muted">' + Number(g.member_count || 0) + ' characters</span></li>').join('');
    const form = '<section class="ex-group-new"><h2>Start a group chat</h2>'
        + '<p class="ex-lede">Two to five characters and you. They answer by a simple rule: the one you name, one after another, or let them talk for a few turns each.</p>'
        + '<form class="ex-form" method="post" action="/groups/new">'
        + '<label class="ex-label" for="ex-group-title">Name the group (optional)</label>'
        + '<input id="ex-group-title" name="title" type="text" maxlength="120" placeholder="The morning crew">'
        + '<label class="ex-label" for="ex-group-mode">Who answers</label>'
        + '<select id="ex-group-mode" name="mode">'
        + '<option value="round_robin">' + esc(MODE_LABEL.round_robin) + '</option>'
        + '<option value="named">' + esc(MODE_LABEL.named) + '</option>'
        + '<option value="free">' + esc(MODE_LABEL.free) + '</option>'
        + '</select>'
        + '<label class="ex-label" for="ex-group-turns">How many times each, when they talk</label>'
        + '<input id="ex-group-turns" name="turns" type="number" min="1" max="5" value="1">'
        + '<fieldset class="ex-fieldset"><legend>The characters (two to five)</legend>' + memberChoices(characters) + '</fieldset>'
        + '<button type="submit" class="ex-btn ex-btn-primary">Start the group chat</button>'
        + '</form></section>';
    return '<div class="ex-wrap ex-narrow">'
        + '<h1>Group chats</h1>'
        + (problem ? kit.notice({ kind: 'error', text: problem }) : '')
        + (notice ? kit.notice({ kind: 'info', text: notice }) : '')
        + (groups.length ? '<section class="ex-groups"><h2>Your groups</h2><ul class="ex-group-list">' + rows + '</ul></section>' : '')
        + form
        + '</div>';
}

/** The header of a group chat: the name, and the faces of the characters in it. */
function groupHead(group, cards) {
    const faces = cards.map((c) => thread.face({ name: c.name, color: 'var(' + monoToken(c.name) + ')' })).join('');
    return '<header class="ovt-head ex-chat-head" data-ovt-head>'
        + kit.sidebarButton({ id: 'ovt-chats', label: 'Your chats' })
        + '<div class="ex-chat-id"><div class="ex-group-faces">' + faces + '</div>'
        + '<h1 class="ovt-title ex-chat-title">' + esc(group.title || 'Group chat') + '</h1></div>'
        + '<a class="ovt-btn ex-chat-new" href="/groups" aria-label="Group chats">'
        + thread.icon('plus') + '</a>'
        + '<details class="ex-chat-settings"><summary class="ex-chip ex-chat-chip">Settings</summary>'
        + '<div class="ex-chat-settings-body">'
        + '<form class="ex-form" method="post" action="/talk/group/' + encodeURIComponent(group.id) + '/settings">'
        + '<label class="ex-label" for="ex-g-mode">Who answers</label>'
        + '<select id="ex-g-mode" name="mode">'
        + ['named', 'round_robin', 'free'].map((m) => '<option value="' + m + '"' + (group.mode === m ? ' selected' : '') + '>' + esc(MODE_LABEL[m] || m) + '</option>').join('')
        + '</select>'
        + '<label class="ex-label" for="ex-g-turns">How many times each, when they talk</label>'
        + '<input id="ex-g-turns" name="turns" type="number" min="1" max="5" value="' + esc(group.turns || 1) + '">'
        + '<label class="ex-label" for="ex-g-speak">The voice</label>'
        + '<select id="ex-g-speak" name="speak">'
        + '<option value="1"' + (group.speak === false ? '' : ' selected') + '>Read the answers aloud</option>'
        + '<option value="0"' + (group.speak === false ? ' selected' : '') + '>Keep them written</option>'
        + '</select>'
        + '<button type="submit" class="ex-btn">Save</button>'
        + '</form></div></details>'
        + '<form class="ex-act-form" method="post" action="/talk/group/' + encodeURIComponent(group.id) + '/image"><button type="submit" class="ex-chip" title="Make an image of this group chat">Image</button></form>'
        + '</header>';
}

/** The monogram's colour token, the same rule as a card's own page. */
const MONO_TOKENS = ['--ovk-accent', '--ovk-ok', '--ovk-warn', '--ovk-bad'];
function monoToken(name) {
    const s = String(name || '').trim().toLowerCase();
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return MONO_TOKENS[(h >>> 0) % MONO_TOKENS.length];
}

/** The sound of an answer, read aloud in the character's own voice. */
function clipAudio(clip) {
    if (!clip || !clip.id) return '';
    return '<p class="ex-voice"><audio class="ex-voice-audio" controls preload="none" src="/voice/' + encodeURIComponent(clip.id) + '">'
        + 'Your browser cannot play this sound. <a href="/voice/' + encodeURIComponent(clip.id) + '">Download it</a>.</audio>'
        + (clip.voice ? ' <span class="ex-chip">voice: ' + esc(clip.voice) + '</span>' : '')
        + '</p>';
}

/** One turn of a group chat: the person's words, then what every character said. */
function groupTurns(messages, cards) {
    return messages.map((m) => {
        if (m.role === 'user') {
            return '<li class="ovt-turn ex-turn" data-turn="' + esc(m.turn_id || m.id) + '">'
                + '<div class="ovt-you"><p class="ovt-bubble">' + esc(m.content || '') + '</p></div></li>';
        }
        const card = cards[m.character_id] || { name: 'Someone' };
        const face = thread.face({ name: card.name, color: 'var(' + monoToken(card.name) + ')' });
        const answer = thread.answer({
            html: esc(m.content || '').split(String.fromCharCode(10)).join('<br>'),
            meta: [], copy: false,
        });
        const clip = m.meta && m.meta.clip ? m.meta.clip : null;
        const voice = m.meta && m.meta.voice ? m.meta.voice : null;
        return '<li class="ovt-turn ex-turn" data-turn="' + esc(m.turn_id || m.id) + '">'
            + '<div class="ovt-bot">' + face + '<div class="ovt-reply">'
            + '<p class="ex-who">' + esc(card.name) + '</p>'
            + answer
            + (voice ? ' <span class="ex-chip">voice: ' + esc(voice) + '</span>' : '')
            + clipAudio(clip)
            + '</div></div></li>';
    });
}

module.exports = { groupsPage, groupHead, groupTurns, memberChoices, clipAudio, monoToken };
