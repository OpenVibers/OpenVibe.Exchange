'use strict';

/**
 * The Arena and the rankings.
 *
 *   GET  /arena              ask one prompt, two models answer blind; the person's last rounds
 *   POST /arena/ask          run the pair on the person's own allowance, build the Bench round, redirect to it
 *   GET  /arena/:id          the pair, the vote form, and after the vote both names and their receipts
 *   POST /arena/:id/vote     one vote per person per round; a Bench human_pairwise judgement, then the reveal
 *   GET  /rankings           Bench's board by task category beside AI's price, speed and uptime
 *
 * The models are chosen from the live catalogue, free-tier capacity first, by different families where it can
 * be done. Each answer is a normal run on the person's allowance; each vote is theirs in Bench. A vote is
 * rate-limited per person and a second vote on a round is refused, locally and again by Bench.
 */
const express = require('express');
const cache = require('openvibe-shared/cache-policy');
const ovServe = require('openvibe-shared/serve');
const kit = require('openvibe-shared/kit');
const { asyncRouter } = require('./router');
const { sameOrigin } = require('./principal');
const { esc, raw } = require('../render/html');
const { send } = require('../render/layout');
const views = require('../views/arena');
const exchangeViews = require('../views/exchange');
const { classify, CATEGORIES } = require('../arena/category');
const { ARENA_KIND } = require('../bench');

const PUBLIC_CACHE = cache.htmlHeaders({ maxAge: 60 });
const NOT_CHAT = new Set(['embedding', 'embeddings', 'stt', 'asr', 'tts', 'speech', 'image', 'images', 'rerank', 'moderation']);
const OUTCOMES = new Set(['left', 'right', 'tie', 'both_bad']);
const blended = (price) => (Number(price.in) + Number(price.out)) / 2;
const isChat = (m) => !NOT_CHAT.has(String(m.kind || m.type || 'chat').toLowerCase());

/** Every model that may play, best first: free-tier capacity, then health, then price. */
function candidatesOf(catalog) {
    const out = [];
    for (const model of catalog.models || []) {
        if (!isChat(model) || model.uncensored) continue;
        const offers = model.offers || [];
        const priced = offers.filter((o) => o.price).sort((a, b) => blended(a.price) - blended(b.price));
        const offer = priced[0] || offers[0];
        if (!offer) continue;
        const uptimes = offers.map((o) => Number(o.uptime)).filter(Number.isFinite);
        const speeds = offers.map((o) => Number(o.speed && o.speed.p50_ms)).filter(Number.isFinite);
        out.push({
            model, offer,
            modelId: offer.id || model.slug,
            free: offers.some((o) => o.free_tier === true || o.free === true),
            uptime: uptimes.length ? Math.max(...uptimes) : 0,
            p50: speeds.length ? Math.min(...speeds) : Number.POSITIVE_INFINITY,
            price: offer.price ? blended(offer.price) : Number.POSITIVE_INFINITY,
        });
    }
    out.sort((a, b) => (Number(b.free) - Number(a.free)) || (b.uptime - a.uptime) || (a.price - b.price) || a.model.slug.localeCompare(b.model.slug));
    return out;
}

/** The first two, from different families when the catalogue allows it; the rest are the retry list. */
function pickPair(candidates) {
    if (candidates.length < 2) return { pair: [], rest: [] };
    const first = candidates[0];
    const second = candidates.find((c) => c.model.slug !== first.model.slug && (c.model.family || '') !== (first.model.family || ''))
        || candidates.find((c) => c.model.slug !== first.model.slug);
    const pair = second ? [first, second] : [];
    const rest = candidates.filter((c) => !pair.includes(c));
    return { pair, rest };
}

