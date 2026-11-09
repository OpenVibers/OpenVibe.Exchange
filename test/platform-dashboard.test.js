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
                : options?.method === 'POST'
                  ? { secret: 'fixture-only', key: { name: options.body.name } }
                  : { keys: [{ id: 'fixture', name: 'Expiring key', prefix: 'fixture', monthly_cap_usd: 5, allowed_models: [], expires_at: '2027-01-01T00:00:00.000Z' }] };
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
                assert.ok(r.text.includes('name="expires_at"'));
                assert.ok(r.text.includes('expires Jan 1, 2027, 00:00 UTC'), 'the expiry reads as a date with its year and time');
                assert.ok(r.text.includes('xd-key-main'), 'main dashboard cards are preserved');
            },
        );
        await check('key creation forwards optional UTC expiry', async () => {
            const response = await t.get('/dashboard/keys', {
                as: user,
                form: { name: 'Expires', monthly_cap_usd: '5', allowed_models: '', expires_at: '2027-01-01T00:00' },
            });
            assert.equal(response.status, 200);
            assert.equal(calls.at(-1).options.body.expires_at, '2027-01-01T00:00Z');
            assert.ok(response.text.includes('Copy your key now'));
        });
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
