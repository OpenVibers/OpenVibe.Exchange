'use strict';
// Search, measured (plan AD.34 next 2, AD.39 item 10): /search/accuracy shows the latest accuracy run of search v2 by
// depth (right, answer in the sources, time, cost), its method and limits and every question; /search/accuracy.json is
// the run itself; the sitemap and llms.txt list the page and the search page links to it.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');
const accuracy = require('../server/search-accuracy');
const { accuracyPage } = require('../server/views/search-accuracy');

const run = (measured, fastRight) => ({
    measured, source: { name: 'SimpleQA', by: 'OpenAI', license: 'MIT', url: 'https://github.com/openai/simple-evals' },
    sample: { n: 2, of: 4326, seed: 7, left_out: 40 }, grader: 'the answer must contain the reference answer', max_cost_usd: 0.05,
    depths: {
        standard: { n: 2, correct: 2, accuracy: 100, gold_in_sources: 2, errors: 0, p50_ms: 6400, p90_ms: 9100, p50_cost_usd: 0.0013, total_cost_usd: 0.0026 },
        fast: { n: 2, correct: fastRight, accuracy: fastRight * 50, gold_in_sources: 2, errors: 0, p50_ms: 2500, p90_ms: 4000, p50_cost_usd: 0.0008, total_cost_usd: 0.0016 },
    },
    questions: [
        { q: 'Who won <the> prize?', gold: 'Ada & Bo', topic: 'Science', fast: { right: fastRight > 0, in_sources: true, ms: 2500, cost: 0.0008, answer: 'Ada & Bo [1]' }, standard: { right: true, in_sources: true, ms: 6400, cost: 0.0013, answer: 'Ada & Bo [2]' } },
        { q: 'What year?', gold: '1999', topic: 'History', fast: { right: false, in_sources: true, ms: 2500, cost: 0.0008, answer: 'Around 2000' }, standard: { right: true, in_sources: true, ms: 6400, cost: 0.0013, answer: '1999 [1]' } },
    ],
});

(async () => {
    await check('the newest run file is the one shown; none, or a broken file, is no run', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xa-'));
        assert.strictEqual(accuracy.latest(dir), null);
        fs.writeFileSync(path.join(dir, '2026-11-20.json'), JSON.stringify(run('2026-11-20', 1)));
        fs.writeFileSync(path.join(dir, '2026-11-28.json'), JSON.stringify(run('2026-11-28', 2)));
        fs.writeFileSync(path.join(dir, 'notes.json'), '{}');
        assert.strictEqual(accuracy.latest(dir).measured, '2026-11-28');
        const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'xa-'));
        fs.writeFileSync(path.join(broken, '2026-11-29.json'), '{ not json');
        assert.strictEqual(accuracy.latest(broken), null);
    });

    await check('the page: depths in order with right, in sources, time and cost; method; every question, escaped', async () => {
        const html = accuracyPage(run('2026-11-28', 1));
        const table = html.slice(html.indexOf('<tbody>'));
        assert.ok(table.indexOf('<code>fast</code>') < table.indexOf('<code>standard</code>'), 'fast before standard');
        assert.match(html, /<strong>50%<\/strong><small>1 of 2<\/small>/);
        assert.match(html, /At <code>standard<\/code> it answered 100% right/);
        assert.match(html, /6\.4 s<small>9\.1 s at the slow end<\/small>/);
        assert.match(html, /\$0\.0013<small>\$0\.0026 for all 2<\/small>/);
        assert.match(html, /seed 7\), leaving out the 40 used while tuning/);
        assert.ok(html.includes('Who won &lt;the&gt; prize?') && html.includes('Ada &amp; Bo'), 'escaped');
        assert.ok(!html.includes('<the>'));
        assert.match(html, /class="xa-miss">missed<\/td>/);
    });

    const t = await boot({ ai: createFakeAi() });
    try {
        const committed = accuracy.latest();
        assert.ok(committed, 'a run is committed in measurements/search-accuracy');
        await check('/search/accuracy answers with the committed run; its JSON is the run, open to any site', async () => {
            const page = await t.get('/search/accuracy');
            assert.strictEqual(page.status, 200);
            assert.match(page.text, /<h1>How accurate is search\?<\/h1>/);
            assert.ok(page.text.includes(committed.measured));
            const data = await t.get('/search/accuracy.json');
            assert.strictEqual(data.status, 200);
            assert.strictEqual(data.headers.get('access-control-allow-origin'), '*');
            assert.strictEqual(data.json().questions.length, committed.questions.length);
        });
        await check('the sitemap and llms.txt list it, and the search page links to it', async () => {
            assert.ok((await t.get('/sitemap.xml')).text.includes('/search/accuracy</loc>'));
            assert.ok((await t.get('/llms.txt')).text.includes('/search/accuracy'));
            assert.ok((await t.get('/search')).text.includes('href="/search/accuracy"'));
        });
    } finally {
        await t.close();
    }
    done();
})();
