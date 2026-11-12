'use strict';

/**
 * POST /api/v1/estimate — what one run of an agent blueprint costs.
 *
 * Body: { blueprint: agents.blueprint@1, turns?: 1..50 } (the blueprint at most 200 KB). The answer:
 *   { usd_per_run, cheapest: { id, name, rung }, free_on, why, turns, tokens: { in, out } }
 *
 * A signed-in person's choices come from OpenVibe.AI's GET /api/v1/choices?task=chat — their own machine, a
 * signed-in plan, their key, the free allowance, then Exchange's credits. Signed out, only OpenVibe's public
 * offers are used, on the allowance and credits rungs. The pricing itself is openvibe-sdk/agents/blueprint's
 * estimate(): this file maps each choice to the Dispatcher's shape and never keeps or logs the blueprint text.
 */
const express = require('express');
const contracts = require('openvibe-contracts');
const blueprint = require('openvibe-sdk/agents/blueprint');
const dispatch = require('openvibe-sdk/agents/dispatch');

const BODY_LIMIT = '200kb';
const DEFAULT_TURNS = 4;
const MAX_TURNS = 50;
const TOKENS = Object.freeze({ in: 2000, out: 800 });
const NOT_CHAT = new Set(['embedding', 'embeddings', 'stt', 'asr', 'tts', 'speech', 'image', 'images', 'rerank', 'moderation']);
const isObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const lower = (v) => String(v == null ? '' : v).toLowerCase();

/** SDK tier names, from whatever size class AI gives (a missing one is medium, never invented). */
function tierOf(option, model) {
    const raw = lower((option && (option.tier || option.size || option.size_class || option.model_size)) || (model && (model.tier || (model.metadata && model.metadata.tier))));
    if (dispatch.TIERS.includes(raw)) return raw;
    if (['large', 'xl', 'frontier', 'strong', 'big'].includes(raw)) return 'strong';
    if (['small', 'mini', 'nano', 'tiny', 'fast', 'light'].includes(raw)) return 'small';
    return 'medium';
}

/** The capabilities AI says the model has, in dispatch's array form. */
function capsOf(option, model) {
    const out = new Set();
    const add = (v) => {
        if (Array.isArray(v)) for (const x of v) { if (typeof x === 'string') out.add(x); }
        else if (isObject(v)) for (const [k, on] of Object.entries(v)) { if (on === true) out.add(k); }
    };
    if (option) { add(option.caps); add(option.capabilities); }
    if (model) add(model.capabilities);
    return [...out];
}

const usableOffer = (o) => o && o.status !== 'down' && o.status !== 'retired';

/** A model's cheapest priced offer: the public per-million price, in USD. */
function cheapestOffer(model) {
    const offers = (model && Array.isArray(model.offers) ? model.offers : []).filter((o) => usableOffer(o) && o.price
        && num(o.price.in) != null && num(o.price.out) != null);
    offers.sort((a, b) => (num(a.price.in) + num(a.price.out)) - (num(b.price.in) + num(b.price.out)));
    return offers[0] || null;
}

/**
 * The price of a choice in USD per million tokens. A rung that is flat or free has none (0): the person's
 * machine, a signed-in plan and the free allowance. A key and credits use the model's catalogue price; when
 * AI sent a per-million price on the choice itself, that is used first.
 */
function priceOf(rung, option, model) {
    if (['machine', 'plan', 'allowance'].includes(rung)) return { in: 0, out: 0 };
    if (option && isObject(option.price) && num(option.price.in) != null && num(option.price.out) != null) {
        return { in: num(option.price.in), out: num(option.price.out) };
    }
    if (option && num(option.price_in) != null && num(option.price_out) != null) return { in: num(option.price_in), out: num(option.price_out) };
    const offer = cheapestOffer(model);
    if (offer) return { in: num(offer.price.in), out: num(offer.price.out) };
    // AI's choice view prices one run of 1,000 in + 1,000 out when it has no per-million field. Use it only as
    // the last resort, split evenly across the two sides, so an unpriced choice is not silently called free.
    const estimated = option ? num(option.price_estimate_usd) : null;
    if (estimated != null) return { in: estimated * 500, out: estimated * 500 };
    return null;
}

