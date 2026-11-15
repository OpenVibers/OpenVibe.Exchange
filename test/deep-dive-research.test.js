'use strict';
// The general deep dive on Exchange (AI research.deep_dive, ai.research@1; the owner, 11-15: Exchange's search "was
// meant to deep dive any query in a general sense"):
//   - a search shows "Deep dive this" with the depths and their prices; signed out, starting one signs in and comes
//     back with the question kept;
//   - /deep-dive?q= fills the form; starting one asks AI for the general kind, no sites;
//   - a running one: the live view's seed (its six step names, the plan's questions, the pages read) and Cancel;
//   - the answer: first, then key points and answers per question whose sources are numbered chips that point at
//     the pages read, a comparison, where the sources disagree, what is open, every page read with its notes and
//     quotes, the ones that could not be read, the receipt; everything from AI escaped and only http(s) linked;
//   - the Markdown export with numbered sources.
const assert = require('assert');
const { boot } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');

const ID = 'run_TEST';
const USER = { subject: 'usr_01JAB2C3D4E5F6G7H8J9K0MNPQ', username: 'probe' };
const Q = 'Are heat pumps worth it in a cold climate?';

const READS = [
    { id: 'read_1', source_id: 'src_1', url: 'https://example.org/heat-pumps', final_url: 'https://example.org/heat-pumps', title: 'Heat pumps explained', site: 'Example', published: '2026-03-01', read_at: '2026-11-15T22:00:10.000Z', words: 1840, status: 'read', reason: null, relevant: true, summary: 'How a heat pump moves heat, and its efficiency in the cold.', kind: 'reference', findings: [{ point: 'Efficiency drops below -15 C but stays above 1.', quote: 'a COP of 1.8 at -20 C' }] },
    { id: 'read_2', source_id: 'src_2', url: 'https://example.com/costs', final_url: 'https://example.com/costs', title: 'What it costs <script>alert(1)</script>', site: 'Example News', published: null, read_at: '2026-11-15T22:00:12.000Z', words: 920, status: 'read', reason: null, relevant: true, summary: 'Prices and grants in 2026.', kind: 'news', findings: [] },
    { id: 'read_3', source_id: 'src_3', url: 'https://blocked.example/page', final_url: null, title: 'Blocked', site: 'blocked.example', published: null, read_at: '2026-11-15T22:00:13.000Z', words: 0, status: 'skipped', reason: 'robots.txt disallows this page', relevant: null, summary: null, kind: null, findings: [] },
];
const REPORT = {
    id: ID, schema: 'ai.research@1', run_id: ID, status: 'succeeded',
    input: { question: Q, depth: 'quick', max_pages: 8 },
    steps: ['plan', 'search', 'choose', 'read', 'analyse', 'write'].map((key) => ({ key, status: 'done', detail: 'done' })),
    questions: [{ key: 'efficiency', question: 'How efficient are they in the cold?' }, { key: 'cost', question: 'What do they cost?' }],
    sources: [
        { id: 'src_1', kind: 'web', title: 'Heat pumps explained', url: 'https://example.org/heat-pumps', publisher: 'example.org', engine: 'wikipedia', snippet: null, license: null, read_at: '2026-11-15T22:00:00.000Z' },
        { id: 'src_2', kind: 'web', title: 'What it costs', url: 'https://example.com/costs', publisher: 'example.com', engine: 'openvibe', snippet: null, license: null, read_at: '2026-11-15T22:00:00.000Z' },
        { id: 'src_3', kind: 'web', title: 'Blocked', url: 'https://blocked.example/page', publisher: 'blocked.example', engine: 'openvibe', snippet: null, license: null, read_at: '2026-11-15T22:00:00.000Z' },
        { id: 'src_4', kind: 'web', title: 'Also found', url: 'javascript:alert(1)', publisher: null, engine: 'openvibe', snippet: null, license: null, read_at: '2026-11-15T22:00:00.000Z' },
    ],
    reads: READS,
    answer: {
        summary: 'Yes, in most cold climates: modern heat pumps keep working well below freezing.',
        key_points: [{ text: 'They keep a COP above 1 at -20 C.', sources: ['src_1'] }, { text: 'Grants cut the price.', sources: ['src_2', 'src_1'] }],
        answers: [{ question: 'How efficient are they in the cold?', answer: 'Less efficient, still better than resistance heat.', confidence: 'high', sources: ['src_1'] }],
        comparison: { columns: ['Option', 'Cost'], rows: [['Heat pump', '$$'], ['Gas', '$']] },
        disagreements: [{ what: 'How much grants cover.', sources: ['src_2'] }],
        open_questions: ['Long-term reliability at -30 C.'], next_steps: ['Get two quotes.'],
    },
    receipt: { price_usd: 0.1, held_usd: 0.1, cost_usd: 0.0123, pages_read: 2, synthetic: false, models: [{ step: 'plan', provider: 'deepseek', model: 'deepseek-v4-flash', tokens_in: 900, tokens_out: 300, cost_usd: 0.001, ms: 900 }] },
    gaps: ['blocked.example: robots.txt disallows this page'],
    created_at: '2026-11-15T22:00:00.000Z', updated_at: '2026-11-15T22:01:10.000Z', finished_at: '2026-11-15T22:01:10.000Z',
};

