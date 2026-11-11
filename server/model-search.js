'use strict';

const { ratingFor } = require('./analysis');

const TASKS = {
    coder: ['code', 'coding', 'programming', 'developer'],
    vision: ['image', 'images', 'picture', 'visual'],
    tools: ['agent', 'function', 'tool'],
    json: ['structured', 'json'],
};
const clean = (value) => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const number = (value) => value === '' || value == null ? null : Number.isFinite(Number(value)) ? Number(value) : null;

function parseSearch(query = {}) {
    const q = String(query.q || '').slice(0, 200).trim();
    const words = clean(q).match(/[\p{L}\p{N}]+/gu) || [];
    const intent = {
        cheap: words.some((w) => ['cheap', 'budget', 'affordable', 'barato', 'economico', 'bonmarche'].includes(w)),
        fast: words.some((w) => ['fast', 'quick', 'rapido', 'rapide', 'schnell'].includes(w)),
        capabilities: Object.keys(TASKS).filter((key) => words.some((w) => w === key || TASKS[key].includes(w))),
    };
    const inlineMax = clean(q).match(/(?:under|below|less than|menos de|sous)\s*\$?\s*(\d+(?:\.\d+)?)/);
    const maxPrice = query.max_price !== undefined ? number(query.max_price) : inlineMax ? number(inlineMax[1]) : null;
    const minPrice = query.min_price !== undefined ? number(query.min_price) : null;
    const maxSpeed = query.max_speed_ms !== undefined ? number(query.max_speed_ms) : null;
    const capability = String(query.capability || '').toLowerCase();
    if ([minPrice, maxPrice, maxSpeed].some((n) => n !== null && (n < 0 || n > 1e6))) throw new RangeError('Filters must be between 0 and 1000000.');
    if (capability && !/^[a-z0-9_-]{1,40}$/.test(capability)) throw new RangeError('Invalid capability.');
    const ratingKind = String(query.rating_kind || 'chat.arena');
    if (!/^[a-z0-9][a-z0-9_.-]{0,79}$/.test(ratingKind)) throw new RangeError('Invalid benchmark kind.');
    return { q, words, intent, maxPrice, minPrice, maxSpeed, capability, ratingKind,
        provider: String(query.provider || '').slice(0, 80), sort: ['price', 'speed', 'quality'].includes(query.sort) ? query.sort : 'relevance' };
}

function searchCatalog(catalog, rows, params) {
    const { words, intent, minPrice, maxPrice, maxSpeed, capability, provider } = params;
    const ignored = new Set(['model', 'models', 'a', 'an', 'the', 'for', 'with', 'under', 'below', 'less', 'than', 'de', 'sous', 'cheap', 'budget', 'affordable', 'fast', 'quick', 'coder', 'coding', 'vision', 'image', 'images', 'picture', 'visual', 'code', 'programming', 'developer', 'agent', 'function', 'tool', 'json', 'structured', 'benchmark', 'benchmarks', 'quality']);
    const terms = words.filter((w) => !ignored.has(w) && !/^\d+(?:\.\d+)?$/.test(w));
    const results = [];
    for (const model of catalog.models || []) {
        const caps = model.capabilities || {};
        const hasCap = (key) => key === 'coder' ? Boolean(caps.code || caps.coding || /cod(e|er|ing)/i.test(`${model.name} ${model.slug}`)) : Boolean(caps[key]);
        if (capability && !hasCap(capability)) continue;
        if (intent.capabilities.some((key) => !hasCap(key))) continue;
        const hay = clean([model.name, model.slug, model.family, model.description, ...(model.offers || []).flatMap((o) => [o.provider, o.provider_name])].join(' '));
        if (terms.some((term) => !hay.includes(term))) continue;
        const offers = (model.offers || []).filter((o) => {
            if (provider && !clean(`${o.provider} ${o.provider_name}`).includes(clean(provider))) return false;
            const p = o.price && number(o.price.out);
            const speed = o.speed && number(o.speed.p50_ms);
            if (minPrice !== null && (p === null || p < minPrice)) return false;
            if (maxPrice !== null && (p === null || p > maxPrice)) return false;
            if (maxSpeed !== null && (speed === null || speed > maxSpeed)) return false;
            return true;
        });
        if (!offers.length) continue;
        offers.sort((a, b) => (number(a.price?.out) ?? Infinity) - (number(b.price?.out) ?? Infinity));
        const best = intent.fast ? [...offers].sort((a, b) => (number(a.speed?.p50_ms) ?? Infinity) - (number(b.speed?.p50_ms) ?? Infinity))[0] : offers[0];
        const rating = ratingFor(model, rows);
        const nameScore = terms.reduce((score, term) => score + (clean(model.name).includes(term) ? 2 : 0), 0);
        results.push({ model: model.slug, name: model.name, family: model.family, capabilities: caps,
            provider: best.provider_name || best.provider, price: best.price || null, speed: best.speed || null,
            quality: rating ? { elo: rating.elo, games: rating.games, kind: params.ratingKind } : null,
            offers: offers.length, score: nameScore + (model.requests_7d || 0) / 10000 });
    }
    const sort = params.sort !== 'relevance' ? params.sort : intent.fast ? 'speed' : intent.cheap ? 'price' : 'relevance';
    const metric = (r) => sort === 'speed' ? number(r.speed?.p50_ms) ?? Infinity : sort === 'quality' ? -(number(r.quality?.elo) ?? -Infinity) : number(r.price?.out) ?? Infinity;
    results.sort((a, b) => sort === 'relevance' ? b.score - a.score || metric(a) - metric(b) : metric(a) - metric(b) || b.score - a.score);
    return results;
}

module.exports = { parseSearch, searchCatalog };
