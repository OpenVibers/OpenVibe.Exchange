'use strict';
const assert = require('node:assert/strict');
const { createFakeAi } = require('./helpers/ai');
const { parseSearch, searchCatalog } = require('../server/model-search');

(async () => {
    const catalog = await createFakeAi().catalog();
    const fast = searchCatalog(catalog, [], parseSearch({ q: 'fast coder under $1' }));
    assert.ok(Array.isArray(fast));
    assert.ok(fast.length > 0, 'general chat offers can answer a coding task query');
    assert.ok(fast.every((r) => r.price.out <= 1));
    assert.ok(fast.every((r) => r.task_match && r.task_match.includes('not measured')));
    const provider = searchCatalog(catalog, [], parseSearch({ provider: 'DeepInfra', max_price: '0.5' }));
    assert.equal(provider.length, 1);
    assert.equal(provider[0].provider, 'DeepInfra');
    assert.equal(provider[0].price.out, 0.3);
    const vision = searchCatalog(catalog, [], parseSearch({ q: 'cheap vision model' }));
    assert.equal(vision.length, 0);
    assert.throws(() => parseSearch({ max_price: '-1' }), RangeError);
    process.stdout.write('model search passed\n');
})().catch((err) => { process.stderr.write(String(err.stack || err)); process.exitCode = 1; });
