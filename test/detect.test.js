'use strict';
/**
 * "Was this written by an AI?" (server/detect, POST /api/v1/detect). What this proves:
 *   - the style signals lean the right way on a stock model paragraph and on a person's rant, and stay silent when short;
 *   - the panel takes one model per maker and never an uncensored variant, or the operator's named models;
 *   - a judge's quote that is not in the passage is dropped, and its probability is clamped;
 *   - the verdict says "can't tell" when the judges disagree or the text is short, and gives a range, not one number;
 *   - signed out the API runs the style signals only; signed in, the judges run on the person's own allowance.
 */
const assert = require('assert');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');
const { styleOf } = require('../server/detect/style');
const { pickPanel } = require('../server/detect/panel');
const { readVerdict } = require('../server/detect/judge');
const { combine } = require('../server/detect/combine');

const MODEL_PROSE = 'In today\'s fast-paced digital landscape, it is important to note that artificial intelligence plays a crucial role in shaping our future. Moreover, it serves as a testament to human ingenuity. Furthermore, organizations must navigate the complexities of this ever-evolving technology. Additionally, fostering a culture of innovation is pivotal. In conclusion, embracing AI seamlessly unlocks a myriad of opportunities for growth and success in the modern world.';
const PERSON = 'So unreliable. It only misses sentences under 10 words or full of grammar mistakes. Used to seem realistic, now it flags everything I type as 100% AI. So frustrating. I tried it on an essay I wrote by hand in 2019, before any of this existed, and it said 87%. My teacher uses it. I\'m not kidding, I had to show my notebook drafts to prove I wrote it. Don\'t trust these things.';

