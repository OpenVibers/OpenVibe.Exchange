'use strict';
// /deep-dive: the signed-out explanation, the start form with its prices, a live run's steps, choosing sites,
// the report (with its captures and evidence), the Markdown and JSON exports, the private shot, and cancel.
const assert = require('assert');
const { boot } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');

const ID = 'run_TEST';
const API = 'https://openvibe.exchange';
const USER = { subject: 'usr_01JAB2C3D4E5F6G7H8J9K0MNPQ', username: 'probe' };

const REPORT = {
    id: ID, schema: 'ai.deep-dive@1', run_id: ID, status: 'succeeded',
    input: { question: 'a phone-first robot control panel', depth: 'quick', max_sites: 6 },
    steps: [
        { key: 'plan', status: 'done', detail: '9 questions' }, { key: 'search', status: 'done', detail: '12 sources' },
        { key: 'choose', status: 'done', detail: '6 sites' }, { key: 'capture', status: 'done', detail: '12 captures' },
        { key: 'analyse', status: 'done', detail: '6 sites' }, { key: 'synthesise', status: 'done', detail: '8 patterns' },
        { key: 'report', status: 'done', detail: 'ready' },
    ],
    sources: [{ id: 'src_1', kind: 'web', title: 'A control panel', url: 'https://example.com/robot', publisher: 'example.com', engine: 'openvibe', snippet: 'A panel', license: null, read_at: '2026-11-11T10:00:00.000Z' }],
    captures: [{ id: 'cap_1', source_id: 'src_1', url: 'https://example.com/robot', final_url: 'https://example.com/robot', title: 'A control panel', captured_at: '2026-11-11T10:00:45.000Z', viewport: 390, theme: 'light', full_page: true, media_id: 'med_01JAB2C3D4E5F6G7H8J9K0MNPQ', width: 390, height: 2000, crops: [{ id: 'crop_1_1', media_id: 'med_01JAB2C3D4E5F6G7H8J9K0MNPR', y: 0, height: 844 }], dom: {}, extras: null, skip: null, cached: false }],
    analysis: [{ source_id: 'src_1', url: 'https://example.com/robot', summary: 'One thumb reaches every control.', first_impression: 'The camera fills the first screen.', strengths: ['Reachable'], weaknesses: ['Stop is not separated'], evidence: [{ claim: 'Reachable', source_id: 'src_1', capture_id: 'cap_1', crop_id: 'crop_1_1', url: 'https://example.com/robot', read_at: '2026-11-11T10:00:45.000Z' }] }],
    synthesis: {
        patterns: [{ name: 'Live view first', what: 'The camera is the page.', sites: ['src_1'], usage_count: 1, evidence: [{ claim: 'Camera first', source_id: 'src_1', capture_id: 'cap_1', crop_id: 'crop_1_1', url: 'https://example.com/robot', read_at: '2026-11-11T10:00:45.000Z' }] }],
        comparison: { columns: ['Site', 'First screen'], rows: [['example.com', 'live frame']] },
        best: { source_id: 'src_1', what: 'The frame carries the state.', evidence: [{ claim: 'State in the frame', source_id: 'src_1', capture_id: 'cap_1', crop_id: null, url: 'https://example.com/robot', read_at: '2026-11-11T10:00:45.000Z' }] },
        mistakes: [{ what: 'The stop control is not separate.', evidence: [{ claim: 'One row', source_id: 'src_1', capture_id: 'cap_1', crop_id: 'crop_1_1', url: 'https://example.com/robot', read_at: '2026-11-11T10:00:45.000Z' }] }],
        gap: 'No panel shows what the robot is about to do.', reference_tokens: { palettes: [{ source_id: 'src_1', colours: ['#0c0e12', '#ffffff'] }], type_scales: [{ source_id: 'src_1', families: ['Inter'], sizes: ['14px'] }], spacing: [{ source_id: 'src_1', steps: ['4px'] }] },
        do: ['Keep controls in one hand'], dont: ['Do not share the stop row'], accessibility: ['Name every icon'], speed: ['Show the frame first'],
    },
    recommendations: [{ id: 'rec_1', what: 'Put the stop alone.', why: 'The best panel suggests it.', rule: { id: 'tap-targets', status: 'follows', text: 'Controls are big enough for a thumb.' }, evidence: [{ claim: 'The stop shares a row', source_id: 'src_1', capture_id: 'cap_1', crop_id: 'crop_1_1', url: 'https://example.com/robot', read_at: '2026-11-11T10:00:45.000Z' }] }],
    receipt: { price_usd: 0.2, held_usd: 0.2, cost_usd: 0.014, captures_count: 1, synthetic: false, models: [{ step: 'plan', provider: 'deepseek', model: 'deepseek-v4-flash', tokens_in: 900, tokens_out: 320, cost_usd: 0.0004, ms: 1800 }] },
    gaps: ['No Expert extras at Quick depth.'],
    created_at: '2026-11-11T10:00:00.000Z', updated_at: '2026-11-11T10:03:21.000Z', finished_at: '2026-11-11T10:03:21.000Z',
};

