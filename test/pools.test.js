'use strict';
// Pool management moved to Link; its old page fixtures are retained in test/retired/pools.test.js.
const assert = require('node:assert/strict');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');
(async () => {
    const t = await boot({ ai: createFakeAi() });
    try {
        const user = t.network.addUser('owner');
        await check(
            'every seller page redirects permanently without exposing machine names',
            async () => {
                for (const path of ['/sell', '/sell/pool', '/sell/anything'])
                    for (const options of [{}, { as: user }]) {
                        const r = await t.get(path, options);
                        assert.equal(r.status, 301);
                        assert.equal(
                            r.headers.get('location'),
                            'https://openvibe.link',
                        );
                    }
            },
        );
        await check(
            'pool mutations still require same-origin sign-in',
            async () => {
                const r = await t.get('/sell/pool', {
                    as: user,
                    origin: 'https://evil.example',
                    form: { machines: 'not-a-machine' },
                });
                assert.equal(r.status, 403);
                assert.equal(t.network.state.poolProposals.length, 0);
            },
        );
    } finally {
        await t.close();
    }
    done();
})();
