'use strict';
const assert = require('node:assert/strict');
const { boot, check, done } = require('./helpers/boot');
const { createFakeAi } = require('./helpers/ai');
(async () => {
    const calls = [];
    const ai = {
        ...createFakeAi(),
        meRequest: async (token, path, options) => {
            calls.push({ path, options });
            return path.endsWith('key-usage')
                ? {
                      rows: [
                          {
                              day: '2026-11-09',
                              key_id: 'test',
                              model: '=formula',
                              requests: 1,
                              tokens_in: 1,
                              tokens_out: 2,
                              cost_usd: 0,
                              status: 'settled',
                          },
                      ],
                  }
                : { keys: [] };
        },
    };
    const t = await boot({ ai });
    try {
        const user = t.network.addUser('builder');
        await check(
            'dashboard needs sign in, private responses do not cache',
            async () => {
                assert.equal((await t.get('/dashboard')).status, 303);
                const r = await t.get('/dashboard/keys', { as: user });
                assert.equal(r.status, 200);
                assert.ok(r.headers.get('cache-control').includes('no-store'));
                assert.ok(r.text.includes('Monthly cap'));
            },
        );
        await check('foreign site cannot create keys', async () => {
            const n = calls.length;
            assert.equal(
                (
                    await t.get('/dashboard/keys', {
                        as: user,
                        origin: 'https://evil.example',
                        form: { name: 'Bad' },
                    })
                ).status,
                403,
            );
            assert.equal(calls.length, n);
        });
        await check('CSV escapes formula cells', async () => {
            const r = await t.get('/dashboard/usage.csv', { as: user });
            assert.equal(r.status, 200);
            assert.ok(r.text.includes("'=formula"));
        });
        await check(
            'Arena moves permanently and its API refuses anonymous mutations',
            async () => {
                assert.equal((await t.get('/arena')).status, 301);
                assert.equal(
                    (
                        await t.get('/api/v1/arena/rounds', {
                            json: { prompt: 'hello' },
                        })
                    ).status,
                    401,
                );
            },
        );
    } finally {
        await t.close();
    }
    done();
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
