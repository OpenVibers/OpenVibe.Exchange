'use strict';

/**
 * OpenVibe.Exchange configuration. Every value comes from the environment (production:
 * /etc/openvibe/exchange.env, see .env.example). Only environment variable NAMES appear in code and docs; secrets
 * are never logged.
 *
 * load(env) is pure so tests can build a config without touching process.env.
 */
require('dotenv').config();
const trim = (s) => String(s || '').replace(/\/+$/, '');
const int = (v, def) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : def);

function load(env = process.env) {
    const nodeEnv = env.NODE_ENV || 'development';
    const isProduction = nodeEnv === 'production';
    const port = int(env.PORT, 5150);
    const baseUrl = trim(env.BASE_URL || (isProduction ? 'https://openvibe.exchange' : `http://localhost:${port}`));
    const networkUrl = trim(env.OV_NETWORK_URL || 'https://openvibe.network');

    return {
        service: 'exchange',
        port,
        host: env.HOST || '127.0.0.1',
        nodeEnv,
        isProduction,
        baseUrl,
        trustProxy: env.TRUST_PROXY != null ? Number(env.TRUST_PROXY) : 2,
        drill: env.EXCHANGE_DRILL === '1' || env.EXCHANGE_DRILL === 'true',
        limits: {
            minute: Math.max(1, int(env.EXCHANGE_LIMITS_MINUTE, 120)),
            hour: Math.max(1, int(env.EXCHANGE_LIMITS_HOUR, 3000)),
        },

        // PostgreSQL (ADR-035): DATABASE_URL serves (PgBouncer), DATABASE_DIRECT_URL migrates (owner role). In
        // development without DATABASE_URL an embedded PGlite database in data/pglite is used.
        db: { url: env.DATABASE_URL || '', directUrl: env.DATABASE_DIRECT_URL || '', pgliteDir: env.EXCHANGE_PGLITE_DIR || '' },
        valkey: { url: env.VALKEY_URL || '', prefix: env.VALKEY_PREFIX || 'ov:exchange:' },

        // OpenVibe.Network: SSO (OAuth2 authorization server with PKCE) and its JWKS.
        networkUrl,
        networkInternalUrl: trim(env.OV_NETWORK_INTERNAL_URL || 'http://127.0.0.1:4000'),
        networkIssuer: trim(env.OV_NETWORK_ISSUER || networkUrl),
        audience: env.EXCHANGE_AUDIENCE || 'openvibe.exchange',
        oauth: {
            clientId: env.OV_OAUTH_CLIENT_ID || 'exchange',
            clientSecret: env.OV_OAUTH_CLIENT_SECRET || '',
            redirectUri: env.OV_OAUTH_REDIRECT_URI || `${baseUrl}/auth/callback`,
            scope: 'profile',
            sessionAudience: env.OV_SESSION_AUDIENCE || 'openvibe.network',
        },
        cookies: { secure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : isProduction },

        // OpenVibe.Events → this service's account export/deletion route. The secret signs a delivery
        // (comma-separated for rotation, 32+ characters each); unset turns POST /internal/events off (503).
        events: {
            secrets: String(env.EXCHANGE_EVENTS_SECRET || '').split(',').map((x) => x.trim()).filter(Boolean),
            url: trim(env.EXCHANGE_EVENTS_URL || env.EVENTS_URL || ''),
            endpoint: env.EXCHANGE_EVENTS_ENDPOINT || '',
            intervalMs: Math.max(500, int(env.EXCHANGE_EVENTS_INTERVAL_MS, 5000)),
            scope: env.EXCHANGE_EVENTS_SCOPE || 'events.event.publish',
        },

        // OpenVibe.AI (server/ai.js): the public catalog and usage reads, and the chat runs this service makes
        // for a person. The token is the service's own client-credentials grant (ai.run.create, ns ai.complete);
        // the person's Network subject rides on the run as on_behalf_of, so their own allowance and limits apply.
        ai: {
            url: trim(env.OV_AI_URL || 'https://ai.openvibe.services'),
            audience: env.OV_AI_AUDIENCE || 'openvibe.ai',
            scope: env.OV_AI_SCOPE || 'ai.run.create',
            consoleScope: env.OV_AI_CONSOLE_SCOPE || 'ai.usage.read ai.workflow.manage ai.provider.manage',
            timeoutMs: Math.max(2000, int(env.EXCHANGE_AI_TIMEOUT_MS, 30_000)),
            waitMs: Math.max(1000, int(env.EXCHANGE_AI_WAIT_MS, 25_000)),
        },

        // OpenVibe.Bench (server/bench.js): the Arena's rounds and each person's vote are a Bench
        // human_pairwise judgement, and the rankings read the board by task category. The token is this
        // service's own client-credentials grant (bench.round.create, bench.judgement.cast, bench.board.read).
        bench: {
            url: trim(env.OV_BENCH_URL || 'https://bench.openvibe.services'),
            audience: env.OV_BENCH_AUDIENCE || 'openvibe.bench',
            scope: env.OV_BENCH_SCOPE || 'bench.round.create bench.judgement.cast bench.board.read',
            timeoutMs: Math.max(2000, int(env.EXCHANGE_BENCH_TIMEOUT_MS, 15_000)),
        },

        // The Arena (/arena): one prompt, two models, one vote. A round is two runs on the person's own
        // allowance, and a vote is rate-limited per person so a ballot cannot be stuffed from one account.
        arena: {
            perDay: Math.max(1, int(env.EXCHANGE_ARENA_PER_DAY, 10)),
            votesPerHour: Math.max(1, int(env.EXCHANGE_ARENA_VOTES_PER_HOUR, 30)),
            maxChars: Math.max(200, int(env.EXCHANGE_ARENA_MAX_CHARS, 2000)),
            maxTokens: Math.max(100, Math.min(4000, int(env.EXCHANGE_ARENA_MAX_TOKENS, 900))),
        },

        api: {
            publicUrl: trim(env.OV_EXCHANGE_API_URL || 'https://api.openvibe.exchange'),
            openapiUrl: trim(env.OV_EXCHANGE_OPENAPI_URL || 'https://api.openvibe.exchange/openapi.json'),
            openapiCacheMs: Math.max(60_000, int(env.EXCHANGE_OPENAPI_CACHE_MS, 600_000)),
            timeoutMs: Math.max(2000, int(env.EXCHANGE_OPENAPI_TIMEOUT_MS, 15_000)),
        },

        // /companions: the daily allowance a person's companion chats run on, and the free-use
        // price ceiling each answer stays under (a dearer model uses the person's own balance).
        companions: {
            perDay: Math.max(1, int(env.EXCHANGE_COMPANIONS_PER_DAY, 40)),
            maxCostUsd: Math.max(0.001, Number(env.EXCHANGE_COMPANIONS_MAX_COST_USD) || 0.05),
            // The memory notes (stage 3): how many tokens of notes may join a chat's context, how often the
            // cheap model takes notes, and which model takes them (the router's economy alias).
            memoryBudgetTokens: Math.max(100, int(env.EXCHANGE_COMPANIONS_MEMORY_BUDGET_TOKENS, 800)),
            notesEveryTurns: Math.max(1, int(env.EXCHANGE_COMPANIONS_NOTES_EVERY_TURNS, 4)),
            noteModel: String(env.EXCHANGE_COMPANIONS_NOTE_MODEL || 'openvibe/economy').slice(0, 120),
            // The lorebook entries (stage 4): how many tokens of entries may join a chat's context.
            lorebookBudgetTokens: Math.max(100, int(env.EXCHANGE_COMPANIONS_LOREBOOK_BUDGET_TOKENS, 1200)),
            // The images (step 6): off until an image provider is configured for this service. While the switch
            // is off no provider is ever called, and the route refuses with the reason.
            images: {
                enabled: String(env.EXCHANGE_COMPANIONS_IMAGES_ENABLED || '').toLowerCase() === 'true',
                provider: String(env.EXCHANGE_COMPANIONS_IMAGES_PROVIDER || '').slice(0, 60),
            },
        },

        // OpenVibe.Chat (server/companions/voice.js): the answers are read aloud in the character's own
        // voice. The call carries the person's own Network token, so the read-aloud is on their own allowance
        // and on Chat's per-person rate limit; no service token of ours is involved.
        tts: {
            url: trim(env.OV_CHAT_URL || 'https://openvibe.chat'),
            timeoutMs: Math.max(2000, int(env.EXCHANGE_TTS_TIMEOUT_MS, 20_000)),
        },

        // /chat: how many messages a signed-in person may send a day (each one may run up to three models).
        chat: {
            perDay: Math.max(1, int(env.EXCHANGE_CHAT_PER_DAY, 40)),
            models: Math.max(1, Math.min(3, int(env.EXCHANGE_CHAT_MODELS, 3))),
            maxChars: Math.max(200, int(env.EXCHANGE_CHAT_MAX_CHARS, 8000)),
        },

        // openvibe.compare (plan 297): the comparison site is served by this service behind its own name. The
        // host is what makes a request the compare site's; the API is also reachable on openvibe.exchange.
        compare: {
            host: String(env.COMPARE_HOST || 'openvibe.compare').toLowerCase(),
            baseUrl: trim(env.COMPARE_BASE_URL || 'https://openvibe.compare'),
        },

        // IndexNow (openvibe-shared/indexnow): a key makes search engines recrawl a page that appeared or
        // changed. Unset → off: nothing mounted, nothing sent.
        indexnow: { key: String(env.INDEXNOW_KEY || '').trim() },
    };
}

module.exports = { load };
