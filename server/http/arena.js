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
const kit = require('openvibe-shared/kit');
const { asyncRouter } = require('./router');
const { sameOrigin } = require('./principal');
const { raw } = require('../render/html');
const { send } = require('../render/layout');
const views = require('../views/arena');
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
    const { config, ai, bench, arenaStore, log } = ctx;
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

    async function renderHome(req, res, { problem = null, status = 200 } = {}) {
        const [catalog, rounds] = await Promise.all([
            ai.catalog(),
            signedIn(req) ? arenaStore.recent(owner(req), 6) : Promise.resolve([]),
        ]);
        return page(req, res, {
            title: 'The Arena', index: !signedIn(req), cache: signedIn(req) ? null : PUBLIC_CACHE,
            description: 'One prompt, two models, side by side and unnamed. Vote, then see both names, their prices and their receipts.',
            body: raw(views.arenaHome({ viewer: req.viewer, catalog, rounds, problem, config })),
        }, status);
    }

    async function renderRound(req, res, round, { problem = null, status = 200, notice = null } = {}) {
        const vote = await arenaStore.voteOf(owner(req), round.id);
        return page(req, res, {
            title: 'The Arena', index: false,
            body: raw(views.arenaRound({ round, vote, revealed: Boolean(vote), problem: problem || notice, config })),
        }, status);
    }

    r.get('/arena', async (req, res) => renderHome(req, res));

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
        return res.redirect(303, `/arena/${round.id}`);
    });

    r.get('/arena/:id', async (req, res) => {
        if (!signedIn(req)) return signInPage(req, res, { title: 'Sign in to see this round', text: 'Your rounds are yours.', next: `/arena/${encodeURIComponent(req.params.id)}` });
        const round = await arenaStore.get(owner(req), req.params.id);
        if (!round) return page(req, res, { title: 'Not found', index: false, body: raw(`<div class="ex-wrap ex-narrow">${kit.empty({ icon: 'search', title: 'No such round', text: 'It may belong to another account, or the link is old.', action: { href: '/arena', label: 'The Arena' } })}</div>`) }, 404);
        return renderRound(req, res, round);
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
