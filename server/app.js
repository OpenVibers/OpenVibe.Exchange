'use strict';

/**
 * OpenVibe.Exchange — Express app factory; server/index.js listens, tests build their own instance with a temp
 * database and a mock Network.
 *
 *   /, /models, /m/:org/:model, /chat, /api, /sell, /uncensored, /ai   the pages (http/pages.js)
 *   /api/v1/*                                                         410: Exchange v1 is retired
 *   /auth/*                                                           Network SSO with PKCE (auth/sso.js)
 *   /api/health, /api/ready, /release.json, /metrics                  (loopback only)
 *   /internal/events                                                  account export/deletion (loopback only)
 *
 * The site is a read of OpenVibe.AI (server/ai.js): the catalog, the usage, and the chat runs it makes for a
 * person. Exchange keeps two things of its own: a person's chats and their 18+ confirmation. Nothing is
 * written to Exchange v1's tables any more: they stay as they are, read-only.
 */
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const contracts = require('openvibe-contracts');
const cache = require('openvibe-shared/cache-policy');

const configLib = require('./config');
const { openStore } = require('./db');
const { createKeyStore } = require('./auth/keys');
const { createSso } = require('./auth/sso');
const { createPrincipal } = require('./http/principal');
const { createAi } = require('./ai');
const { createNetwork } = require('./network');
const { createBench } = require('./bench');
const { createOpenApi } = require('./openapi');
const { createArenaStore } = require('./arena/store');
const { createCatalogHistory } = require('./catalog-history');
const { createChatStore, createAdultStore } = require('./chat/store');
const { createCharacterStore, createCompanionChatStore } = require('./companions/store');
const { createGroupStore } = require('./companions/group');
const { createVoiceClient } = require('./companions/voice');
const { createSharing } = require('./sharing');
const { createAdultAccount } = require('./companions/adult');
const { createMemoryClient, createCompanionNotes } = require('./companions/memory');
const { createLorebooks } = require('./companions/lorebook');
const { createLocker } = require('./companions/locker');
const { createNoteTaker } = require('./companions/taking-notes');
const { createPageRoutes } = require('./http/pages');
const { createConsoleRoutes } = require('./http/console');
const { createArenaRoutes } = require('./http/arena');
const { createCompanionRoutes } = require('./http/companions');
const { createServiceReadiness } = require('./observability');
const { assetVersion, send } = require('./render/layout');
const { raw } = require('./render/html');

const accountDataLib = require('./identity/account-data');
const { createNetworkSender } = require('openvibe-sdk/account-data');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const VERSION = require('../package.json').version;
const { createHttpTelemetry } = require('openvibe-sdk/service');
const { createPgTelemetrySink } = require('openvibe-sdk/telemetry');

/**
 * opts: config, store, now (clock), fetchImpl (Network), ai (a stand-in client) / aiFetchImpl, log, valkey,
 * accountSend (a stand-in for Network's internal routes; tests only), telemetrySink.
 */
