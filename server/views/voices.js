'use strict';

/**
 * The pages for an agent's voice published here (actor.voice@1): the list of voices, the page of one voice with its
 * bio, its rules and the level it asks for, and the form that publishes one. Plain markup in the site's classes.
 */
const { esc } = require('../render/html');

const wrap = (inner) => '<div class="ex-wrap ex-narrow">' + inner + '</div>';

const voicesPage = ({ rows }) => wrap(
    '<header><p class="ex-eyebrow">OpenVibe.Exchange</p><h1>Agent voices</h1>' +
    '<p class="ex-lead">An agent\'s voice as a file: its name, a short bio, the house voice it speaks in, its rules, the level it asks for, and the model and apps it prefers. A voice never carries memory, a connector\'s token or a file. Borrow one and it becomes an agent of your own, at level ask.</p></header>' +
    (rows.length
        ? '<ul class="ex-list">' + rows.map((r) => '<li><a href="/voices/' + esc(r.slug) + '"><strong>' + esc(r.name) + '</strong></a>' +
            (r.bio ? '<p>' + esc(r.bio) + '</p>' : '') + '<p class="ex-muted">by ' + esc(r.owner) + ' · asks for level ' + esc(r.level) + '</p></li>').join('') + '</ul>'
        : '<p>No voice is published yet. <a href="/voices/new">Publish yours</a>.</p>'));

const voicePage = ({ row, doc, borrowUrl, isOwner, isStaff }) => wrap(
    '<p><a href="/voices">Agent voices</a></p>' +
    '<header><h1>' + esc(doc.name) + '</h1>' +
    (doc.bio ? '<p class="ex-lead">' + esc(doc.bio) + '</p>' : '') +
    '<p class="ex-muted">by ' + esc(doc.author.name || doc.author.subject) + ' · asks for level ' + esc(doc.level) + '</p></header>' +
    '<section><h2>Its rules</h2>' +
    (doc.rules && doc.rules.length ? '<ul>' + doc.rules.map((r) => '<li>' + esc(r) + '</li>').join('') + '</ul>' : '<p>No rules: it speaks in one voice.</p>') +
    '</section>' +
    '<section><h2>Borrow it</h2><p class="ex-muted">Free: a voice is borrowed, not bought. It becomes one of your agents at level ask, whatever the file asks for, and you raise it yourself.</p>' +
    '<p><a class="ex-btn" href="' + esc(borrowUrl) + '">Borrow this agent</a></p></section>' +
    (isOwner || isStaff
        ? '<section><h2>Take it down</h2><form method="post" action="/voices/' + esc(row.slug) + '/' + (isStaff && !isOwner ? 'hide' : 'close') + '">' +
          '<button type="submit" class="ex-btn">' + (isOwner ? 'Unlist it' : 'Hide it') + '</button></form></section>'
        : ''));

const voiceNewPage = ({ doc, error }) => wrap(
    '<header><h1>Publish an agent\'s voice</h1>' +
    '<p class="ex-lead">Paste the voice file you exported from OpenVibe.Actor. It becomes a listing here: its bio, its rules, the level it asks for, and a Borrow button. It is free, and it never carries memory, a token or a file.</p></header>' +
    (error ? '<p class="ex-error">' + esc(error) + '</p>' : '') +
    (doc ? '<section><h2>' + esc(doc.name) + '</h2>' + (doc.bio ? '<p>' + esc(doc.bio) + '</p>' : '') +
        (doc.rules && doc.rules.length ? '<ul>' + doc.rules.map((r) => '<li>' + esc(r) + '</li>').join('') + '</ul>' : '') +
        '<p class="ex-muted">asks for level ' + esc(doc.level) + ' · by ' + esc(doc.author.name || doc.author.subject) + '</p>' +
        '<form method="post" action="/voices"><input type="hidden" name="voice" value="' + esc(JSON.stringify(doc)) + '">' +
        '<button type="submit" class="ex-btn">Publish this voice</button></form></section>'
        : '<form method="post" action="/voices"><label class="ex-label">Voice file (JSON)<textarea name="voice" rows="10" required></textarea></label>' +
          '<button type="submit" class="ex-btn">Publish this voice</button></form>'));

module.exports = { voicesPage, voicePage, voiceNewPage };
