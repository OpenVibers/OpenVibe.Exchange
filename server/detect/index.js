'use strict';
/**
 * "Was this written by an AI?" (the owner, 2026-11-19: "the best possible multi model multi harness AI detection type
 * feature", beside a screenshot of a detector that called a person's complaint about it "100% AI GPT").
 *
 * Two kinds of reading, side by side, never one number:
 *   - writing style (style.js): deterministic measurements anyone can recompute, weak on purpose;
 *   - a panel of judges (panel.js, judge.js): models from different makers read the passage independently on the
 *     person's own AI allowance and answer with a calibrated estimate and quoted evidence.
 * combine.js turns them into a verdict in words, the range of estimates and the sentences two signals agree on, with
 * "can't tell" whenever the judges disagree or the passage is short.
 *
 * Not yet: detectors that read a model's own token probabilities (Binoculars, Fast-DetectGPT). OpenVibe.AI does not
 * return per-token probabilities today; the method page says so rather than imitating them.
 *
 * Nothing is stored: the passage goes to the judges through OpenVibe.AI like any request and comes back in the answer.
 */
const { styleOf } = require('./style');
const { pickPanel } = require('./panel');
const { messagesFor, readVerdict } = require('./judge');
const { combine, MIN_WORDS } = require('./combine');

const METHOD = 'detect@1';

function createDetector({ ai, config = {}, log = console }) {
    const opts = config.detect || {};
    const perDay = Math.max(1, Number(opts.perDay) || 30);
    const used = new Map();   // subject → { day, n }: the panel's own daily cap (the AI allowance limits it too)

    function take(subject) {
        const day = new Date().toISOString().slice(0, 10);
        const u = used.get(subject);
        const n = u && u.day === day ? u.n : 0;
        if (n >= perDay) return false;
        used.set(subject, { day, n: n + 1 });
        if (used.size > 50_000) used.clear();
        return true;
    }

    /**
     * → the result document: { method, verdict, label, estimate, range, agreement, judges, style, sentences, words,
     *   caveats, notes }. Signed out (no subject), the style reading only.
     */
    async function detect({ text, subject = null, clientIp = null, signal = null }) {
        const passage = String(text || '').replace(/\r\n?/g, '\n').trim().slice(0, opts.maxChars || 12000);
        const style = styleOf(passage);
        const notes = [];
        let panel = [];
        let votes = [];
        if (!subject) notes.push('Sign in to have the panel of AI judges read it as well; signed out, only the writing-style signals run.');
        else if (style.words < MIN_WORDS) notes.push(`The panel reads passages of ${MIN_WORDS} words or more.`);
        else if (!take(subject)) notes.push(`That is today's ${perDay} panel checks. They come back at midnight UTC.`);
        else {
            let catalog = null;
            try { catalog = await ai.catalog(); } catch { catalog = null; }
            panel = catalog && !catalog.unavailable ? pickPanel(catalog, { size: opts.panelSize || 4, wanted: opts.panel || [], maxPrice: opts.maxPrice || 8 }) : [];
            if (!panel.length) notes.push('No judge model is reachable right now, so only the writing-style signals ran.');
            votes = await Promise.all(panel.map(async (j) => {
                const started = Date.now();
                try {
                    const out = await ai.chat({
                        model: j.modelId, messages: messagesFor(passage), temperature: 0, maxTokens: 700,
                        subject, clientIp, signal, max_cost_usd: opts.maxCostPerJudge || 0.03,
                    });
                    const v = readVerdict(out.content, passage, style.sentences);
                    return { ...v, judge: j, model: out.model || j.slug, provider: out.provider || null, cost_usd: Number(out.cost_usd) || 0, ms: Date.now() - started };
                } catch (err) {
                    if (err && err.status === 429) return { ok: false, judge: j, error: 'your free AI allowance for today is spent', spent: true };
                    log.warn(`[Detect] ${j.slug} did not answer: ${String(err && err.message).slice(0, 160)}`);
                    return { ok: false, judge: j, error: 'did not answer' };
                }
            }));
            if (votes.some((v) => v.spent)) notes.push('Your free AI allowance for today is spent, so some judges did not read it.');
        }
        const result = combine({ words: style.words, sentences: style.sentences, style, votes, panelSize: panel.length, notes });
        return {
            method: METHOD,
            ...result,
            judges: votes.map((v) => ({
                model: v.judge.slug, name: v.judge.name, maker: v.judge.maker,
                ok: !!v.ok, ...(v.ok ? { estimate: v.p, confidence: v.confidence, summary: v.summary, evidence: v.evidence } : { error: v.error }),
                cost_usd: v.cost_usd || 0, ms: v.ms || null,
            })),
            style: { estimate: style.score, features: style.features, notes: style.notes, markers: style.markers.length },
            cost_usd: Math.round(votes.reduce((a, v) => a + (v.cost_usd || 0), 0) * 1e6) / 1e6,
        };
    }

    return { detect, METHOD };
}

module.exports = { createDetector, METHOD };