function createArenaRoutes(ctx) {
    const { config, ai, bench, arenaStore, sharing, log } = ctx;
    const r = asyncRouter();
    r.use(express.urlencoded({ extended: false, limit: '64kb' }));
    const page = (req, res, o, status = 200) => send(res, status, { viewer: req.viewer, config, path: req.originalUrl, ...o });
    const signedIn = (req) => Boolean(req.viewer && req.viewer.kind === 'user' && req.viewer.subject);
    const owner = (req) => req.viewer.subject;
    const signInPage = (req, res, { title, text, next, status = 401 }) => page(req, res, {
        title, index: false,
        body: raw(`<div class="ex-wrap ex-narrow">${kit.empty({ icon: 'person', title, text, action: { href: `/auth/login?next=${encodeURIComponent(next || req.originalUrl)}`, label: 'Sign in with OpenVibe' } })}</div>`),
    }, status);
    const notFromHere = (req, res) => page(req, res, {
        title: 'Not from this site', index: false,
        body: raw(`<div class="ex-wrap ex-narrow">${kit.empty({ icon: 'shield', title: 'That came from somewhere else', text: 'Use the form on OpenVibe.Exchange.' })}</div>`),
    }, 403);
    const shareHead = `<link rel="stylesheet" href="${ovServe.url('ov-share.css')}"><script src="${ovServe.url('ov-share.js')}" defer></script>`;
    const shareButton = (round) => `<button type="button" class="ovk-btn ovk-btn--quiet" data-ov-share-sheet data-kind="arena-round" data-id="${esc(round.id)}" data-title="An Arena round">Share</button>`;
    const notFound = (req, res) => {
        res.set('X-Robots-Tag', 'noindex, nofollow');
        return page(req, res, { title: 'Not found', index: false, body: raw(`<div class="ex-wrap ex-narrow">${kit.empty({ icon: 'search', title: 'No such round', text: 'It may belong to another account, or the link is old.', action: { href: '/arena', label: 'The Arena' } })}</div>`) }, 404);
    };
    /** Specific people, and this reader is not on the list: the audience, never the prompt or an answer. */
    const gate = (req, res, id) => {
        const signedInAs = req.viewer && req.viewer.kind === 'user' ? (req.viewer.username || '') : '';
        const signInUrl = `/auth/login?next=${encodeURIComponent(req.originalUrl)}`;
        return page(req, res, {
            title: 'Shared with specific people', index: false, head: shareHead,
            // The gate draws itself from this markup (openvibe-shared 4.123.0's [data-ov-share-gate]): no inline
            // script, so a strict CSP needs nothing, and every value is escaped like any other attribute.
            body: raw(`<div class="ex-wrap ex-narrow"><div id="share-gate" data-ov-share-gate data-kind="arena-round" data-id="${esc(id)}" data-signed-in-as="${esc(signedInAs)}" data-sign-in-url="${esc(signInUrl)}">This round is shared with specific people. Sign in with the OpenVibe account it was shared with, or ask its owner for access.</div></div>`),
        }, 404);
    };

    async function renderHome(req, res, { problem = null, status = 200 } = {}) {
        const [catalog, rounds] = await Promise.all([
            ai.catalog(),
            signedIn(req) ? arenaStore.recent(owner(req), 6) : Promise.resolve([]),
        ]);
        const defaults = signedIn(req)
            ? exchangeViews.audienceDefaults({
                kind: 'arena-round', label: 'rounds', action: '/arena/defaults', signedIn: true,
                current: await sharing.defaultOf(owner(req), 'arena-round').catch(() => 'private'),
            }) : '';
        return page(req, res, {
            title: 'The Arena', index: !signedIn(req), cache: signedIn(req) ? null : PUBLIC_CACHE,
            description: 'One prompt, two models, side by side and unnamed. Vote, then see both names, their prices and their receipts.',
            body: raw(views.arenaHome({ viewer: req.viewer, catalog, rounds, problem, config, defaults })),
        }, status);
    }

    async function renderRound(req, res, round, { problem = null, status = 200, notice = null } = {}) {
        const vote = await arenaStore.voteOf(owner(req), round.id);
        return page(req, res, {
            title: 'The Arena', index: false, head: shareHead,
            body: raw(views.arenaRound({ round, vote, revealed: Boolean(vote), problem: problem || notice, config, action: shareButton(round) })),
        }, status);
    }

    r.get('/arena', async (req, res) => renderHome(req, res));

    /** The person's default for new rounds ("New rounds: Only me"), and what to do with the existing ones. */
    r.post('/arena/defaults', async (req, res) => {
        if (!signedIn(req)) return res.redirect(303, '/auth/login?next=%2Farena');
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const body = req.body || {};
        const audience = ['private', 'people', 'link', 'public'].includes(body.audience) ? body.audience : 'private';
        await sharing.setDefault(owner(req), 'arena-round', audience, { applyAll: String(body.apply_all || '') === '1' }).catch((err) => log.warn('[Arena] the round default was not saved:', err.message));
        return res.redirect(303, '/arena');
    });

    r.post('/arena/ask', async (req, res) => {
        if (!signedIn(req)) return signInPage(req, res, { title: 'Sign in to enter the Arena', text: 'Two models answer your prompt, blind.', next: '/arena' });
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const prompt = String((req.body && req.body.prompt) || '').trim().slice(0, config.arena.maxChars);
        if (!prompt) return renderHome(req, res, { problem: 'Write a prompt first.', status: 422 });

        const asked = await arenaStore.askedToday(owner(req));
        if (asked >= config.arena.perDay) {
            return renderHome(req, res, { problem: `That is today's ${config.arena.perDay} arena prompts. The allowance resets at midnight UTC.`, status: 429 });
        }

        const catalog = await ai.catalog();
        if (catalog.unavailable) return renderHome(req, res, { problem: 'The live catalogue is not reachable right now. Reload in a moment.', status: 503 });
        const { pair, rest } = pickPair(candidatesOf(catalog));
        if (pair.length < 2) return renderHome(req, res, { problem: 'Fewer than two models are live right now, so the Arena has nothing to compare.', status: 503 });

        const answer = async (candidate) => {
            const out = await ai.chat({
                model: candidate.modelId, messages: [{ role: 'user', content: prompt }],
                subject: owner(req), maxTokens: config.arena.maxTokens,
            });
            return {
                slug: candidate.model.slug, name: candidate.model.name, family: candidate.model.family,
                answer: out.content || '(no text)', model_id: candidate.modelId, run_id: out.run_id || null,
                provider: out.provider || candidate.offer.provider,
                provider_name: candidate.offer.provider_name || null,
                answered_model: out.model || null,
                cost_usd: out.cost_usd, tokens_in: out.tokens_in, tokens_out: out.tokens_out,
                latency_ms: out.latency_ms, why: out.why, price: candidate.offer.price || null,
            };
        };

        const answers = await Promise.all(pair.map((c) => answer(c).then((value) => ({ value })).catch((err) => ({ err }))));
        const retries = rest.slice();
        for (let i = 0; i < answers.length; i++) {
            if (!answers[i].err) continue;
            while (retries.length && !answers[i].value) {
                const next = retries.shift();
                try { answers[i] = { value: await answer(next) }; } catch (err) { answers[i] = { err }; }
            }
        }
        if (answers.some((a) => a.err || !a.value)) {
            const first = answers.find((a) => a.err);
            log.warn('[OpenVibe.Exchange] arena answer failed:', (first && first.err && first.err.message) || 'no answer');
            const reason = first && first.err && first.err.status === 429
                ? 'Your free allowance for today is spent.'
                : 'One of the two models did not answer. Try the prompt again.';
            return renderHome(req, res, { problem: reason, status: first && first.err && first.err.status === 429 ? 429 : 502 });
        }

        const category = classify(prompt);
        const models = answers.map((a) => a.value);
        let built;
        try {
            built = await bench.createRound({
                prompt, category,
                entries: models.map((m) => ({
                    provider: m.provider || 'openvibe', model: m.slug, answer: m.answer,
                    cost_usd: m.cost_usd, ms: m.latency_ms, tokens: (m.tokens_in || 0) + (m.tokens_out || 0),
                    run_id: m.run_id,
                })),
            });
        } catch (err) {
            log.warn('[OpenVibe.Exchange] arena round was not recorded:', err.message);
            return renderHome(req, res, { problem: 'The Arena could not record that round in OpenVibe.Bench, so no vote would count. Try again in a moment.', status: 503 });
        }

        const entries = (built && Array.isArray(built.entries)) ? built.entries : [];
        const left = entries.find((e) => e.side === 'left') || entries[0] || {};
        const right = entries.find((e) => e.side === 'right') || entries[1] || {};
        if (!left.id || !right.id) {
            return renderHome(req, res, { problem: 'The Arena could not record both answers. Try again.', status: 502 });
        }
        const round = await arenaStore.create({
            owner: owner(req), prompt, category, models,
            benchRoundId: built.round && built.round.id,
            benchLeft: left.id, benchRight: right.id,
        });
        // The person's default for new rounds (Only me unless they changed it), then the sheet for this one.
        const audience = await sharing.defaultOf(owner(req), 'arena-round').catch(() => 'private');
        try { await sharing.register({ subject: owner(req) }, 'arena-round', round.id, audience); } catch (err) { log.warn('[Arena] the round was kept but not registered with the sharing system:', err.message); }
        return res.redirect(303, `/arena/${round.id}`);
    });

    /**
     * A round is its owner's page. Someone it was shared with reads the pair, both names and the receipts, and
     * cannot vote (the owner's vote is the one Bench counted). Anybody else gets the gate for Specific people, or
     * "not found" when it is Only me.
     */
    r.get('/arena/:id', async (req, res) => {
        const round = await arenaStore.find(req.params.id);
        if (!round) return notFound(req, res);
        if (signedIn(req) && round.owner === owner(req)) return renderRound(req, res, round);
        const allowed = await sharing.canView(req.viewer, 'arena-round', round.id).catch(() => false);
        if (!allowed) {
            const audience = await sharing.audienceOf('arena-round', round.id).catch(() => null);
            if (audience === 'people') return gate(req, res, round.id);
            return notFound(req, res);
        }
        const sharedRound = { ...round };
        return page(req, res, {
            title: 'A shared Arena round', index: false,
            head: shareHead,
            body: raw(views.arenaRound({ round: sharedRound, revealed: true, shared: true, config })),
        });
    });

    r.post('/arena/:id/vote', async (req, res) => {
        if (!signedIn(req)) return signInPage(req, res, { title: 'Sign in to vote', text: 'Your vote is a Bench judgement for your account.', next: `/arena/${encodeURIComponent(req.params.id)}` });
        if (!sameOrigin(req, config.baseUrl)) return notFromHere(req, res);
        const round = await arenaStore.get(owner(req), req.params.id);
        if (!round) return page(req, res, { title: 'Not found', index: false, body: raw(`<div class="ex-wrap ex-narrow">${kit.empty({ icon: 'search', title: 'No such round', text: 'It may belong to another account.', action: { href: '/arena', label: 'The Arena' } })}</div>`) }, 404);

        const existing = await arenaStore.voteOf(owner(req), round.id);
        if (existing) return renderRound(req, res, round, { notice: 'You already voted on this round; it is counted once.', status: 409 });

        const recent = await arenaStore.votesLastHour(owner(req));
        if (recent >= config.arena.votesPerHour) {
            return renderRound(req, res, round, { problem: `That is ${config.arena.votesPerHour} votes in an hour, the rate limit. Try again later.`, status: 429 });
        }
        const outcome = String((req.body && req.body.outcome) || '');
        if (!OUTCOMES.has(outcome)) return renderRound(req, res, round, { problem: 'Pick left, right, a tie, or both bad.', status: 422 });

        try {
            const out = await bench.vote({
                roundId: round.bench_round_id, subject: owner(req), outcome,
                pair: { left: round.bench_left, right: round.bench_right },
            });
            await arenaStore.castVote({
                owner: owner(req), roundId: round.id, outcome,
                benchJudgementId: out && out.judgement ? out.judgement.id : null,
            });
            return res.redirect(303, `/arena/${round.id}`);
        } catch (err) {
            if (err.code === 'bench.already_judged') {
                return renderRound(req, res, round, { notice: 'This vote is already counted in OpenVibe.Bench.', status: 409 });
            }
            log.warn('[OpenVibe.Exchange] arena vote failed:', err.message);
            const reason = err.code === 'bench.not_configured' || err.status === 503
                ? 'The Arena is not connected to OpenVibe.Bench right now, so the vote cannot count yet. Nothing was recorded; try again in a moment.'
                : 'OpenVibe.Bench did not accept the vote. Nothing was recorded; try again in a moment.';
            return renderRound(req, res, round, { problem: reason, status: 503 });
        }
    });

    r.get('/rankings', async (req, res) => {
        const wanted = typeof req.query.category === 'string' ? req.query.category : 'all';
        const categories = ['all', ...CATEGORIES];
        const category = categories.includes(wanted) ? wanted : 'all';
        const sort = req.query.sort === 'value' ? 'value' : '';
        const [catalog, usage, board] = await Promise.all([
            ai.catalog(), ai.usage(30), bench.board({ kind: ARENA_KIND, category }),
        ]);
        return page(req, res, {
            title: 'Rankings', index: true, cache: signedIn(req) ? null : PUBLIC_CACHE, agentLayer: true,
            description: 'Model rankings by task category from blind Arena votes, beside each model’s price per million, measured speed and uptime.',
            body: raw(views.rankingsPage({ catalog, usage, board, category, sort, categories })),
        });
    });

    return r;
}

module.exports = { createArenaRoutes, candidatesOf, pickPair };