/** The rung a choice is on, from its source (and any rung AI states explicitly). */
function rungOf(option, group) {
    if (option && dispatch.RUNGS.includes(option.rung)) return option.rung;
    const source = lower((option && option.source) || group);
    if (['machine', 'machines', 'own-machine', 'own_machine'].includes(source)) return 'machine';
    if (['plan', 'plans'].includes(source)) return 'plan';
    if (['key', 'keys', 'own-key', 'own_key'].includes(source)) return 'key';
    if (source === 'allowance') return 'allowance';
    if (option && (option.free === true || option.free_tier === true || option.allowance === true)) return 'allowance';
    return 'credits';
}

function catalogIndex(catalog) {
    const by = new Map();
    for (const model of (catalog && Array.isArray(catalog.models) ? catalog.models : [])) {
        for (const key of [model.slug, model.canonical, model.id]) {
            if (key && !by.has(lower(key))) by.set(lower(key), model);
        }
    }
    return by;
}

function modelOf(option, index) {
    const id = option && (option.model || option.id);
    return id ? index.get(lower(id)) || null : null;
}

function choice(option, group, index, rung = rungOf(option, group)) {
    const model = modelOf(option, index);
    const id = String((option && (option.model || option.id)) || (model && (model.slug || model.canonical)) || 'unknown');
    const name = String((option && option.name) || (model && model.name) || id);
    const price = priceOf(rung, option, model);
    // A credit choice without a price is not free: it just cannot be estimated, so the Dispatcher passes it over.
    const priced = rung !== 'credits' || price != null;
    return {
        id,
        name,
        rung,
        family: String((option && (option.family || option.maker)) || (model && model.family) || id.split('/')[0] || ''),
        tier: tierOf(option, model),
        caps: capsOf(option, model),
        context: num(option && (option.context || option.context_window)) || num(model && model.context) || 0,
        speed: num(option && (option.speed || option.tokens_per_second || option.speed_tps)),
        price,
        available: priced && !(option && (option.available === false || option.status === 'down' || option.status === 'retired')),
    };
}

const hasFreeTier = (model) => Boolean(model && Array.isArray(model.offers) && model.offers.some((o) => usableOffer(o) && (o.free_tier === true || o.free === true)));

/**
 * The choices in AI's GET /api/v1/choices answer, mapped to the Dispatcher's shape. An OpenVibe model that the
 * free allowance may serve is offered on the allowance rung too, because the same model can run on either.
 */
function choicesFromView(view, catalog) {
    const index = catalogIndex(catalog);
    const options = (view && view.options) || {};
    const out = [];
    for (const group of ['openvibe', 'keys', 'machines', 'plans', 'allowance']) {
        for (const option of (Array.isArray(options[group]) ? options[group] : [])) {
            if (!isObject(option)) continue;
            const rung = rungOf(option, group);
            out.push(choice(option, group, index, rung));
            const model = modelOf(option, index);
            if (group === 'openvibe' && rung === 'credits' && hasFreeTier(model)) {
                out.push(choice(option, group, index, 'allowance'));
            }
        }
    }
    // The resolved choice is a person's pick and may not be in the options list: include it when it is concrete.
    const resolved = view && view.choice;
    if (isObject(resolved) && resolved.model && !String(resolved.model).startsWith('openvibe/')) {
        if (!out.some((c) => c.id === resolved.model)) out.push(choice(resolved, resolved.source, index));
    }
    return out;
}