(async () => {
    await check('style: a stock model paragraph leans AI, a person\'s rant leans human, a line says nothing', async () => {
        const a = styleOf(MODEL_PROSE), h = styleOf(PERSON), short = styleOf('Too short to say.');
        assert.ok(a.score > 0.6, `model prose ${a.score}`);
        assert.ok(h.score < 0.3, `a person ${h.score}`);
        assert.strictEqual(short.score, null);
        assert.ok(a.markers.some((m) => m.phrase.includes('testament')));
        assert.strictEqual(styleOf('Today\'s weather is fine and the city\'s parks are open.').features.contractions_per_1k_words, 0, 'a possessive is not a contraction');
    });

    await check('the panel: one model per maker, never an uncensored one, or the named ones', async () => {
        const catalog = { models: [
            { slug: 'anthropic/claude-sonnet', name: 'Claude Sonnet', type: 'chat', offers: [{ id: 'shared/claude-sonnet', price: { in: 3, out: 15 } }] },
            { slug: 'anthropic/claude-haiku', name: 'Claude Haiku', type: 'chat', offers: [{ id: 'shared/claude-haiku', price: { in: 0.8, out: 4 } }] },
            { slug: 'openai/gpt-5-mini', name: 'GPT-5 mini', type: 'chat', offers: [{ id: 'shared/gpt-5-mini', price: { in: 0.25, out: 2 } }] },
            { slug: 'deepseek/deepseek-flash', name: 'DeepSeek Flash', type: 'chat', offers: [{ id: 'deepseek/deepseek-flash', price: { in: 0.3, out: 1.2 } }] },
            { slug: 'meta-llama/llama-3-8b-abliterated', name: 'Llama abliterated', type: 'chat', uncensored: true, offers: [{ id: 'x', price: { in: 0.1, out: 0.1 } }] },
            { slug: 'qwen/qwen3-embed', name: 'Qwen embed', type: 'embedding', offers: [{ id: 'y', price: { in: 0.01, out: 0 } }] },
        ] };
        const panel = pickPanel(catalog, { size: 4 });
        assert.deepStrictEqual(panel.map((p) => p.maker), ['Anthropic', 'OpenAI', 'DeepSeek']);
        assert.strictEqual(panel[0].modelId, 'shared/claude-haiku', 'the capable-but-cheap tier of a maker');
        assert.ok(!panel.some((p) => /abliterated|embed/.test(p.slug)));
        assert.deepStrictEqual(pickPanel(catalog, { wanted: ['deepseek-flash', 'shared/claude-sonnet'] }).map((p) => p.modelId), ['deepseek/deepseek-flash', 'shared/claude-sonnet']);
        // A routable model the catalogue does not list is used as named; Meta's Muse models count as Meta.
        const named = pickPanel(catalog, { wanted: ['shared/claude-opus', 'meta/muse-spark-1.3'] });
        assert.deepStrictEqual(named.map((p) => [p.modelId, p.maker]), [['shared/claude-opus', 'Anthropic'], ['meta/muse-spark-1.3', 'Meta']]);
    });

    await check('a judge\'s answer: quotes that are not in the passage are dropped, the probability is clamped', async () => {
        const sentences = styleOf(MODEL_PROSE).sentences;
        const v = readVerdict('```json\n{"ai_probability": 1.4, "confidence": "HIGH", "summary": "Stock phrasing throughout.", "evidence": [{"quote": "serves as a testament to human ingenuity", "points_to": "ai", "why": "cliché"}, {"quote": "words nobody wrote here at all", "points_to": "ai", "why": "invented"}]}\n```', MODEL_PROSE, sentences);
        assert.strictEqual(v.ok, true);
        assert.strictEqual(v.p, 1);
        assert.strictEqual(v.confidence, 'high');
        assert.deepStrictEqual(v.evidence.map((e) => e.quote), ['serves as a testament to human ingenuity'], 'the invented quote is gone');
        assert.strictEqual(v.evidence[0].sentence, 1);
        assert.strictEqual(readVerdict('I think it is AI.', MODEL_PROSE, sentences).ok, false);
    });

    await check('the verdict: a range, and "can\'t tell" when the judges disagree or the text is short', async () => {
        const s = styleOf(MODEL_PROSE);
        const vote = (p, confidence = 'medium') => ({ ok: true, p, confidence, evidence: [] });
        const agree = combine({ words: 120, sentences: s.sentences, style: s, votes: [vote(0.9), vote(0.85), vote(0.8)] });
        assert.strictEqual(agree.verdict, 'likely_ai');
        assert.deepStrictEqual(agree.range, [0.8, 0.9]);
        assert.strictEqual(agree.agreement, 'strong');
        assert.strictEqual(combine({ words: 120, sentences: [], style: s, votes: [vote(0.95), vote(0.2)] }).verdict, 'disagree');
        assert.strictEqual(combine({ words: 20, sentences: [], style: s, votes: [vote(0.99), vote(0.99)] }).verdict, 'too_short');
        assert.strictEqual(combine({ words: 120, sentences: [], style: s, votes: [vote(0.1), vote(0.2)] }).verdict, 'likely_human');
        assert.ok(agree.caveats.some((c) => /prove who wrote/.test(c)), 'it never claims proof');
        // Unsure judges mark nothing, whatever they quote (a plain human note, 2026-11-19).
        const quoted = (p) => ({ ok: true, p, confidence: 'low', evidence: [{ quote: 'x', points_to: 'ai', why: 'formal', sentence: 0 }] });
        const unsure = combine({ words: 120, sentences: s.sentences, style: { ...s, markers: [] }, votes: [quoted(0.5), quoted(0.5), quoted(0.5)] });
        assert.strictEqual(unsure.verdict, 'unsure');
        assert.ok(!unsure.sentences.some((x) => x.level === 'ai' || x.level === 'ai_weak'), 'no sentence marked by unsure judges');
    });

    const asked = [];
    const ai = createFakeAi({
        chat: (args) => {
            asked.push(args);
            const p = args.model.startsWith('deepseek') ? 0.86 : 0.78;
            return { content: JSON.stringify({ ai_probability: p, confidence: 'medium', summary: 'Generic, evenly paced prose.', evidence: [{ quote: 'navigate the complexities of this ever-evolving technology', points_to: 'ai', why: 'stock phrase' }] }),
                model: args.model, provider: 'fake', run_id: `run_${args.model}`, cost_usd: 0.0004, tokens_in: 300, tokens_out: 80, latency_ms: 400 };
        },
    });
    const t = await boot({ ai });
    const alice = t.network.addUser('detect-alice');
    try {
        await check('signed out: the style signals only, and the API says the judges need a sign-in', async () => {
            const r = await t.get('/api/v1/detect', { json: { text: MODEL_PROSE } });
            assert.strictEqual(r.status, 200, r.text);
            const d = r.json();
            assert.strictEqual(d.verdict, 'style_only');
            assert.deepStrictEqual(d.judges, []);
            assert.ok(d.style.estimate > 0.6);
            assert.ok(d.notes.some((n) => /Sign in/.test(n)));
            assert.strictEqual(asked.length, 0, 'no model was asked');
            assert.strictEqual(r.headers.get('cache-control'), 'no-store');
        });
        await check('signed in: the judges read it on the person\'s own allowance, side by side', async () => {
            const r = await t.get('/api/v1/detect', { as: alice, json: { text: MODEL_PROSE } });
            assert.strictEqual(r.status, 200, r.text);
            const d = r.json();
            assert.ok(d.judges.length >= 2, `judges: ${JSON.stringify(d.judges.map((j) => j.model))}`);
            assert.ok(d.judges.every((j) => j.ok && j.estimate > 0.5));
            assert.ok(!d.judges.some((j) => /abliterated/.test(j.model)), 'never an uncensored judge');
            assert.ok(asked.every((a) => a.subject === alice.subject), 'billed to the person');
            assert.ok(asked.every((a) => a.temperature === 0));
            assert.ok(['likely_ai', 'leans_ai'].includes(d.verdict), d.verdict);
            assert.strictEqual(d.range.length, 2);
            const flagged = d.sentences.find((s) => s.level === 'ai');
            assert.ok(flagged, 'a sentence two judges quoted is marked');
            assert.strictEqual(MODEL_PROSE.slice(flagged.start, flagged.end).includes('navigate the complexities'), true);
        });
        await check('a passage too short or too long is refused with a reason', async () => {
            assert.strictEqual((await t.get('/api/v1/detect', { json: { text: 'Hi.' } })).status, 422);
            assert.strictEqual((await t.get('/api/v1/detect', { json: { text: 'word '.repeat(4000) } })).status, 422);
        });
    } finally { await t.close(); }
    done('detect');
})();