async function createApp(opts = {}) {
    const config = opts.config || configLib.load();
    const log = opts.log || console;
    const fetchImpl = opts.fetchImpl || globalThis.fetch;
    const s = opts.store || await openStore(config, { now: opts.now, log });
    // IndexNow (openvibe-shared/indexnow): created once from INDEXNOW_KEY; unset → off, nothing mounted,
    // nothing sent. The new pages ping it after a deploy (server/index.js), and the key file is served here.
    const indexnow = opts.indexnow !== undefined ? opts.indexnow : require('openvibe-shared/indexnow').createIndexNow({
        host: config.baseUrl, key: config.indexnow.key, ...(opts.fetchImpl ? { fetch: fetchImpl } : {}), log,
    });

    // The sharing system's own DDL (openvibe-sdk/share). The migration role creates it in production; the runtime

    const keys = createKeyStore({ config, fetchImpl, log });
    const sso = createSso({ config, keys, fetchImpl, now: s.now, log });
    const principal = createPrincipal({ config, keys });

    const ai = opts.ai || createAi({ config, fetchImpl: opts.aiFetchImpl || globalThis.fetch, log, now: s.now });
    // Network, read and changed with the person's own token: their machines and their machine pools.
    const network = opts.network || createNetwork({ config, fetchImpl, log });
    const bench = opts.bench || createBench({ config, fetchImpl: opts.benchFetchImpl || globalThis.fetch, log, now: s.now });
    const arenaStore = createArenaStore(s);
    const history = createCatalogHistory({ s, log });
    const chats = createChatStore(s);
    const adult = createAdultStore(s);
    // Companions (2026-11-06): the cards, their chats, and the one sharing system they use.
    const characters = createCharacterStore(s);
    const companionChats = createCompanionChatStore(s);
    // Group chats (step 5) and the voice (step 6): the groups of the person, and the client that asks
    // OpenVibe.Chat for the sound of an answer in the character's own voice.
    const groups = createGroupStore(s);
    const voice = createVoiceClient({ config, fetchImpl, log });
    const sharing = createSharing({ db: s.db, config, fetchImpl, log });
    // The 18+ confirmation, read from the account on Network (Network PR #587).
    const adultAccount = createAdultAccount({ config, fetchImpl, log, now: s.now });
    // The memory notes (stage 3): the index here, the text in the person's own memory (OpenVibe.AI's M2 store),
    // read and written with the person's own session token. The lorebook (stage 4) is ours, and the Locker
    // (openvibe-sdk/locker) seals what the person asks to be sealed.
    const memory = createMemoryClient({ config, fetchImpl: opts.aiFetchImpl || globalThis.fetch, log });
    const notes = createCompanionNotes({ db: s.db, memory, config, log });
    const lorebooks = createLorebooks({ db: s.db, config, log });
    const locker = createLocker({ config, fetchImpl, log });
    const noteTaker = createNoteTaker({ ai, notes, config, log });

    // Account export and deletion (ADR-033). The sender posts to Network's internal routes with this service's own
    // client-credentials token; a test injects a stand-in through opts.accountSend.
    const accountData = accountDataLib.create({ db: s.db, log });
    const accountSend = opts.accountSend || (config.oauth.clientSecret
        ? createNetworkSender({ networkInternalUrl: config.networkInternalUrl, clientId: config.oauth.clientId, clientSecret: config.oauth.clientSecret, fetch: fetchImpl })
        : async () => { throw new Error('OV_OAUTH_CLIENT_SECRET is not set: Exchange cannot answer account events'); });

    const openapi = createOpenApi({ config, fetchImpl: opts.openapiFetch || globalThis.fetch, log });
    const ctx = { config, s, keys, sso, principal, ai, network, bench, arenaStore, history, openapi, chats, adult, adultAccount, characters, companionChats, groups, voice, sharing, accountData, accountSend, memory, notes, lorebooks, locker, noteTaker, indexnow, log };

    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', config.trustProxy);
    const release = require('openvibe-shared/release').createRelease({ service: 'exchange', root: path.join(__dirname, '..') });
    require('./render/layout').setRelease(release.release);
    const metrics = require('openvibe-shared/metrics').instrument(app, { service: 'exchange', release: release.release });
    app.locals.metrics = metrics.registry;
    ctx.telemetry = createHttpTelemetry({ service: 'exchange', sink: opts.telemetrySink || createPgTelemetrySink({ db: s.db, log }), skipPrefixes: ['/shared'], intervalMs: 60_000 });
    app.use(ctx.telemetry.middleware());
    app.locals.ctx = ctx;

    const valkey = opts.valkey !== undefined ? opts.valkey : (config.valkey.url ? require('openvibe-sdk/valkey').createValkey({ url: config.valkey.url, prefix: config.valkey.prefix, log }) : null);
    ctx.valkey = valkey;

    app.use(contracts.http.middleware());
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'", 'https://openvibe.network', 'https://static.cloudflareinsights.com'],
                styleSrc: ["'self'", "'unsafe-inline'", 'https://openvibe.network', 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
                fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://cdnjs.cloudflare.com'],
                imgSrc: ["'self'", 'data:', 'https://openvibe.network', 'https://openvibe.media'],
                connectSrc: ["'self'", 'https://openvibe.network', 'https://openvibe.chat', 'https://cloudflareinsights.com', 'https://openvibe.events', 'https://ai.openvibe.services'],
                frameSrc: ["'self'", 'https://openvibe.network'],
                frameAncestors: ["'none'"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'", 'https://openvibe.network'],
            },
        },
        frameguard: { action: 'deny' },
        crossOriginEmbedderPolicy: false,
        crossOriginResourcePolicy: { policy: 'same-site' },
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }));
    app.use(cookieParser());

    // ── Machine endpoints ───────────────────────────────────
    app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'openvibe-exchange', name: 'OpenVibe.Exchange', version: VERSION }));
    // IndexNow's key file (/<key>.txt), when a key is configured.
    if (indexnow.enabled) app.use(indexnow.keyFile);
    release.mount(app, { registry: metrics.registry });
    const readiness = createServiceReadiness({ s, config, release: release.release, valkey, sso });
    app.get('/api/ready', readiness.handler);

    // ── Who is asking (verified offline; refreshed when expired) ──
    app.use(sso.middleware());

    // ── Sign-in (OAuth2 + PKCE client of OpenVibe.Network) ──
    app.use('/auth/', rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }));
    app.use('/auth', sso.routes());
    { const legal = require('openvibe-shared/legal'); app.get(legal.PATHS, legal.handler({ id: 'exchange', service: 'exchange', host: 'openvibe.exchange', name: 'OpenVibe.Exchange', profile: 'ugc' })); }

    // ── OpenVibe.Events → this service (loopback only) ──────
    // Account export/deletion; the consumer reads the raw body itself, so it is mounted before any body parser.
    // nginx answers 404 for /internal/.
    app.use('/internal/events', accountData.consumer({
        secrets: config.events.secrets,
        send: accountSend,
        now: s.now,
        onEvent: async (ev) => `ignored:${ev.event_type}`,
    }));

    // ── Static assets (content-hashed ?v= → immutable) ──────
    app.use('/shared', require('openvibe-shared/serve').handler());
    app.use(express.static(PUBLIC_DIR, {
        index: false, redirect: false,
        setHeaders(res, filePath) {
            const rel = path.relative(PUBLIC_DIR, filePath).split(path.sep).join('/');
            const v = res.req && res.req.query && res.req.query.v;
            res.setHeader('Cache-Control', cache.assetHeaders(rel, { hashed: !!v && v === assetVersion(rel) }));
        },
    }));

    // ── /api/v1/<kind>/<id>/share — the one Share sheet's API (openvibe-sdk/share) ──
    // GET/PUT /api/v1/chat/:id/share, /character/:id/share, /arena-round/:id/share, and their requests and
    // transfers, plus GET /api/v1/share/people?name= and /api/v1/shared-with-me. Access is still decided by
    // canView on every read; the router only answers its own paths.
    {
        const shareApi = express.Router();
        shareApi.use(sharing.shares.router({
            service: 'exchange',
            authenticate: (req) => sharing.shareViewer(req.viewer),
            describe: sharing.describe,
        }));
        const SHARE_PATH = /^\/api\/v1\/(?:shared-with-me$|share\/people$|[^/]+\/[^/]+\/share(?:\/|$))/;
        app.use((req, res, next) => (SHARE_PATH.test(req.path) ? shareApi(req, res, next) : next()));
    }

    // Expire members and transfers and send queued share events/notifications. Unref'd: it never holds a test open.
    if (opts.startSharingWorker !== false) {
        const timer = setInterval(() => { sharing.work().catch(() => { /* logged inside */ }); }, 15_000);
        if (timer.unref) timer.unref();
        app.locals.sharingTimer = timer;
    }

    // ── Exchange v1's JSON API: gone ────────────────────────
    app.use('/api/v1', (req, res) => {
        res.set('Cache-Control', 'public, max-age=86400');
        return contracts.http.sendProblem(res, 410, 'exchange.retired', {
            detail: 'Exchange v1 is retired. Its API was free and swap listings; the new Exchange is the network\'s AI: every model, one account. The public API is https://api.openvibe.exchange/v1 and the site is /api.',
            ctx: req.ov,
        });
    });
    app.use('/api', (req, res, next) => {
        // GET /api is the site's API page (http/pages.js), not a route of this catch-all.
        if (req.path === '/' && (req.method === 'GET' || req.method === 'HEAD')) return next();
        return contracts.http.sendProblem(res, 404, 'route.not_found', { detail: 'No such API route', ctx: req.ov });
    });

    // ── Pages ───────────────────────────────────────────────
    app.use(rateLimit({ windowMs: 60_000, limit: Number(process.env.EXCHANGE_RATE_LIMIT_PER_MIN) || 300, standardHeaders: true, legacyHeaders: false }));
    // ── Agent layer (openvibe-shared/agent-layer) ───────────
    // The manifest and the Markdown twins of the public pages. Gated to twin requests only, so a browser and a
    // page drawn for a signed-in person always reach the site's own routes; the twin renderer is always signed out.
    {
        const agentLayer = require('openvibe-shared/agent-layer');
        const agent = express.Router();
        agent.use((req, _res, next) => {
            const twinPath = req.path.endsWith('.md');
            const twinFormat = req.query.format === 'markdown';
            const twinAccept = !!(req.headers.accept && req.accepts(['html', 'text/markdown']) === 'text/markdown');
            if (req.path === '/.well-known/agent.json' || twinPath || twinFormat || twinAccept) return next();
            return next('router');
        });
        agentLayer.mount(agent, { descriptor: require('./agent-descriptor'), render: require('./agent-pages').createAgentPages(ctx).renderPublicPage });
        app.use(agent);
    }
    // The companions routes come before the pages router: /companions, /c/... and /talk/...
    app.use(createCompanionRoutes(ctx));
    // The Arena and the rankings: /arena, /arena/:id and /rankings.
    app.use(createArenaRoutes(ctx));
    app.use(createPageRoutes(ctx));
    app.use(createConsoleRoutes(ctx));

    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, _next) => {
        log.error('[OpenVibe.Exchange]', err && err.message ? err.message.slice(0, 300) : err);
        if (res.headersSent) return;
        res.set('Cache-Control', cache.htmlHeaders({ private: true }));
        if (err && err.type === 'entity.parse.failed') return contracts.http.sendProblem(res, 400, 'request.malformed_json', { ctx: req.ov });
        if (err && err.type === 'entity.too.large') return req.path.startsWith('/api/') ? contracts.http.sendProblem(res, 413, 'request.too_large', { ctx: req.ov }) : res.status(413).type('text/plain').send('That request was too large.');
        if (req.path.startsWith('/api/')) return contracts.http.sendProblem(res, 500, 'internal.error', { detail: 'Internal error', ctx: req.ov });
        res.status(500).type('text/plain').send('Something went wrong on our side. Try again in a moment.');
    });

    return { app, ctx };
}

module.exports = { createApp };