(async () => {
    const ai = createFakeAi();
    const t = await boot({ ai });
    try {
        // A search: "Deep dive this" with the question and the depths' prices.
        let r = await t.get(`/search?q=${encodeURIComponent(Q)}`);
        assert.strictEqual(r.status, 200);
        assert.match(r.text, /Deep dive this/);
        assert.match(r.text, /<form method="post" action="\/deep-dive" class="xs-dive-form"><input type="hidden" name="question" value="Are heat pumps worth it in a cold climate\?">/);
        assert.match(r.text, /\$0\.10/);
        assert.match(r.text, /href="\/deep-dive\?q=Are%20heat%20pumps/, 'the head\'s Deep dive carries the question');
        r = await t.get('/search');
        assert.ok(!/Deep dive this/.test(r.text), 'no question, no card');

        // Signed out: starting signs in and comes back to the form with the question.
        r = await t.get('/deep-dive', { form: { question: Q, depth: 'quick' } });
        assert.strictEqual(r.status, 303);
        assert.strictEqual(r.headers.get('location'), `/auth/login?next=${encodeURIComponent(`/deep-dive?q=${encodeURIComponent(Q)}`)}`);
        r = await t.get(`/deep-dive?q=${encodeURIComponent(Q)}`, { as: USER });
        assert.match(r.text, /<textarea name="question"[^>]*>Are heat pumps worth it in a cold climate\?<\/textarea>/, 'the form keeps the question');

        // Start: the general kind, no sites.
        r = await t.get('/deep-dive', { as: USER, form: { question: Q, depth: 'thorough' } });
        assert.strictEqual(r.status, 303);
        assert.strictEqual(r.headers.get('location'), `/deep-dive/${ID}`);
        const call = ai.deepDiveCalls[ai.deepDiveCalls.length - 1].create;
        assert.deepStrictEqual([call.kind, call.depth, call.sites], ['research', 'thorough', []]);
        const row = ai.deepDives.get(ID);

        // Running: the live view's seed, its script and Cancel.
        row.status = 'running'; row.step = 'read'; row.progress = 0.4;
        row.steps = [{ key: 'plan', status: 'done', detail: '2 questions, 3 searches' }, { key: 'search', status: 'done', detail: '24 sources from 3 engines' }, { key: 'choose', status: 'done', detail: '8 pages' }, { key: 'read', status: 'running', detail: '2/8 pages' }];
        row.plan = { questions: REPORT.questions, searches: [{ q: 'heat pump cold climate COP', kind: 'web' }] };
        row.candidates = [{ url: READS[0].url, title: READS[0].title, reason: 'the basics', source_id: 'src_1', chosen: true }];
        row.reads = READS.slice(0, 2);
        r = await t.get(`/deep-dive/${ID}`, { as: USER });
        assert.strictEqual(r.status, 200);
        for (const label of ['Planning', 'Searching', 'Choosing pages', 'Reading', 'Taking notes', 'Writing the answer']) assert.ok(r.text.includes(label), `step ${label} is named`);
        const seed = JSON.parse(/<script type="application\/json" id="dd-state">([\s\S]*?)<\/script>/.exec(r.text)[1]);
        assert.deepStrictEqual([seed.state.plan.questions.length, seed.state.reads.length, seed.state.reads[0].findings], [2, 2, 1], 'the questions and the pages read are in the seed');
        assert.ok(!/<\/script><script>alert/.test(r.text), 'a page title cannot close the seed');
        assert.match(r.text, /js\/research-run\.js/);
        assert.match(r.text, /Cancel the deep dive/);

        // The answer.
        row.status = 'succeeded'; row.report = REPORT;
        r = await t.get(`/deep-dive/${ID}`, { as: USER });
        assert.strictEqual(r.status, 200);
        assert.match(r.text, /The answer<\/h2><p class="rs-summary">Yes, in most cold climates/);
        assert.match(r.text, /They keep a COP above 1 at -20 C\. <span class="rs-cites"><a class="rs-cite" href="#src-1"/);
        assert.match(r.text, /Grants cut the price\. <span class="rs-cites"><a class="rs-cite" href="#src-1"[^>]*>1<\/a><a class="rs-cite" href="#src-2"/, 'citations in page order');
        assert.match(r.text, /Question by question/);
        assert.match(r.text, /High confidence/);
        assert.match(r.text, /Side by side/);
        assert.match(r.text, /Where the sources disagree/);
        assert.match(r.text, /Get two quotes/);
        assert.match(r.text, /<li id="src-1" class="rs-src">/);
        assert.match(r.text, /a COP of 1\.8 at -20 C/, 'a page\'s notes keep their quotes');
        assert.match(r.text, /What it costs &lt;script&gt;/, 'a page title is escaped');
        assert.match(r.text, /1 could not be read/);
        assert.match(r.text, /robots\.txt disallows this page/);
        assert.ok(!/href="javascript:/.test(r.text), 'only http(s) is linked');
        assert.match(r.text, /The receipt: \$0\.01 of \$0\.10 held/);

        // The Markdown export.
        r = await t.get(`/deep-dive/${ID}/export/markdown`, { as: USER });
        assert.strictEqual(r.status, 200);
        assert.match(r.text, /^# Are heat pumps worth it/);
        assert.match(r.text, /1\. They keep a COP above 1 at -20 C\. \[1\]/);
        assert.match(r.text, /## Sources\n\n1\. \[Heat pumps explained\]\(https:\/\/example\.org\/heat-pumps\)/);

        // Your deep dives on the start page.
        r = await t.get('/deep-dive', { as: USER });
        assert.match(r.text, /Your deep dives/);
        assert.match(r.text, new RegExp(`href="/deep-dive/${ID}"`));
    } finally {
        await t.close();
    }
    process.stdout.write('deep dive (research): the search card, sign-in keeps the question, the general kind starts, the live seed, the answer with numbered sources, escaping, the export, your deep dives\n');
})().catch((err) => { console.error(err); process.exit(1); });
