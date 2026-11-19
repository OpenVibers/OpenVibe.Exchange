'use strict';
/**
 * Writing-style signals for "was this written by an AI?" (server/detect): deterministic, no model, the same answer for
 * the same text. What it measures:
 *
 *   burstiness       how much sentence lengths vary (coefficient of variation): people writing freely vary more
 *   markers          phrases language models overuse ("delve", "a testament to", "it's important to note", …) per 1,000 words
 *   openers          the share of sentences that open with a stock transition ("Moreover,", "Furthermore,", …)
 *   contractions     per 1,000 words ("don't", "it's"): models write fewer in plain prose
 *   lexical variety  moving-average type/token ratio over 50 words (shown, not scored: it cuts both ways)
 *
 * Weak evidence by design. A careful writer, a non-native writer, a formal genre and an edited text all look "AI-like"
 * here, so the combiner (combine.js) gives it little weight and never lets it decide alone; the page says so.
 */

const MARKERS = [
    'delve', 'delves', 'delving', 'tapestry', 'testament to', 'a testament', 'it\'s important to note', 'it is important to note',
    'it\'s worth noting', 'it is worth noting', 'in today\'s fast-paced', 'in today\'s digital', 'ever-evolving', 'ever-changing',
    'navigate the complexities', 'navigating the', 'the realm of', 'in the realm', 'underscores', 'underscore the', 'multifaceted',
    'seamless', 'seamlessly', 'leverage', 'leveraging', 'robust', 'pivotal', 'crucial role', 'plays a crucial', 'plays a vital',
    'foster', 'fostering', 'embark', 'elevate', 'nuanced', 'intricate', 'intricacies', 'meticulous', 'meticulously', 'showcasing',
    'in conclusion', 'in summary', 'overall,', 'ultimately,', 'holistic', 'paradigm', 'synergy', 'unlock the', 'unlocking',
    'game-changer', 'cutting-edge', 'a myriad of', 'myriad', 'plethora', 'resonate', 'resonates', 'vibrant', 'bustling',
    'not only', 'rich tapestry', 'stands as', 'serves as a', 'commendable', 'invaluable', 'beacon',
];
const MARKER_RE = new RegExp(`(^|[^\\p{L}])(${MARKERS.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, '[\'’]')).join('|')})(?=$|[^\\p{L}])`, 'giu');
const OPENERS = /^(moreover|furthermore|additionally|however|overall|ultimately|in conclusion|in summary|importantly|consequently|thus|therefore|notably|indeed)\b/i;
// "n't", "'re", "'ve", "'ll", "'d", "'m", and "'s" only after the words where it is "is" or "us" (a possessive is not one).
const CONTRACTION = /\b(?:[\p{L}]+n['’]t|[\p{L}]+['’](?:re|ve|ll|d|m)|(?:it|that|there|here|what|who|he|she|let|where|how)['’]s)\b/giu;
const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** Sentences with their place in the text, so a page can mark them: [{ i, text, start, end, words }]. */
function sentencesOf(text) {
    const out = [];
    const src = String(text || '');
    // A sentence ends at . ! ? … (with closing quotes or brackets) before whitespace, or at a blank line.
    const re = /[^.!?…\n]+(?:[.!?…]+["'”’)\]]*|(?=\n)|$)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        if (!m[0]) { re.lastIndex += 1; continue; }
        const raw = m[0];
        const lead = raw.length - raw.trimStart().length;
        const t = raw.trim();
        if (t) {
            const words = (t.match(WORD) || []).length;
            if (words) out.push({ i: out.length, text: t, start: m.index + lead, end: m.index + lead + t.length, words });
        }
        if (re.lastIndex === m.index) re.lastIndex += 1;
    }
    return out;
}

/** Moving-average type/token ratio (window 50), or the plain ratio for a short text. */
function mattr(words, window = 50) {
    const w = words.map((x) => x.toLowerCase());
    if (w.length === 0) return 0;
    if (w.length <= window) return new Set(w).size / w.length;
    let sum = 0, n = 0;
    for (let i = 0; i + window <= w.length; i += 5) { sum += new Set(w.slice(i, i + window)).size / window; n += 1; }
    return sum / n;
}

/**
 * The style of a text → { words, sentences, features, markers, score, notes }. `score` is a weak 0..1 lean towards
 * "AI-like style"; null when the text is too short to say anything (under 40 words or three sentences).
 */
function styleOf(text) {
    const src = String(text || '');
    const sentences = sentencesOf(src);
    const words = src.match(WORD) || [];
    const n = words.length;
    const lens = sentences.map((s) => s.words);
    const mean = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
    const sd = lens.length > 1 ? Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / (lens.length - 1)) : 0;
    const cv = mean ? sd / mean : 0;
    const markers = [];
    for (const s of sentences) {
        MARKER_RE.lastIndex = 0;
        let m;
        while ((m = MARKER_RE.exec(s.text)) !== null) markers.push({ sentence: s.i, phrase: m[2].toLowerCase() });
    }
    const contractions = (src.match(CONTRACTION) || []).length;
    const openers = sentences.filter((s) => OPENERS.test(s.text)).length;
    const per1k = (k) => (n ? (k * 1000) / n : 0);
    const features = {
        sentence_length_mean: round(mean, 1),
        sentence_length_variation: round(cv),
        markers_per_1k_words: round(per1k(markers.length), 1),
        transition_openers_share: round(sentences.length ? openers / sentences.length : 0),
        contractions_per_1k_words: round(per1k(contractions), 1),
        lexical_variety: round(mattr(words)),
    };
    const notes = [];
    let score = null;
    if (n >= 40 && sentences.length >= 3) {
        // Hand-set weights, documented on the method page: each term is capped, so no single habit can carry the lean.
        const z = -0.6
            + 1.4 * clamp((0.45 - cv) / 0.25, -1, 1)
            + 1.2 * clamp(features.markers_per_1k_words / 6, 0, 1.5)
            + 0.6 * clamp(features.transition_openers_share / 0.2, 0, 1.5)
            - 0.8 * clamp(features.contractions_per_1k_words / 15, 0, 1.5);
        score = round(1 / (1 + Math.exp(-z)));
        if (cv < 0.35) notes.push(`Sentence lengths vary little (variation ${features.sentence_length_variation}); people writing freely usually vary more.`);
        else if (cv > 0.6) notes.push(`Sentence lengths vary a lot (variation ${features.sentence_length_variation}), as free human writing often does.`);
        if (markers.length) {
            const top = [...new Set(markers.map((m) => m.phrase))].slice(0, 6).map((p) => `“${p}”`).join(', ');
            notes.push(`${markers.length} phrase${markers.length === 1 ? '' : 's'} language models overuse: ${top}.`);
        }
        if (features.transition_openers_share >= 0.2) notes.push(`${Math.round(features.transition_openers_share * 100)}% of sentences open with a stock transition (“Moreover,”, “Furthermore,”).`);
        if (features.contractions_per_1k_words >= 10) notes.push(`Plenty of contractions (${features.contractions_per_1k_words} per 1,000 words), which leans human.`);
        else if (n >= 150 && features.contractions_per_1k_words === 0) notes.push('No contractions at all, common in model prose and in formal human writing alike.');
    } else {
        notes.push('Too short for style signals to mean anything.');
    }
    return { words: n, sentences, features, markers, score, notes };
}

module.exports = { styleOf, sentencesOf, MARKERS };
