'use strict';

/**
 * Model family marks and product marks.
 *
 * A family's mark is a monochrome glyph on a tint from the theme tokens (never a new colour), with the family
 * name as its accessible label. An unknown family gets the neutral spark, so a row never shows a stranger's
 * initials in a circle (the design review, 2026-11-06).
 */
const appIcons = require('openvibe-shared/app-icons');
const { esc } = require('../render/html');

const FAMILIES = {
    DeepSeek: { hue: 'accent', path: 'M4 9c3-4 6-4 8 0s5 4 8 0M4 15c3-4 6-4 8 0s5 4 8 0' },
    Qwen: { hue: 'ok', path: 'M12 3a9 9 0 1 0 5.2 16.3M17 13l3 8' },
    Kimi: { hue: 'live', path: 'M15 3a9 9 0 1 0 6 15 8 8 0 0 1-6-15' },
    GLM: { hue: 'warn', path: 'M12 2l8 5v10l-8 5-8-5V7zM12 7l4 2.5v5L12 17l-4-2.5v-5z' },
    MiniMax: { hue: 'bad', path: 'M4 7l6 5-6 5M14 7l6 5-6 5' },
    Llama: { hue: 'accent', path: 'M6 20v-7a6 6 0 0 1 12 0v7M9 20v-4M15 20v-4M8 8L6 3M16 8l2-5' },
    Mistral: { hue: 'warn', path: 'M3 8h12a3 3 0 1 0-3-3M3 13h15a3 3 0 1 1-3 3M3 18h9' },
    Gemma: { hue: 'ok', path: 'M12 2l7 10-7 10-7-10z' },
    OpenAI: { hue: 'ok', path: 'M12 3a9 9 0 1 1-6.3 15.4M12 21a9 9 0 1 1 6.3-15.4M12 7v10M7.5 9.5l9 5M7.5 14.5l9-5' },
    Anthropic: { hue: 'warn', path: 'M12 3v18M4 7l16 10M20 7L4 17' },
    Google: { hue: 'accent', path: 'M20 12h-8M20 12a8 8 0 1 1-3-6.2' },
    Meta: { hue: 'accent', path: 'M4 12a4 4 0 0 1 8 0 4 4 0 0 0 8 0 4 4 0 0 0-8 0 4 4 0 0 1-8 0' },
    Microsoft: { hue: 'accent', path: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z' },
    Other: { hue: 'muted', path: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z' },
};

/** A family name that the table has, else Other; the key is also the class's suffix. */
function familyKey(family) {
    const name = String(family || '').trim();
    if (FAMILIES[name]) return name;
    const lower = name.toLowerCase();
    for (const key of Object.keys(FAMILIES)) if (key.toLowerCase() === lower) return key;
    if (/deepseek/i.test(name)) return 'DeepSeek';
    if (/qwen|qwq/i.test(name)) return 'Qwen';
    if (/kimi|moonshot/i.test(name)) return 'Kimi';
    if (/glm|zhipu|z\.ai/i.test(name)) return 'GLM';
    if (/minimax/i.test(name)) return 'MiniMax';
    if (/llama|meta/i.test(name)) return 'Llama';
    if (/mistral|mixtral/i.test(name)) return 'Mistral';
    if (/gemma/i.test(name)) return 'Gemma';
    if (/gpt|openai|o1|o3/i.test(name)) return 'OpenAI';
    if (/claude|anthropic/i.test(name)) return 'Anthropic';
    if (/gemini|google/i.test(name)) return 'Google';
    if (/microsoft|phi/i.test(name)) return 'Microsoft';
    return 'Other';
}

/**
 * mark(family, { size, label }) — the family's glyph; the name is the aria-label, never a letter in a circle.
 * label: false leaves it decorative (a row already names the family).
 */
function mark(family, { size = 28, label = true, cls = '' } = {}) {
    const key = familyKey(family);
    const def = FAMILIES[key];
    const px = Math.max(16, Math.min(64, Number(size) || 28));
    const name = String(family || key);
    return `<span class="ex-mk ex-mk--${key.toLowerCase()}${cls ? ` ${esc(cls)}` : ''}" style="--ex-mk-size:${px}px"`
        + `${label ? ` role="img" aria-label="${esc(name)}"` : ' aria-hidden="true"'}>`
        + `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${def.path}"/></svg></span>`;
}

/** An OpenVibe product's own mark and full name (OpenVibe.Live, never "live"). */
function product(service) {
    const id = String(service || '').toLowerCase();
    const site = appIcons.site(id);
    const name = (site && site.name) || (id ? `OpenVibe.${id.replace(/(^|[^a-z])([a-z])/g, (m, a, b) => a + b.toUpperCase())}` : 'OpenVibe');
    const src = appIcons.url(id, 192);
    return { id, name, src };
}

function productMark(service, { size = 22 } = {}) {
    const p = product(service);
    const px = Number(size) || 22;
    if (!p.src) return mark('Other', { size: px, label: false, cls: 'ex-mk--product' });
    return `<img class="ex-mk ex-mk--product" src="${esc(p.src)}" width="${px}" height="${px}" alt="" loading="lazy" decoding="async">`;
}

module.exports = { mark, familyKey, product, productMark, FAMILIES };
