'use strict';

/**
 * The Exchange room's pages (plan 2026-10-28 §5.11). Server-rendered and whole without JavaScript: every action is a
 * plain form or link. public/js/exchange.js and public/css/exchange.css are one-comment placeholders the main
 * session replaces; the sandbox, install, revoke and offers work without them.
 *
 *   home({ listings, counts })                         the hero, the three scenes, public listings
 *   listingsPage({ listings, filters })                browse and filter
 *   listingPage({ listing, tests, ... })               passport, tests, sandbox, install/revoke and offers
 *   submitForm({ values, mine, problem })              create a listing (draft)
 *   sandboxPage({ trial, listing })                    one sandbox trial and its checks
 *   installsPage({ installs })                         the caller's installations
 *   offersPage({ sent, received })                    free claims and swap offers
 *   safetyPage()                                       free and swap safety rules
 *   developersPage()                                   the API
 *   signIn({ title, text, next })                      a page that needs an account
 *   notFound()
 * Each returns HTML for the page body; server/http/pages.js sends it through the layout. Ids and classes are
 * stable and start with `ex-`.
 */
const { esc, time } = require('../render/html');
const kit = require('openvibe-shared/kit');
const sc = require('openvibe-shared/showcase');

const KIND_LABEL = { agent: 'Agent', mcp_tool: 'MCP tool', template: 'Template', theme: 'Theme or kit', game_asset: 'Game asset', service: 'Creator service' };
const MODE_LABEL = { free: 'Free', swap: 'Swap' };
const STATUS_LABEL = { draft: 'Draft', listed: 'Listed', hidden: 'Hidden', closed: 'Closed' };
const CLOSED_LABEL = { given: 'Given away', swapped: 'Swapped', withdrawn: 'Withdrawn' };
const PASSPORT_LABEL = { reads: 'Can read', writes: 'Can write', spends: 'Can spend', contacts: 'Can contact' };

const kindLabel = (k) => esc(KIND_LABEL[k] || k);
const modeBadge = (m) => `<span class="ex-mode ex-mode-${esc(m)}">${esc(MODE_LABEL[m] || m)}</span>`;
const statusBadge = (s) => `<span class="ex-status ex-status-${esc(s)}">${esc(STATUS_LABEL[s] || s)}</span>`;

function verifiedBadge(listing) {
    if (!listing || !listing.tests) return '';
    if (listing.tests.verified) return `<span class="ex-verified" title="Every conformance test for this version passed">✓ tests pass</span>`;
    return `<span class="ex-unverified">${Number(listing.tests.failed) ? 'tests failed' : 'not tested'}</span>`;
}

function card(l) {
    return `<li class="ex-listing-card" data-listing="${esc(l.slug)}" data-kind="${esc(l.kind)}" data-mode="${esc(l.mode)}">
<a class="ex-listing-link" href="/listings/${esc(l.slug)}">
<span class="ex-listing-top">${modeBadge(l.mode)}<span class="ex-kind">${kindLabel(l.kind)}</span>${verifiedBadge(l)}</span>
<span class="ex-listing-title">${esc(l.title)}</span>
<span class="ex-listing-summary">${esc(l.summary)}</span>
<span class="ex-listing-meta"><span class="ex-creator">${esc(l.creator)}</span> · <span class="ex-license">${esc(l.license)}</span> · <span class="ex-version">v${esc(l.version)}</span></span>
</a></li>`;
}

function empty(text, href = '/submit', label = 'List something') {
    return `<div class="ex-empty"><p>${esc(text)}</p><a class="ex-btn ex-btn-quiet" href="${esc(href)}">${esc(label)}</a></div>`;
}

function passport(p = {}, { id = 'ex-passport' } = {}) {
    const rows = ['reads', 'writes', 'spends', 'contacts'];
    const value = (key) => {
        const list = Array.isArray(p[key]) ? p[key] : [];
        if (!list.length) return key === 'spends' ? '<span class="ex-none">Nothing — v1 has no money</span>' : '<span class="ex-none">Nothing</span>';
        return `<ul class="ex-passport-list">${list.map((x) => `<li>${key === 'contacts' ? `<code>${esc(x)}</code>` : `<code>${esc(x)}</code>`}</li>`).join('')}</ul>`;
    };
    return `<section class="ex-passport"${id ? ` id="${id}"` : ''} aria-label="Permission passport">
<div class="ex-section-head"><h2>Permission passport</h2><span class="ex-passport-stamp" aria-hidden="true">passport</span></div>
<p class="ex-fine">Exactly what this listing declares it can read, write, spend and contact. The passport is checked in the sandbox and snapshotted at install; a later edit to the listing cannot widen an old install.</p>
<dl class="ex-passport-grid">
${rows.map((key) => `<div class="ex-passport-row ex-passport-${key}"><dt>${esc(PASSPORT_LABEL[key])}</dt><dd>${value(key)}</dd></div>`).join('')}
</dl>
</section>`;
}

function testsBlock(tests = []) {
    return `<section class="ex-tests-sec" id="ex-tests" aria-labelledby="ex-tests-h">
<div class="ex-section-head"><h2 id="ex-tests-h">Tests for this version</h2>${tests.length && tests.every((t) => t.status === 'passed') ? '<span class="ex-verified">✓ all pass</span>' : '<span class="ex-unverified">not passing</span>'}</div>
${tests.length ? `<ul class="ex-tests">${tests.map((t) => `<li class="ex-test ex-test-${esc(t.status)}"><span class="ex-test-name"><b>${esc(t.name)}</b> <span class="ex-test-status">${esc(t.status)}</span></span><span class="ex-test-detail">${esc(t.detail || '')}</span></li>`).join('')}</ul>` : '<p class="ex-muted">No conformance test has been recorded for this version.</p>'}
</section>`;
}

