'use strict';
/**
 * The judge panel: one model from each of several makers, so no single family's blind spot (or its fondness for its
 * own prose) decides. Chosen from OpenVibe.AI's live catalogue: chat models that are not uncensored variants, with a
 * priced offer under the cap, one per maker in MAKERS order, preferring each maker's capable-but-cheap tier. An
 * operator may name the panel (EXCHANGE_DETECT_PANEL, model ids or slugs, in order); missing names are skipped.
 */

const MAKERS = [
    ['Anthropic', /claude/i],
    ['OpenAI', /(^|[/\s-])(gpt|o[1-9]|chatgpt)/i],
    ['Google', /gemini|gemma/i],
    ['DeepSeek', /deepseek/i],
    ['Qwen', /qwen/i],
    ['Mistral', /mistral|mixtral|magistral|ministral/i],
    ['Meta', /llama|(^|\/)muse-/i],
    ['xAI', /grok/i],
    ['Moonshot', /kimi|moonshot/i],
    ['Zhipu', /glm/i],
    ['MiniMax', /minimax/i],
];
// The tier that reads well and costs little: a judge reads a passage and writes a short JSON answer.
const PREFER = /haiku|(^|[-/])(mini|flash|chat)\b|flash|-mini|v4-flash/i;
const NEVER = /abliterat|uncensor|nsfw|roleplay|\bauto\b|embed|vision-only|tts|whisper|image/i;
const blended = (p) => (p ? (Number(p.in) || 0) + (Number(p.out) || 0) : Infinity);

function makerOf(model) {
    const hay = [model.canonical, model.slug, model.name, model.family].filter(Boolean).join(' ');
    const hit = MAKERS.find(([, re]) => re.test(hay));
    return hit ? hit[0] : null;
}

/** The chat models a judge may be: [{ modelId, slug, name, maker, price }], cheapest first within a maker. */
function candidatesOf(catalog, { maxPrice = 8 } = {}) {
    const out = [];
    for (const model of (catalog && catalog.models) || []) {
        if (model.uncensored || (model.type && model.type !== 'chat')) continue;
        if (NEVER.test(`${model.slug || ''} ${model.name || ''} ${model.variant || ''}`)) continue;
        const maker = makerOf(model);
        if (!maker) continue;
        const offers = (model.offers || []).filter((o) => o && o.price && blended(o.price) <= maxPrice);
        if (!offers.length) continue;
        offers.sort((a, b) => blended(a.price) - blended(b.price));
        const offer = offers[0];
        out.push({ modelId: offer.id || model.slug, slug: model.slug, name: model.name || model.slug, maker, price: blended(offer.price), preferred: PREFER.test(model.slug || model.name || '') });
    }
    return out;
}

/** The panel: up to `size` judges, one per maker. */
function pickPanel(catalog, { size = 4, wanted = [], maxPrice = 8 } = {}) {
    if (wanted.length) {
        // Named by the operator: their choice, the price cap aside.
        const named = candidatesOf(catalog, { maxPrice: Infinity });
        const out = [];
        for (const w of wanted) {
            const hit = named.find((c) => c.modelId === w || c.slug === w || String(c.slug || '').endsWith(`/${w}`))
                // A routable model the catalogue does not list (OpenVibe.AI routes it by id): used as named.
                || { modelId: w, slug: w, name: w, maker: makerOf({ slug: w }) || 'Other', price: null, preferred: false };
            if (!out.some((o) => o.modelId === hit.modelId)) out.push(hit);
        }
        if (out.length) return out.slice(0, size);
    }
    const all = candidatesOf(catalog, { maxPrice });
    const out = [];
    for (const [maker] of MAKERS) {
        const mine = all.filter((c) => c.maker === maker).sort((a, b) => (b.preferred - a.preferred) || (a.price - b.price));
        if (mine.length) out.push(mine[0]);
        if (out.length >= size) break;
    }
    return out;
}

module.exports = { pickPanel, candidatesOf, makerOf, MAKERS };
