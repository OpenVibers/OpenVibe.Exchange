'use strict';
const assert = require('node:assert/strict');
const { createFakeAi } = require('./helpers/ai');
const platform = require('../server/views/platform');

(async () => {
    const catalog = await createFakeAi().catalog();
    const home = platform.home({ catalog, usage: {}, viewer: { kind: 'anonymous' } });
    assert.match(home, /<form[^>]+data-ovt-composer/);
    assert.match(home, /action="\/models"/);
    assert.match(home, /name="q"/);
    const list = platform.modelsPage({ catalog, query: { q: 'Gemini', provider: 'google', capability: 'vision' } });
    assert.equal((list.match(/name="q"/g) || []).length, 1, 'one main search box');
    assert.match(list, /class="ovt-c-row"/);
    assert.match(list, /class="ovt-c-tools"/);
    assert.match(list, /name="provider" value="google"/);
    assert.match(list, /name="capability" value="vision"/);
    assert.match(list, /data-ovt-text>Gemini<\/textarea>/);
    assert.match(list, /<button[^>]+type="submit">Apply filters<\/button>/);
    assert.doesNotMatch(list, /data-ovt-text required/, 'filter-only search must be submittable');
    process.stdout.write('model composer passed\n');
})().catch((err) => { process.stderr.write(String(err.stack || err)); process.exitCode = 1; });
