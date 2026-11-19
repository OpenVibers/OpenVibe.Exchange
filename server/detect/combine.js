'use strict';
/**
 * The panel's answer, honestly: a verdict in words, the range of the judges' estimates (never one number dressed up as
 * certainty), how far they agree, and the sentences more than one signal points at.
 *
 *   too_short     under MIN_WORDS: no detector can say anything useful
 *   disagree      the judges' estimates are SPREAD apart or more: can't tell
 *   likely_ai     the weighted estimate ≥ 0.75 and every judge ≥ 0.55
 *   likely_human  the weighted estimate ≤ 0.30 and every judge ≤ 0.50
 *   leans_ai      ≥ 0.55, not conclusive
 *   leans_human   ≤ 0.45, not conclusive
 *   unsure        in between
 *   style_only    no judge answered (signed out, or the panel was unavailable): writing-style signals only
 *
 * A judge's estimate counts by its confidence (low 0.5, medium 1, high 1.3); the style lean counts 0.15 from 150
 * words (0.05 below) and never alone. A sentence is marked when two independent signals point at it (two judges, or a
 * judge and a style marker); one signal shows as a lighter mark. A judge's quote counts only the way its estimate leans.
 */

const MIN_WORDS = 50;
const SPREAD = 0.5;
const WEIGHT = { low: 0.5, medium: 1, high: 1.3 };

const LABEL = {
    too_short: 'Too short to tell',
    disagree: 'Can’t tell: the judges disagree',
    likely_ai: 'Likely AI-written',
    likely_human: 'Likely written by a person',
    leans_ai: 'Leans AI, not conclusive',
    leans_human: 'Leans human, not conclusive',
    unsure: 'Can’t tell',
    style_only: 'Writing-style signals only',
};

const CAVEATS = [
    'No detector can prove who wrote a text. Do not use this, or any detector, as the only reason to accuse someone.',
    'Formal, short, edited, translated and non-native writing is flagged far more often than it should be, by every detector.',
    'A text that was drafted with AI and rewritten by a person (or the other way round) is often both.',
];

const round = (n) => Math.round(n * 100) / 100;

function combine({ words, sentences, style, votes = [], panelSize = 0, notes = [] }) {
    const valid = votes.filter((v) => v && v.ok);
    const ps = valid.map((v) => v.p);
    let wsum = 0, psum = 0;
    for (const v of valid) { const w = WEIGHT[v.confidence] || 0.5; wsum += w; psum += w * v.p; }
    let estimate = null;
    if (valid.length) {
        if (style && style.score != null) { const w = words >= 150 ? 0.15 : 0.05; wsum += w; psum += w * style.score; }
        estimate = round(psum / wsum);
    }
    const lo = ps.length ? Math.min(...ps) : null, hi = ps.length ? Math.max(...ps) : null;
    const spread = ps.length ? round(hi - lo) : null;

    let verdict;
    if (words < MIN_WORDS) verdict = 'too_short';
    else if (!valid.length) verdict = 'style_only';
    else if (valid.length >= 2 && spread >= SPREAD) verdict = 'disagree';
    else if (valid.length >= 2 && estimate >= 0.75 && lo >= 0.55) verdict = 'likely_ai';
    else if (valid.length >= 2 && estimate <= 0.3 && hi <= 0.5) verdict = 'likely_human';
    else if (estimate >= 0.55) verdict = 'leans_ai';
    else if (estimate <= 0.45) verdict = 'leans_human';
    else verdict = 'unsure';

    // Each sentence: who points at it, and which way.
    const marks = new Map();
    const add = (i, src) => { if (i == null) return; if (!marks.has(i)) marks.set(i, []); marks.get(i).push(src); };
    // A judge's quote counts only the way its own estimate leans: a judge at 0.5 that quotes "AI-like" phrasing marks
    // nothing (on a plain human committee note, four unsure judges had marked two sentences AI).
    valid.forEach((v, k) => v.evidence.forEach((e) => {
        if (e.points_to === 'ai' ? v.p < 0.55 : v.p > 0.45) return;
        add(e.sentence, { by: `judge:${k}`, points_to: e.points_to, why: e.why });
    }));
    for (const m of (style && style.markers) || []) add(m.sentence, { by: 'style', points_to: 'ai', why: `“${m.phrase}”, a phrase models overuse` });
    const marked = (sentences || []).map((s) => {
        const srcs = marks.get(s.i) || [];
        const aiBy = new Set(srcs.filter((x) => x.points_to === 'ai').map((x) => x.by));
        const humanBy = new Set(srcs.filter((x) => x.points_to === 'human').map((x) => x.by));
        const level = aiBy.size >= 2 ? 'ai' : aiBy.size === 1 ? 'ai_weak' : humanBy.size ? 'human' : null;
        return { i: s.i, start: s.start, end: s.end, level, reasons: srcs.map((x) => x.why).filter(Boolean).slice(0, 4) };
    });

    const agreement = ps.length < 2 ? null : spread < 0.2 ? 'strong' : spread < 0.35 ? 'some' : spread < SPREAD ? 'weak' : 'none';
    return {
        verdict, label: LABEL[verdict],
        estimate, range: ps.length ? [lo, hi] : null, agreement,
        judges_answered: valid.length, judges_asked: panelSize,
        words, sentences: marked,
        caveats: [...(words < 150 && words >= MIN_WORDS ? ['Under 150 words: every signal here is weaker than on a longer passage.'] : []), ...CAVEATS],
        notes,
    };
}

module.exports = { combine, LABEL, CAVEATS, MIN_WORDS, SPREAD };