/** The room's picture: two arrows looping an item between makers, and a passport stamping. */
function motif() {
    return `<div class="ex-motif" aria-hidden="true">
<svg class="ex-motif-arrows" viewBox="0 0 420 260" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M84 92c32-46 92-62 148-42 30 11 54 34 68 62" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
<path d="m286 96 16 18-24 6" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M336 168c-32 46-92 62-148 42-30-11-54-34-68-62" stroke="currentColor" stroke-width="3" stroke-linecap="round" opacity=".55"/>
<path d="m134 164-16-18 24-6" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity=".55"/>
</svg>
<span class="ex-motif-item ex-motif-item-a">a template</span>
<span class="ex-motif-item ex-motif-item-b">a theme</span>
<span class="ex-motif-passport"><small>passport</small><b>safe</b></span>
</div>`;
}

function home({ listings = [], counts = {} } = {}) {
    // Real first (the owner, 10-31: empty sections made the rooms look unfinished): Fresh listings shows only with listings
    // in it; an empty market is one short "be the first" row after the scenes.
    const live = listings.length ? `<section class="ex-section" id="ex-listings" aria-labelledby="ex-listings-h">
<div class="ex-section-head"><h2 id="ex-listings-h">Fresh listings</h2><a class="ex-more" href="/listings">All listings${kit.icon('chevron')}</a></div>
<ol class="ex-grid">${listings.slice(0, 8).map(card).join('')}</ol>
</section>` : '';
    const beFirst = listings.length ? '' : `<section class="ex-section ex-first" aria-labelledby="ex-first-h"><h2 id="ex-first-h">Be the first</h2>
<ul class="ex-first-list"><li><b>List the first thing you made</b><span>A template, a theme, an agent or a tool, with the passport that says what it can touch. Free and swap only in v1.</span><a href="/submit">List something</a></li></ul></section>`;
    const room = sc.room({
        room: 'exchange',
        hero: {
            title: 'Trade what people make',
            lede: 'Agents, MCP tools, templates, themes, game assets and creator services — each with a permission passport that says exactly what it can read, write, spend and contact. Try it in the sandbox, install it with those grants, revoke it in one tap. Free and swap only in v1: there is no money.',
            start: { href: '/listings', label: 'Browse the listings' },
            chips: [{ label: 'List something', href: '/submit' }, { label: 'Safety rules', href: '/safety' }, { label: 'The API', href: '/developers' }],
            proof: Number(counts.listings) ? [
                { value: Number(counts.listings), label: Number(counts.listings) === 1 ? 'listing' : 'listings' },
                { value: Number(counts.free) || 0, label: 'free' },
                { value: Number(counts.swap) || 0, label: 'swap' },
                { value: Number(counts.makers) || 0, label: Number(counts.makers) === 1 ? 'maker' : 'makers' },
            ] : [],
            motif: motif(),
        },
        scenes: [
            {
                title: 'Try it in the sandbox',
                text: 'A sandbox trial reads the listing\'s manifest and checks its passport before anything is installed. v1 is an honest dry run: Exchange does not execute a listing\'s code, and says so. A passed trial is good for one hour and is required before an install.',
                html: `<div class="ex-demo ex-demo-sandbox"><span class="ex-demo-head">sandbox trial</span><ul class="ex-demo-checks"><li>✓ manifest names the entry point</li><li>✓ passport declares no spend</li><li>✓ 4 conformance tests passed</li><li class="ex-muted">dry run: no listing code runs</li></ul></div>`,
                action: { href: '/listings', label: 'Find something to try' },
            },
            {
                title: 'Install it and see its passport grants',
                text: 'The install keeps the exact passport it was made with: read, write and contact grants, and no spend in v1. The listing page shows the same passport before and after, so nothing arrives hidden.',
                html: `<div class="ex-demo ex-demo-passport"><span class="ex-demo-head">permission passport</span><ul class="ex-demo-grants"><li><b>reads</b> search.read · space.files.read</li><li><b>writes</b> space.files.write</li><li><b>spends</b> nothing</li><li><b>contacts</b> api.example.com</li></ul><span class="ex-demo-stamp">installed</span></div>`,
                action: { href: '/installs', label: 'See your installations' },
            },
            {
                title: 'Revoke it in one tap',
                text: 'A revoke marks the installation revoked on the spot and removes the passport with it. In v1 the Exchange install record is the entitlement; v2 also calls Network\'s grant revoke, so the access disappears everywhere at once.',
                html: `<div class="ex-demo ex-demo-revoke"><span class="ex-demo-head">your installation</span><span class="ex-demo-row"><b>A starter site</b><span class="ex-ok">active</span></span><span class="ex-demo-row ex-muted">passport snapshot · 2026-10-28</span><span class="ex-demo-button">Revoke</span></div>`,
                action: { href: '/installs', label: 'Manage installations' },
            },
        ],
        faq: {
            items: [
                ['What is a permission passport?', 'A listing\'s public declaration of what it can read, write, spend and contact, taken from its manifest. It is shown on every listing, checked in the sandbox and snapshotted at install. In v1 a passport may not declare a spend at all.'],
                ['Is anything paid?', 'No. v1 is free and swap only: no prices, no Billing, no cash, no Vibes, and no way to pay through Exchange. A listing or offer that asks for money is refused.'],
                ['What does the sandbox actually run?', 'In v1, nothing of the listing\'s. It is a manifest and passport dry run that records its checks. A real Run sandbox is the next version\'s job; the capability it will need is named in the README.'],
                ['How do I give something away or swap it?', 'List it as free or swap. A free listing takes claims; a swap listing asks what you would like in return and takes offers. Accepting one closes the listing as given or swapped.'],
                ['Can I take something back?', 'Yes. Revoke an installation in one tap from Installations. Closing a listing stops new offers and removes it from search and the public list; an install you already made stays until you revoke it.'],
            ],
        },
    });
    // What is real goes above the scenes; what is still missing goes after them.
    const at = room.indexOf('<section class="sc-room-scenes"');
    const end = at < 0 ? -1 : room.indexOf('</section>', at) + '</section>'.length;
    const page = at < 0 ? live + room + beFirst : room.slice(0, at) + live + room.slice(at, end) + beFirst + room.slice(end);
    return `<div class="ex-wrap ex-home" id="ex-home">${page}</div>`;
}