(async () => {
    const ai = createFakeAi();
    const t = await boot({ ai });
    try {
        // Signed out: the page explains and asks for sign-in, and still names the price of every depth.
        let r = await t.get('/deep-dive');
        assert.strictEqual(r.status, 200);
        assert.match(r.text, /Deep dive/);
        assert.match(r.text, /Expert design research/);
        assert.match(r.text, /Sign in to run a deep dive/);
        assert.match(r.text, /\$0\.20/);
        assert.match(r.text, /Search every way we have/);

        // Signed in: the field, the depths and their prices.
        r = await t.get('/deep-dive', { as: USER });
        assert.strictEqual(r.status, 200);
        assert.match(r.text, /What are you designing\?/);
        assert.match(r.text, /name="depth" value="quick" checked/);
        assert.match(r.text, /\$0\.50/);
        assert.match(r.text, /Start the deep dive/);

        // Start: AI is called for the person and the page redirects to the run.
        r = await t.get('/deep-dive', { as: USER, form: { question: 'a phone-first robot control panel', depth: 'quick', sites: 'https://example.com/robot' } });
        assert.strictEqual(r.status, 303);
        assert.strictEqual(r.headers.get('location'), `/deep-dive/${ID}`);
        const row = ai.deepDives.get(ID);
        assert.strictEqual(row.question, 'a phone-first robot control panel');
        assert.strictEqual(row.owner.id, USER.subject);

        // A running run: the six step names, the progress and Cancel.
        row.status = 'running'; row.step = 'capture'; row.progress = 0.5;
        row.steps = [{ key: 'plan', status: 'done' }, { key: 'search', status: 'done' }, { key: 'choose', status: 'done' }, { key: 'capture', status: 'running', detail: '3/6 sites' }, { key: 'analyse', status: 'pending' }];
        r = await t.get(`/deep-dive/${ID}`, { as: USER });
        assert.strictEqual(r.status, 200);
        for (const label of ['Planning', 'Searching', 'Choosing sites', 'Capturing', 'Analysing', 'Writing it up']) assert.ok(r.text.includes(label), `step ${label} is named`);
        assert.match(r.text, /3\/6 sites/);
        assert.match(r.text, /Cancel the deep dive/);
        assert.match(r.text, /role="progressbar"/);

        // Choosing: the candidates, a Drop form and Start capture.
        row.status = 'choosing'; row.step = 'choose'; row.candidates = [{ id: 'site_1', url: 'https://example.com/robot', title: 'example.com', reason: 'a phone-first panel' }];
        r = await t.get(`/deep-dive/${ID}`, { as: USER });
        assert.strictEqual(r.status, 200);
        assert.match(r.text, /Choose the sites to capture/);
        assert.match(r.text, /a phone-first panel/);
        assert.match(r.text, /Start capture/);
        assert.match(r.text, /name="drop" value="https:\/\/example.com\/robot"/);

        // Sites: add one, drop one, and the person's start is sent.
        r = await t.get(`/deep-dive/${ID}/sites`, { as: USER, form: { sites: 'https://example.org/other', drop: 'https://example.com/robot', start: '1' } });
        assert.strictEqual(r.status, 303);
        const call = ai.deepDiveCalls.find((c) => c.body && c.body.start);
        assert.deepStrictEqual(call.body.add, ['https://example.org/other']);
        assert.deepStrictEqual(call.body.drop, ['https://example.com/robot']);

        // Succeeded: the report page with captures, patterns, recommendations, receipt and both exports.
        row.status = 'succeeded'; row.report = REPORT; row.step = 'report'; row.progress = 1;
        r = await t.get(`/deep-dive/${ID}`, { as: USER });
        assert.strictEqual(r.status, 200);
        assert.match(r.text, /What the sites agree on/);
        assert.match(r.text, /Live view first/);
        assert.match(r.text, /The gap nobody fills/);
        assert.match(r.text, /Put the stop alone/);
        assert.match(r.text, /Rule tap-targets \(follows\)/);
        assert.match(r.text, /The receipt/);
        assert.match(r.text, /deepseek-v4-flash/);
        assert.match(r.text, /Use on OpenVibe.Design/);
        assert.match(r.text, /\/deep-dive\/run_TEST\/shot\/crop_1_1/);
        assert.match(r.text, /example\.com/);

        // Exports.
        r = await t.get(`/deep-dive/${ID}/export/markdown`, { as: USER });
        assert.strictEqual(r.status, 200);
        assert.match(r.headers.get('content-type'), /text\/markdown/);
        assert.match(r.text, /^# a phone-first robot control panel/);
        assert.match(r.text, /Live view first/);
        r = await t.get(`/deep-dive/${ID}/export/json`, { as: USER });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.json().schema, 'ai.deep-dive@1');
        assert.strictEqual(r.json().recommendations[0].rule.id, 'tap-targets');

        // The private shot is proxied from AI.
        r = await t.get(`/deep-dive/${ID}/shot/crop_1_1`, { as: USER });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.headers.get('content-type'), 'image/png');
        assert.ok(r.buffer.length > 10);
        assert.match(r.headers.get('cache-control'), /private/);

        // Cancel is a POST and goes to AI.
        r = await t.get(`/deep-dive/${ID}/cancel`, { as: USER, form: { confirm: '1' } });
        assert.strictEqual(r.status, 303);
        assert.ok(ai.deepDiveCalls.some((c) => c.cancel && c.id === ID));

        // A signed-out run page asks for sign-in; a run AI does not know is a 404.
        r = await t.get(`/deep-dive/${ID}`);
        assert.strictEqual(r.status, 401);
        assert.match(r.text, /Sign in to run a deep dive/);
        r = await t.get('/deep-dive/run_UNKNOWN', { as: USER });
        assert.strictEqual(r.status, 404);
        assert.match(r.text, /No such deep dive/);

        // A cross-site POST is refused.
        r = await t.get(`/deep-dive/${ID}/cancel`, { as: USER, form: { confirm: '1' }, origin: 'https://evil.example' });
        assert.strictEqual(r.status, 403);
        assert.ok(API);
        process.stdout.write('deep dive: 34 checks passed\n');
    } finally { await t.close(); }
})().catch((e) => { process.stderr.write(String(e && e.stack || e) + '\n'); process.exit(1); });
