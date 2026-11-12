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
// Six places in the bar, the rest under More (11-07: fourteen links wrapped into two lines and cut the name to
// "OpenVibe..."). Icons are the navbar's own glyphs; the brand is the way home.
const NAV = [
    { label: 'Models', href: '/models', icon: 'fa-microchip' },
    { label: 'Search', href: '/search', icon: 'fa-magnifying-glass' },
    { label: 'Deep dive', href: '/deep-dive', icon: 'fa-compass' },   // fa-binoculars has no glyph: it drew nothing
    { label: 'Pricing', href: '/pricing', icon: 'fa-tag' },
    { label: 'Docs', href: '/docs', icon: 'fa-code' },
    { label: 'Status', href: '/status', icon: 'fa-gauge' },
    { label: 'Rankings', href: 'https://openvibe.report/ai', icon: 'fa-chart-line', more: true },
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
    // A page may belong to a site served by this process behind another name (openvibe.compare): its own name,
    // home, nav and canonical base, while the sign-in, the assets and the theme stay this service's.
    const site = o.site || {};
    const siteName = site.name || SITE_NAME;
    const siteTagline = site.tagline || TAGLINE;
    const siteHome = site.home || '/';
    const siteNav = Array.isArray(site.nav) ? site.nav : NAV;
    const siteBase = String(site.baseUrl || o.config.baseUrl).replace(/\/+$/, '');
    const siteService = site.service || 'exchange';
    const canonical = o.canonical || `${siteBase}${pathNow.split('?')[0]}`;
    const nav = {
        service: siteService,
        apiBase: NETWORK_URL,
        links: [
            ...siteNav.map((l) => ({ label: l.label, href: l.href, icon: l.icon, ...(l.more ? { more: true } : {}), active: active(pathNow, l.href) })),
            ...(signedIn ? [{ label: 'Dashboard', href: '/dashboard', icon: 'fa-key', active: active(pathNow, '/dashboard') }] : []),
            ...(viewer.role === 'owner' ? [{ label: 'AI console', href: '/console', icon: 'fa-sliders', active: active(pathNow, '/console') }] : []),
        ],
        history: { type: 'page', title: o.title || siteName },
        silentLogin: `${o.config.baseUrl}/auth/login?silent=1&next={url}`,
        sessionUrl: '/auth/me',
        tokenUrl: '/auth/navbar-token',
        loginUrl: '/auth/login?next={path}',
        logoutUrl: '/auth/logout?next={path}',
        notificationsRealtime: true,
    };
    const footer = { service: siteService, variant: 'full', mount: '#ov-footer', brandName: siteName };
    const account = signedIn
        ? `Signed in as <strong>${esc(viewer.displayName || viewer.username || 'you')}</strong> · <a href="/auth/logout?next=${loginNext}">Sign out</a>`
        : `<a href="/auth/login?next=${loginNext}">Sign in with OpenVibe</a>`;
    return shell.page({
        name: siteName,
        lang: 'en',
        title: o.title || `${siteName}: ${siteTagline}`,
        titleSuffix: o.title ? ` · ${siteName}` : '',
        siteName,
        description: o.description || `${siteName} — ${siteTagline} Every model's price, speed and uptime, live; one OpenAI-compatible endpoint; chat with one model or three side by side.`,
        canonical,
        agentLayer: Boolean(o.agentLayer),
        robots: o.index === false ? 'noindex, nofollow' : 'index, follow',
        jsonLd: (o.jsonLd || []).filter(Boolean),
        home: siteHome,
        navLinks: siteNav,
        bodyClass: o.bodyClass || (o.app ? 'ex-app' : undefined),
        navbar: nav,
        footer,
        head: `<meta name="referrer" content="strict-origin-when-cross-origin">
${appIcon.headTags({ site: site.icon || 'exchange' })}
<link rel="stylesheet" href="${ovServe.url('kit.css')}">
<link rel="stylesheet" href="${ovServe.url('kit-data.css')}">
<link rel="stylesheet" href="${ovServe.url('kit-layout.css')}">
<link rel="stylesheet" href="${ovServe.url('room.css')}">
<link rel="stylesheet" href="${ovServe.url('showcase.css')}">
<link rel="stylesheet" href="${asset('css/exchange.css')}">
<link rel="stylesheet" href="${asset('css/platform.css')}">
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
<main id="main" class="ex ov-room ov-base ${o.class || ''}" style="${rooms.style('exchange')}">
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