function filtersBar(filters = {}) {
    const f = { q: '', mode: '', kind: '', ...filters };
    return `<form class="ex-filters" id="ex-filters" method="get" action="/listings" role="search">
<label class="ex-field"><span>Search</span><input type="search" name="q" value="${esc(f.q)}" maxlength="120" placeholder="a template, a theme, a maker…"></label>
<label class="ex-field"><span>Mode</span><select name="mode"><option value="">Free and swap</option><option value="free"${f.mode === 'free' ? ' selected' : ''}>Free</option><option value="swap"${f.mode === 'swap' ? ' selected' : ''}>Swap</option></select></label>
<label class="ex-field"><span>Kind</span><select name="kind"><option value="">Every kind</option>${Object.entries(KIND_LABEL).map(([k, label]) => `<option value="${esc(k)}"${f.kind === k ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></label>
<button class="ex-btn" type="submit">Filter</button>
</form>`;
}

function listingsPage({ listings = [], nextCursor = null, filters = {} } = {}) {
    const q = filters.q ? `&q=${encodeURIComponent(filters.q)}` : '';
    const mode = filters.mode ? `&mode=${encodeURIComponent(filters.mode)}` : '';
    const kind = filters.kind ? `&kind=${encodeURIComponent(filters.kind)}` : '';
    return `<div class="ex-wrap" id="ex-listings-page">
<header class="ex-page-h"><p class="ex-kicker">The marketplace</p><h1>Everything people make</h1>
<p class="ex-lede">Free and swap only in v1. Every listing carries its permission passport, its licence and the conformance tests for its version. Try before you install; revoke any time.</p></header>
${filtersBar(filters)}
${listings.length ? `<ol class="ex-grid">${listings.map(card).join('')}</ol>` : empty('No listing matches this filter yet.', '/listings', 'Clear the filters')}
${nextCursor ? `<p class="ex-more-row"><a class="ex-btn ex-btn-quiet" href="/listings?cursor=${encodeURIComponent(nextCursor)}${q}${mode}${kind}">More listings</a></p>` : ''}
</div>`;
}

function offerList(offers = [], { owner = false } = {}) {
    if (!offers.length) return '<p class="ex-muted">No open claim or offer yet.</p>';
    return `<ul class="ex-offers-list">${offers.map((o) => `<li class="ex-offer" data-offer="${esc(o.id)}">
<div class="ex-offer-head"><b class="ex-offer-from">${esc(o.from_name)}</b><span class="ex-offer-kind">${o.kind === 'claim' ? 'claims this' : 'offers a swap'}</span><span class="ex-offer-when">${time(o.created_at)}</span></div>
<p class="ex-offer-body">${esc(o.body)}</p>
${o.give ? `<p class="ex-offer-give"><b>In return:</b> ${esc(o.give)}</p>` : ''}
${owner ? `<div class="ex-actions"><form method="post" action="/offers/${esc(o.id)}/accept" class="ex-inline"><button class="ex-btn ex-btn-small" type="submit">Accept${o.kind === 'claim' ? ' the claim' : ' the swap'}</button></form><form method="post" action="/offers/${esc(o.id)}/decline" class="ex-inline"><button class="ex-btn ex-btn-small ex-btn-quiet" type="submit">Decline</button></form></div>` : `<form method="post" action="/offers/${esc(o.id)}/withdraw" class="ex-inline"><button class="ex-btn ex-btn-small ex-btn-quiet" type="submit">Withdraw</button></form>`}
</li>`).join('')}</ul>`;
}

function listingPage({
    listing: l, tests = [], mine = false, staff = false, signedIn = false, activeInstall = null,
    trialPassed = false, offers = [], received = false, problem = null, notice = null,
} = {}) {
    const offersOpen = l.status === 'listed';
    const ownerPanel = mine ? `<section class="ex-owner" id="ex-owner" aria-labelledby="ex-owner-h">
<div class="ex-section-head"><h2 id="ex-owner-h">Your listing</h2>${statusBadge(l.status)}</div>
<p class="ex-fine">A draft becomes public only when every conformance test for this version has passed. Closing it stops new offers and removes it from the public list; a closed listing cannot be relisted.</p>
${l.status === 'draft' ? `<form method="post" action="/listings/${esc(l.slug)}/list" class="ex-inline"><button class="ex-btn" type="submit"${l.tests && l.tests.verified ? '' : ' disabled'}>List it publicly</button></form>` : ''}
${l.status === 'draft' && !(l.tests && l.tests.verified) ? '<p class="ex-note is-bad">Fix the failed tests before this can be public.</p>' : ''}
${l.status === 'listed' ? `<form method="post" action="/listings/${esc(l.slug)}/close" class="ex-inline"><input type="hidden" name="reason" value="withdrawn"><button class="ex-btn ex-btn-quiet" type="submit">Close the listing</button></form>` : ''}
${l.status === 'closed' ? `<p class="ex-muted">Closed: ${esc(CLOSED_LABEL[l.closed_reason] || l.closed_reason || 'closed')}.</p>` : ''}
</section>` : '';

    const sandbox = offersOpen ? `<section class="ex-sandbox-sec" id="ex-sandbox" aria-labelledby="ex-sandbox-h">
<div class="ex-section-head"><h2 id="ex-sandbox-h">Try it in the sandbox</h2>${trialPassed ? '<span class="ex-verified">✓ trial passed</span>' : ''}</div>
<p class="ex-fine">A manifest and passport dry run. v1 does not execute the listing\'s code; it records the checks and gives you a one-hour pass to install.</p>
${signedIn ? `<form method="post" action="/listings/${esc(l.slug)}/sandbox" class="ex-inline"><button class="ex-btn" type="submit">Run the sandbox</button></form>` : `<p class="ex-note"><a href="/auth/login?next=${encodeURIComponent(`/listings/${l.slug}`)}">Sign in</a> to try this listing in the sandbox.</p>`}
</section>` : '';

    const install = offersOpen ? `<section class="ex-install-sec" id="ex-install" aria-labelledby="ex-install-h">
<div class="ex-section-head"><h2 id="ex-install-h">Install</h2>${activeInstall ? '<span class="ex-status ex-status-active">installed</span>' : ''}</div>
${activeInstall ? `<p class="ex-fine">Installed version ${esc(activeInstall.version)} with the passport below. Revoking removes it here and, from v2, at Network too.</p><form method="post" action="/installs/${esc(activeInstall.id)}/revoke" class="ex-inline"><button class="ex-btn ex-btn-quiet" type="submit">Revoke in one tap</button></form>` : ''}
${!activeInstall && trialPassed ? `<p class="ex-fine">Your sandbox trial passed for version ${esc(l.version)}. The install keeps this passport; it does not widen it.</p><form method="post" action="/listings/${esc(l.slug)}/install" class="ex-inline"><button class="ex-btn" type="submit">Install with these grants</button></form>` : ''}
${!activeInstall && !trialPassed && signedIn && !mine ? '<p class="ex-note">Run the sandbox first: a passed trial for this version is required before an install.</p>' : ''}
${!signedIn ? `<p class="ex-note"><a href="/auth/login?next=${encodeURIComponent(`/listings/${l.slug}`)}">Sign in</a> to install.</p>` : ''}
</section>` : '';

    const offerForm = offersOpen && signedIn && !mine ? `<section class="ex-offer-form-sec" id="ex-offer-form" aria-labelledby="ex-offer-form-h">
<div class="ex-section-head"><h2 id="ex-offer-form-h">${l.mode === 'free' ? 'Claim this' : 'Offer a swap'}</h2>${modeBadge(l.mode)}</div>
<form method="post" action="/listings/${esc(l.slug)}/offers" class="ex-form">
<label class="ex-field"><span>${l.mode === 'free' ? 'Say why you would like it' : 'What you offer in return'}</span><textarea name="${l.mode === 'free' ? 'body' : 'body'}" rows="3" maxlength="1000" required></textarea></label>
${l.mode === 'swap' ? `<label class="ex-field"><span>What you are giving</span><textarea name="give" rows="3" maxlength="1000" required></textarea></label>` : ''}
<button class="ex-btn" type="submit">${l.mode === 'free' ? 'Send the claim' : 'Send the offer'}</button>
</form>
<p class="ex-fine">No money changes hands. A swap is between the two people; accepting one closes the listing.</p>
</section>` : '';

    const offersSection = mine && offers.length ? `<section class="ex-offers-sec" id="ex-offers" aria-labelledby="ex-offers-h">
<div class="ex-section-head"><h2 id="ex-offers-h">Open ${l.mode === 'free' ? 'claims' : 'offers'}</h2><span class="ex-count">${offers.length}</span></div>
${offerList(offers, { owner: true })}
</section>` : '';

    return `<div class="ex-wrap" id="ex-listing" data-listing="${esc(l.slug)}">
<article class="ex-listing">
<header class="ex-listing-h">
<p class="ex-kicker">${kindLabel(l.kind)} · ${modeBadge(l.mode)}${statusBadge(l.status)}${staff ? ' · <span class="ex-staff">staff view</span>' : ''}</p>
<h1>${esc(l.title)}</h1>
<p class="ex-lede">${esc(l.summary)}</p>
<p class="ex-byline">by <span class="ex-creator">${esc(l.creator)}</span> · version <span class="ex-version">${esc(l.version)}</span> · <span class="ex-license">${esc(l.license)}</span>${l.license_url ? ` · <a href="${esc(l.license_url)}" rel="nofollow noopener">the licence</a>` : ''}${l.official ? ' · <span class="ex-official">listed by OpenVibe</span>' : ''}</p>
</header>

${notice ? `<p class="ex-note" role="status">${esc(notice)}</p>` : ''}
${problem ? `<p class="ex-note is-bad" role="alert">${esc(problem)}</p>` : ''}

<section class="ex-about" id="ex-about" aria-labelledby="ex-about-h">
<h2 id="ex-about-h">About this listing</h2>
${l.description ? `<div class="ex-prose">${esc(l.description).replace(/\n/g, '<br>')}</div>` : '<p class="ex-muted">The maker has not added a longer description.</p>'}
${l.mode === 'swap' && l.wants ? `<p class="ex-wants"><b>Wants in return:</b> ${esc(l.wants)}</p>` : ''}
<dl class="ex-facts">
<div><dt>Version</dt><dd>${esc(l.version)}</dd></div>
<div><dt>Licence</dt><dd>${esc(l.license)}</dd></div>
<div><dt>Mode</dt><dd>${esc(MODE_LABEL[l.mode] || l.mode)}</dd></div>
<div><dt>Listed</dt><dd>${l.listed_at ? time(l.listed_at) : 'not yet'}</dd></div>
<div><dt>Revision</dt><dd>${Number(l.revision) || 1}</dd></div>
${l.home_url ? `<div><dt>Home</dt><dd><a href="${esc(l.home_url)}" rel="noopener">${esc(l.home_url)}</a></dd></div>` : ''}
</dl>
</section>

${l.files && l.files.length ? `<section class="ex-files" id="ex-files" aria-labelledby="ex-files-h">
<div class="ex-section-head"><h2 id="ex-files-h">Downloads</h2><span class="ex-count">${l.files.length} files</span></div>
<p class="ex-fine">Every file is generated from the same tokens, so pick the platform you need; the format is on each file.</p>
<ul class="ex-file-list">${l.files.map((f) => `<li><a href="${esc(f.url)}" rel="noopener" download><b>${esc(f.label)}</b><span>${esc(f.format)}</span></a></li>`).join('')}</ul>
</section>` : ''}

${passport(l.passport)}
${testsBlock(tests)}
${sandbox}
${install}
${offersSection}
${offerForm}
${ownerPanel}

<section class="ex-manifest" id="ex-manifest" aria-labelledby="ex-manifest-h">
<div class="ex-section-head"><h2 id="ex-manifest-h">Manifest</h2></div>
<dl class="ex-facts"><div><dt>Name</dt><dd>${esc(l.manifest ? l.manifest.name : '')}</dd></div><div><dt>Entry</dt><dd><code>${esc(l.manifest ? l.manifest.entry : '')}</code></dd></div><div><dt>Runtime</dt><dd>${esc(l.manifest && l.manifest.runtime ? l.manifest.runtime : 'not stated')}</dd></div></dl>
<p class="ex-fine">Public metadata only. A manifest that looks like a credential is refused when the listing is submitted.</p>
</section>

<footer class="ex-listing-foot"><p class="ex-fine">${esc(SAFETY_NOTE)}</p></footer>
</article>
</div>`;
}

const SAFETY_NOTE = 'v1 is free and swap only: nobody should send money. Read the passport before installing, and revoke anything you no longer use.';

const textarea = (name, value, rows = 4, max = 4000) => `<textarea name="${name}" rows="${rows}" maxlength="${max}">${esc(value || '')}</textarea>`;

function submitForm({ values = {}, mine = [], problem = null } = {}) {
    const v = {
        title: '', kind: 'template', mode: 'free', summary: '', description: '', wants: '', license: 'CC0-1.0',
        license_url: '', version: '1.0.0', manifest_name: '', manifest_entry: '', manifest_runtime: '',
        passport_reads: '', passport_writes: '', passport_contacts: '', ...values,
    };
    return `<div class="ex-wrap" id="ex-submit">
<header class="ex-page-h"><p class="ex-kicker">List something</p><h1>Trade what you make</h1>
<p class="ex-lede">A listing is a draft first. Exchange runs the conformance tests when you submit it; when they pass you can list it publicly. v1 is free or swap only: there is no price and the passport may not declare a spend.</p></header>
${problem ? `<p class="ex-note is-bad" role="alert">${esc(problem)}</p>` : ''}
<form id="ex-listing-form" class="ex-form ex-card" method="post" action="/submit">
<label class="ex-field"><span>Title</span><input name="title" type="text" maxlength="120" required value="${esc(v.title)}" placeholder="A starter website template"></label>
<div class="ex-field-row">
<label class="ex-field"><span>Kind</span><select name="kind">${Object.entries(KIND_LABEL).map(([k, label]) => `<option value="${esc(k)}"${v.kind === k ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></label>
<label class="ex-field"><span>Mode</span><select name="mode"><option value="free"${v.mode === 'free' ? ' selected' : ''}>Free</option><option value="swap"${v.mode === 'swap' ? ' selected' : ''}>Swap</option></select></label>
</div>
<label class="ex-field"><span>Summary</span><input name="summary" type="text" maxlength="600" required value="${esc(v.summary)}" placeholder="What it is, in one line."></label>
<label class="ex-field"><span>Description</span>${textarea('description', v.description, 6, 4000)}</label>
<label class="ex-field"><span>What a swap wants in return (swap only)</span><input name="wants" type="text" maxlength="300" value="${esc(v.wants)}" placeholder="A type kit, a game map, a skill swap…"></label>
<div class="ex-field-row">
<label class="ex-field"><span>Licence (SPDX)</span><input name="license" type="text" maxlength="64" required value="${esc(v.license)}" placeholder="CC0-1.0"></label>
<label class="ex-field"><span>Licence URL (optional)</span><input name="license_url" type="url" maxlength="300" value="${esc(v.license_url)}" placeholder="https://…"></label>
<label class="ex-field"><span>Version</span><input name="version" type="text" maxlength="32" required value="${esc(v.version)}" placeholder="1.0.0"></label>
</div>
<fieldset class="ex-fieldset"><legend>Permission passport</legend>
<p class="ex-fine">One permission per line. Reads and writes are lower-case names such as <code>search.read</code> or <code>space.files.write</code>; contacts are https origins. Spending is fixed to nothing in v1.</p>
<label class="ex-field"><span>Can read</span>${textarea('passport_reads', v.passport_reads, 3, 1000)}</label>
<label class="ex-field"><span>Can write</span>${textarea('passport_writes', v.passport_writes, 3, 1000)}</label>
<label class="ex-field"><span>Can contact</span>${textarea('passport_contacts', v.passport_contacts, 3, 1000)}</label>
<label class="ex-field"><span>Can spend</span><input type="text" value="Nothing — v1 has no money" disabled></label>
</fieldset>
<fieldset class="ex-fieldset"><legend>Manifest</legend>
<p class="ex-fine">Public metadata only: the name, the entry point and the runtime. Never put a secret, token or key in a manifest; it is refused.</p>
<label class="ex-field"><span>Manifest name</span><input name="manifest_name" type="text" maxlength="80" required value="${esc(v.manifest_name)}" placeholder="Starter site"></label>
<label class="ex-field"><span>Entry point</span><input name="manifest_entry" type="text" maxlength="200" required value="${esc(v.manifest_entry)}" placeholder="templates/starter/index.html"></label>
<label class="ex-field"><span>Runtime</span><input name="manifest_runtime" type="text" maxlength="80" value="${esc(v.manifest_runtime)}" placeholder="static"></label>
</fieldset>
<div class="ex-actions"><button class="ex-btn" type="submit">Save the draft</button><a class="ex-btn ex-btn-quiet" href="/listings">Cancel</a></div>
<p class="ex-fine">By listing you confirm you have the rights to what you share and that it follows the <a href="/safety">safety rules</a>.</p>
</form>
${mine.length ? `<section class="ex-mine" id="ex-mine" aria-labelledby="ex-mine-h"><div class="ex-section-head"><h2 id="ex-mine-h">Your listings</h2><span class="ex-count">${mine.length}</span></div><ul class="ex-mine-list">${mine.map((l) => `<li class="ex-mine-item"><a href="/listings/${esc(l.slug)}">${esc(l.title)}</a> ${statusBadge(l.status)} ${modeBadge(l.mode)} <span class="ex-muted">v${esc(l.version)}</span></li>`).join('')}</ul></section>` : ''}
</div>`;
}

function sandboxPage({ trial, listing } = {}) {
    const t = trial;
    return `<div class="ex-wrap" id="ex-sandbox-trial" data-trial="${esc(t.id)}">
<header class="ex-page-h"><p class="ex-kicker">Sandbox trial</p><h1>${t.status === 'passed' ? 'The dry run passed' : 'The dry run did not pass'}</h1>
<p class="ex-lede">${esc(listing ? listing.title : '')} · version ${esc(t.version)}. ${t.status === 'passed' ? 'You can install this version with its passport until the trial expires.' : 'Nothing was installed. Fix the failed checks and try again.'}</p></header>
<p class="ex-note ${t.status === 'passed' ? '' : 'is-bad'}" role="status">Status: <b>${esc(t.status)}</b> · expires ${time(t.expires_at)}</p>
<ul class="ex-checks">${(t.checks || []).map((c) => `<li class="ex-check ex-check-${esc(c.status)}"><b>${esc(c.name)}</b> <span>${esc(c.status)}</span><span class="ex-check-detail">${esc(c.detail || '')}</span></li>`).join('')}</ul>
${passport(t.passport)}
<div class="ex-actions">
${t.status === 'passed' && !t.consumed_at && listing ? `<form method="post" action="/listings/${esc(listing.slug)}/install" class="ex-inline"><button class="ex-btn" type="submit">Install with these grants</button></form>` : ''}
${t.consumed_at ? '<p class="ex-fine">This trial was used by an install. Run a fresh one to install again.</p>' : ''}
<a class="ex-btn ex-btn-quiet" href="/listings/${esc(listing ? listing.slug : '')}">Back to the listing</a>
</div>
</div>`;
}

function installsPage({ installs = [] } = {}) {
    const active = installs.filter((i) => i.status === 'active');
    const revoked = installs.filter((i) => i.status !== 'active');
    return `<div class="ex-wrap" id="ex-installs">
<header class="ex-page-h"><p class="ex-kicker">Your installations</p><h1>What you have installed</h1>
<p class="ex-lede">Each install keeps the exact passport it was made with. Revoke in one tap; installing again needs a fresh sandbox trial, so the passport is re-checked.</p></header>
<section class="ex-install-active" id="ex-installs-active" aria-labelledby="ex-installs-active-h">
<div class="ex-section-head"><h2 id="ex-installs-active-h">Active</h2><span class="ex-count">${active.length}</span></div>
${active.length ? `<ul class="ex-install-list">${active.map((i) => `<li class="ex-install" data-install="${esc(i.id)}"><div class="ex-install-main"><a class="ex-install-title" href="/listings/${esc(i.listing.slug)}">${esc(i.listing.title)}</a><span class="ex-install-meta">${esc(KIND_LABEL[i.listing.kind] || i.listing.kind)} · v${esc(i.version)} · installed ${time(i.installed_at)}</span>${passport(i.passport, { id: null })}</div><form method="post" action="/installs/${esc(i.id)}/revoke" class="ex-inline"><button class="ex-btn ex-btn-quiet" type="submit">Revoke</button></form></li>`).join('')}</ul>` : empty('Nothing installed yet. Try a listing in the sandbox, then install it with its passport.', '/listings', 'Browse listings')}
</section>
<section class="ex-install-revoked" id="ex-installs-revoked" aria-labelledby="ex-installs-revoked-h">
<div class="ex-section-head"><h2 id="ex-installs-revoked-h">Revoked</h2><span class="ex-count">${revoked.length}</span></div>
${revoked.length ? `<ul class="ex-install-list">${revoked.map((i) => `<li class="ex-install is-revoked" data-install="${esc(i.id)}"><div class="ex-install-main"><a class="ex-install-title" href="/listings/${esc(i.listing.slug)}">${esc(i.listing.title)}</a><span class="ex-install-meta">v${esc(i.version)} · revoked ${time(i.revoked_at)}</span></div><span class="ex-status ex-status-revoked">revoked</span></li>`).join('')}</ul>` : '<p class="ex-muted">No installation has been revoked.</p>'}
</section>
</div>`;
}

function offersPage({ sent = [], received = [] } = {}) {
    return `<div class="ex-wrap" id="ex-offers">
<header class="ex-page-h"><p class="ex-kicker">Free claims and swap offers</p><h1>Your offers</h1>
<p class="ex-lede">A free listing takes claims, a swap listing takes offers. Accepting one closes the listing as given or swapped; nothing is paid through Exchange.</p></header>
<section id="ex-offers-received" aria-labelledby="ex-offers-received-h">
<div class="ex-section-head"><h2 id="ex-offers-received-h">Received</h2><span class="ex-count">${received.length}</span></div>
${received.length ? `<ul class="ex-offer-list">${received.map((o) => `<li class="ex-offer" data-offer="${esc(o.id)}"><div class="ex-offer-head"><a href="/listings/${esc(o.listing.slug)}">${esc(o.listing.title)}</a><span class="ex-offer-kind">${o.kind === 'claim' ? 'claim' : 'swap offer'}</span><span class="ex-offer-when">${time(o.created_at)}</span></div><p class="ex-offer-body">${esc(o.body)}</p>${o.give ? `<p class="ex-offer-give"><b>In return:</b> ${esc(o.give)}</p>` : ''}<span class="ex-status ex-status-${esc(o.status)}">${esc(o.status)}</span>${o.status === 'open' ? `<div class="ex-actions"><form method="post" action="/offers/${esc(o.id)}/accept" class="ex-inline"><button class="ex-btn ex-btn-small" type="submit">Accept</button></form><form method="post" action="/offers/${esc(o.id)}/decline" class="ex-inline"><button class="ex-btn ex-btn-small ex-btn-quiet" type="submit">Decline</button></form></div>` : ''}</li>`).join('')}</ul>` : '<p class="ex-muted">Nobody has claimed or offered on your listings yet.</p>'}
</section>
<section id="ex-offers-sent" aria-labelledby="ex-offers-sent-h">
<div class="ex-section-head"><h2 id="ex-offers-sent-h">Sent</h2><span class="ex-count">${sent.length}</span></div>
${sent.length ? `<ul class="ex-offer-list">${sent.map((o) => `<li class="ex-offer" data-offer="${esc(o.id)}"><div class="ex-offer-head"><a href="/listings/${esc(o.listing.slug)}">${esc(o.listing.title)}</a><span class="ex-offer-kind">${o.kind === 'claim' ? 'claim' : 'swap offer'}</span><span class="ex-offer-when">${time(o.created_at)}</span></div><p class="ex-offer-body">${esc(o.body)}</p><span class="ex-status ex-status-${esc(o.status)}">${esc(o.status)}</span>${o.status === 'open' ? `<form method="post" action="/offers/${esc(o.id)}/withdraw" class="ex-inline"><button class="ex-btn ex-btn-small ex-btn-quiet" type="submit">Withdraw</button></form>` : ''}</li>`).join('')}</ul>` : '<p class="ex-muted">You have not claimed or offered on a listing yet.</p>'}
</section>
</div>`;
}

function safetyPage() {
    return `<div class="ex-wrap" id="ex-safety">
<header class="ex-page-h"><p class="ex-kicker">Safety</p><h1>Free and swap, safely</h1>
<p class="ex-lede">OpenVibe.Exchange v1 has no money in it. That removes most of the scams; it does not remove all of them.</p></header>
<p class="ex-note">${esc(SAFETY_NOTE)}</p>
<section><h2>No money, anywhere</h2><ul class="ex-prose-list">
<li>There is no price, no checkout and no Billing in v1. A listing is free or a swap.</li>
<li>Nobody should send money, a gift card, crypto or a deposit for anything here. A listing, offer or passport that asks for payment is refused when it is submitted.</li>
<li>A passport's <b>spend</b> is always nothing in v1. If a listing ever shows a spend in its passport, do not install it; report it to staff.</li>
</ul></section>
<section><h2>Read the passport</h2><p class="ex-prose">The passport says exactly what the listing can read, write and contact. The sandbox checks it, the install snapshots it, and a later edit to the listing cannot widen an install you already made. Revoke anything you no longer use.</p></section>
<section><h2>What may not be listed</h2><p class="ex-prose">The fixed prohibited-items list: weapons and ammunition, illegal drugs, malware and stolen credentials or access, sexual services or content, forged or counterfeit documents, and live animals. Staff can hide anything else that breaks the rules.</p></section>
<section><h2>For a local swap</h2><ul class="ex-prose-list">
<li>Meet in a public place, in daylight if you can, and take someone with you.</li>
<li>Check what you are swapping before you hand anything over; Exchange does not inspect or hold it.</li>
<li>Keep the arrangement on the listing where you can, and keep a copy of what you agreed.</li>
<li>Never share a password, a token or a private key to prove something works. A listing's manifest is public metadata and must never carry one.</li>
</ul></section>
<section><h2>What Exchange does not do</h2><p class="ex-prose">Exchange does not execute a listing in v1 (the sandbox is a dry run), does not hold a swap in escrow, and does not guarantee that a maker owns what they list. The licence on the listing is the maker's promise; read it before you install.</p></section>
</div>`;
}

function developersPage() {
    const ep = (m, p, d) => `<div><dt><code>${esc(m)} ${esc(p)}</code></dt><dd>${d}</dd></div>`;
    return `<div class="ex-wrap" id="ex-developers">
<header class="ex-page-h"><p class="ex-kicker">Developers</p><h1>The Exchange API</h1>
<p class="ex-lede">JSON under <code>/api/v1</code>, with <code>application/problem+json</code> errors. A person is the <code>exchange_at</code> session cookie or a Network user token as a Bearer.</p></header>
<section><h2>Read</h2><dl class="ex-eps">
${ep('GET', '/api/v1/listings?limit=&cursor=&mode=&kind=&q=', 'Public listings, interleaved by kind, newest first inside each kind; cursor-paged (at most 50).')}
${ep('GET', '/api/v1/listings/:slug', 'One listing with its passport, manifest, licence, tests and counters. A draft/hidden/closed one is 404 unless it is yours or you are staff.')}
${ep('GET', '/api/v1/listings/:slug/passport', 'The exact passport and manifest an installer accepts.')}
${ep('GET', '/api/v1/listings/:slug/tests', 'The conformance tests for the version the listing names.')}
</dl></section>
<section><h2>Write (signed in, same-origin)</h2><dl class="ex-eps">
${ep('POST', '/api/v1/listings', '<code>{ title, kind, mode, summary, description?, wants?, license, license_url?, version, manifest: { name, entry, runtime? }, passport: { reads, writes, spends, contacts } }</code>. Saves a draft; <code>spends</code> must be empty.')}
${ep('POST', '/api/v1/listings/:slug/list', 'Publish a draft after every conformance test for its version passed.')}
${ep('POST', '/api/v1/listings/:slug/close', '<code>{ reason: "withdrawn"|"given"|"swapped" }</code>, the owner. Closes it and tombstones its Search document.')}
${ep('POST', '/api/v1/listings/:slug/sandbox', 'Run a manifest dry-run trial. A passed trial is valid for the configured window.')}
${ep('GET', '/api/v1/sandbox/:id', 'One trial of yours and its checks.')}
${ep('POST', '/api/v1/listings/:slug/install', 'Install with the passport snapshot. 409 <code>exchange.sandbox_required</code> without a passed trial for this version.')}
${ep('GET', '/api/v1/installs', 'Your installations, active and revoked.')}
${ep('POST', '/api/v1/installs/:id/revoke', 'Revoke in one tap. Idempotent.')}
${ep('POST', '/api/v1/listings/:slug/offers', '<code>{ body, give? }</code>: a free claim, or a swap offer with what you give. No money.')}
${ep('GET', '/api/v1/offers', 'The offers you sent and received.')}
${ep('POST', '/api/v1/offers/:id/accept|decline|withdraw', 'The owner accepts/declines; the sender withdraws. Accepting closes the listing as given or swapped.')}
${ep('GET', '/api/v1/me/listings', 'Every listing of yours, all statuses.')}
</dl></section>
<section><h2>Staff (Network role <code>global_mod</code> or above)</h2><dl class="ex-eps">
${ep('POST', '/api/v1/listings/:slug/hide', 'Hide a listing and tombstone its Search document.')}
${ep('GET', '/api/v1/listings/:slug/offers', 'The open claims/offers on a listing.')}
</dl></section>
<section id="ex-search"><h2>Search</h2><p class="ex-fine">Each public listing is one <code>search.index-document@1</code> (owner <code>exchange</code>, type <code>listing</code>, canonical page <code>/listings/&lt;slug&gt;</code>) queued in <code>exchange_outbox</code>; closing or hiding it queues a tombstone. The outbox waits for Network's <code>search.document.write</code> grant; the relay is not part of v1.</p></section>
<section id="ex-grants"><h2>Grants v1 does not have yet</h2><p class="ex-fine">The plan enforces a passport with Network grants and executes a listing in a Run sandbox. v1 does neither: an install is an Exchange record and the sandbox is a dry run. The service will ask for <code>network.grants.write</code> and <code>network.grants.revoke</code> before an install/revoke can reach Network, <code>run.sandbox.execute</code> before a trial can run code, and <code>search.document.write</code> before the outbox can reach Search. Account export and deletion need <code>network.account.export.contribute</code> and <code>network.account.deletion.confirm</code>; the two Events subscriptions need <code>events.subscription.manage</code>.</p></section>
</div>`;
}

function signIn({ title, text, next }) {
    return `<div class="ex-wrap ex-page-pad ex-narrow"><div class="ex-empty"><h1>${esc(title)}</h1><p>${esc(text)}</p><a class="ex-btn" href="/auth/login?next=${encodeURIComponent(next)}">Sign in with OpenVibe</a></div></div>`;
}

function notFound() {
    return `<div class="ex-wrap ex-page-pad ex-narrow"><div class="ex-empty" id="ex-not-found"><p class="ex-kicker">404</p><h1>This listing is not here</h1><p>It may have been closed, hidden by staff, or the address was never a listing.</p><a class="ex-btn" href="/listings">Browse the listings</a></div></div>`;
}

module.exports = {
    home, listingsPage, listingPage, submitForm, sandboxPage, installsPage, offersPage, safetyPage, developersPage,
    signIn, notFound, passport, testsBlock, card, empty, kindLabel, modeBadge, statusBadge,
    KIND_LABEL, MODE_LABEL, STATUS_LABEL, CLOSED_LABEL, PASSPORT_LABEL, SAFETY_NOTE,
};