/** Signed out: only OpenVibe's public offers, on the allowance and credits rungs. */
function publicChoices(catalog) {
    const out = [];
    for (const model of (catalog && Array.isArray(catalog.models) ? catalog.models : [])) {
        const kind = lower(model.kind || model.type || 'chat');
        if (NOT_CHAT.has(kind) || model.uncensored === true) continue;
        const id = String(model.slug || model.canonical || model.id || '');
        if (!id) continue;
        const base = {
            id, name: String(model.name || id), family: String(model.family || id.split('/')[0] || ''),
            tier: tierOf(null, model), caps: capsOf(null, model), context: num(model.context) || 0,
            speed: null, available: true,
        };
        const offer = cheapestOffer(model);
        if (offer) out.push({ ...base, rung: 'credits', price: { in: num(offer.price.in), out: num(offer.price.out) } });
        if (hasFreeTier(model)) out.push({ ...base, rung: 'allowance', price: { in: 0, out: 0 } });
    }
    return out;
}

function createEstimateRoutes({ ai }) {
    const r = express.Router();
    r.use(express.json({ limit: BODY_LIMIT }));

    r.post('/', async (req, res) => {
        const body = isObject(req.body) ? req.body : {};
        const doc = body.blueprint;
        if (!isObject(doc)) {
            return contracts.http.sendProblem(res, 422, 'blueprint.invalid', {
                detail: 'Send the blueprint as { "blueprint": { ... } }.',
                errors: [{ at: '/blueprint', why: 'a blueprint is an object' }], ctx: req.ov,
            });
        }

        let turns = DEFAULT_TURNS;
        if (body.turns !== undefined) {
            turns = Number(body.turns);
            if (!Number.isInteger(turns) || turns < 1 || turns > MAX_TURNS) {
                return contracts.http.sendProblem(res, 422, 'turns.invalid', {
                    detail: `turns is a whole number from 1 to ${MAX_TURNS}.`,
                    errors: [{ at: '/turns', why: `a whole number from 1 to ${MAX_TURNS}` }], ctx: req.ov,
                });
            }
        }

        const shape = contracts.validate('agents.blueprint@1', doc);
        const rules = blueprint.validate(doc);
        if (!shape.valid || !rules.ok) {
            const errors = [
                ...((shape.errors || []).map((e) => ({ at: e.path || '/', why: e.message }))),
                ...((rules.errors || []).map((e) => ({ at: e.at || '/', why: e.why }))),
            ];
            return contracts.http.sendProblem(res, 422, 'blueprint.invalid', {
                detail: 'The blueprint is not a valid agents.blueprint@1 document.',
                errors, ctx: req.ov,
            });
        }

        const person = req.viewer && req.viewer.kind === 'user' && req.viewer.token ? req.viewer : null;
        let catalog;
        let choices;
        try {
            if (person) {
                // The choices mapping joins AI's choice view to the public catalogue's per-million prices.
                const [cat, view] = await Promise.all([ai.catalog(), ai.meRequest(person.token, '/api/v1/choices?task=chat')]);
                catalog = cat;
                choices = choicesFromView(view, catalog);
            } else {
                catalog = await ai.catalog();
                if (catalog && catalog.unavailable) {
                    return contracts.http.sendProblem(res, 503, 'catalog.unavailable', {
                        detail: 'The public model catalogue is not available right now; no price was estimated.',
                        ctx: req.ov,
                    });
                }
                choices = publicChoices(catalog);
            }
        } catch (err) {
            return contracts.http.sendProblem(res, 503, 'choices.unavailable', {
                detail: err && err.status === 401 ? 'Sign in again to use your own choices.' : 'Your model choices are not available right now; no price was estimated.',
                ctx: req.ov,
            });
        }

        const result = blueprint.estimate(doc, choices, { turns, tokens: { tokensIn: TOKENS.in, tokensOut: TOKENS.out } });
        res.set('Cache-Control', person ? 'private, no-store' : 'public, max-age=60');
        return res.status(200).json({
            usd_per_run: result.usd_per_run,
            cheapest: result.choice ? { id: result.choice.id, name: result.choice.name, rung: result.choice.rung } : null,
            free_on: Array.isArray(result.free_on) ? result.free_on : [],
            why: result.why,
            turns,
            tokens: { in: TOKENS.in, out: TOKENS.out },
        });
    });

    return r;
}

module.exports = { createEstimateRoutes, choicesFromView, publicChoices, tierOf, priceOf };
