'use strict';

/**
 * The page shell: openvibe-shared/shell (the Frame, the theme and the footer) around body markup the pages build
 * with openvibe-shared/kit. Every page is complete without JavaScript.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const appIcon = require('openvibe-shared/app-icon');
const shell = require('openvibe-shared/shell');
const rooms = require('openvibe-shared/rooms');
const ovServe = require('openvibe-shared/serve');
const cache = require('openvibe-shared/cache-policy');
const { render, esc } = require('./html');

const NETWORK_URL = 'https://openvibe.network';
const SITE_NAME = 'OpenVibe.Exchange';
const TAGLINE = 'Every AI model, one account.';
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const NAV = [
    { label: 'Home', href: '/' },
    { label: 'Models', href: '/models' },
    { label: 'Chat', href: '/chat' },
    { label: 'API', href: '/api' },
    { label: 'Sell compute', href: '/sell' },
    { label: 'Uncensored', href: '/uncensored' },
    { label: 'AI in OpenVibe', href: '/ai' },
    { label: 'Status', href: '/status' },
];

const hashes = new Map();
function assetVersion(rel) {
    if (hashes.has(rel)) return hashes.get(rel);
    let v = 'dev';
    try { v = crypto.createHash('sha256').update(fs.readFileSync(path.join(PUBLIC_DIR, rel))).digest('hex').slice(0, 10); } catch { /* missing asset */ }
    hashes.set(rel, v);
    return v;
}
const asset = (rel) => `/${rel}?v=${assetVersion(rel)}`;

let RELEASE = 'dev';
function setRelease(id) { if (id) RELEASE = String(id); }

const active = (pathNow, href) => pathNow === href || (href !== '/' && pathNow.startsWith(`${href}/`));

/**
 * o: title, description, body (html), viewer, config, path, index, cache, jsonLd, head, class
 */
function renderPage(o) {
    const viewer = o.viewer || { kind: 'anonymous' };
    const signedIn = viewer.kind === 'user';
    const pathNow = o.path || '/';
    const loginNext = encodeURIComponent(pathNow);
    const canonical = `${o.config.baseUrl}${pathNow.split('?')[0]}`;
    const nav = {
        service: 'exchange',
        apiBase: NETWORK_URL,
        links: NAV.map((l) => ({ label: l.label, href: l.href, active: active(pathNow, l.href) })),
        history: { type: 'page', title: o.title || SITE_NAME },
        silentLogin: `${o.config.baseUrl}/auth/login?silent=1&next={url}`,
        sessionUrl: '/auth/me',
        loginUrl: '/auth/login?next={path}',
        logoutUrl: '/auth/logout?next={path}',
        notificationsRealtime: true,
    };
    const footer = { service: 'exchange', variant: 'full', mount: '#ov-footer', brandName: SITE_NAME };
    const account = signedIn
        ? `Signed in as <strong>${esc(viewer.displayName || viewer.username || 'you')}</strong> · <a href="/auth/logout?next=${loginNext}">Sign out</a>`
        : `<a href="/auth/login?next=${loginNext}">Sign in with OpenVibe</a>`;
    return shell.page({
        name: SITE_NAME,
        lang: 'en',
        title: o.title || `${SITE_NAME}: ${TAGLINE}`,
        titleSuffix: o.title ? ` · ${SITE_NAME}` : '',
        siteName: SITE_NAME,
        description: o.description || `${SITE_NAME} — ${TAGLINE} Every model's price, speed and uptime, live; one OpenAI-compatible endpoint; chat with one model or three side by side.`,
        canonical,
        agentLayer: Boolean(o.agentLayer),
        robots: o.index === false ? 'noindex, nofollow' : 'index, follow',
        jsonLd: (o.jsonLd || []).filter(Boolean),
        home: '/',
        navLinks: NAV,
        bodyClass: o.app ? 'ex-app' : undefined,
        navbar: nav,
        footer,
        head: `<meta name="referrer" content="strict-origin-when-cross-origin">
${appIcon.headTags({ site: 'exchange' })}
<link rel="stylesheet" href="${ovServe.url('kit.css')}">
<link rel="stylesheet" href="${ovServe.url('kit-data.css')}">
<link rel="stylesheet" href="${ovServe.url('room.css')}">
<link rel="stylesheet" href="${ovServe.url('showcase.css')}">
<link rel="stylesheet" href="${asset('css/exchange.css')}">
<script src="${ovServe.url('motion.js')}" defer></script>
<script src="${ovServe.url('kit-web.js')}" defer></script>
<script src="${asset('js/exchange.js')}" defer></script>
${o.head || ''}
<meta property="og:site_name" content="${SITE_NAME}">
<meta name="theme-color" content="#0b0f17">
<script src="${ovServe.url('boost.js')}" data-main="#main" defer></script>`,
        body: `<a class="skip" href="#main">Skip to content</a>
<div id="navbar-mount"></div>
<noscript><div class="account-bar" role="navigation" aria-label="Account">${account}</div></noscript>
<main id="main" class="ex ov-room ${o.class || ''}" style="${rooms.style('exchange')}">
${render(o.body)}
</main>
<script>
window.__OV_PAGE = ${JSON.stringify({ navbar: nav, footer }).replace(/</g, '\\u003c')};
document.addEventListener('DOMContentLoaded', function () {
  try { if (window.OpenVibeFooter) OpenVibeFooter.init(window.__OV_PAGE.footer); } catch (e) { /* the Frame is optional */ }
});
</script>`,
    });
}

/** Send a page; a page rendered for a signed-in person is private and never cached. */
function send(res, status, o) {
    const personal = o.viewer && o.viewer.kind === 'user';
    if (!res.get('Cache-Control')) res.set('Cache-Control', personal ? cache.htmlHeaders({ private: true }) : (o.cache || cache.htmlHeaders({ private: true })));
    res.set('Vary', 'Cookie');
    if (o.agentLayer) {
        const at = `${o.config.baseUrl}${String(o.path || '/').split('?')[0]}`;
        res.set('Link', require('openvibe-shared/agent-layer').linkHeaderTags(at).header);
    }
    res.status(status).type('html').send(renderPage(o));
}

module.exports = { renderPage, send, asset, assetVersion, setRelease, SITE_NAME, TAGLINE, NETWORK_URL, NAV };
