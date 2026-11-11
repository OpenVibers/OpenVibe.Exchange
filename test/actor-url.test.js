'use strict';
/**
 * OpenVibe.Actor's address (one-engine slice): the public base is openvibe.actor. A server with no OV_ACTOR_URL
 * must reach Actor there, not at a host that does not resolve — a production companion turn failed on that.
 */
const assert = require('assert');
const { check, done } = require('./helpers/boot');
const configLib = require('../server/config');
const { createActor } = require('../server/actor');

(async () => {
    await check('the config default is the public Actor base', async () => {
        assert.strictEqual(configLib.load({}).actor.url, 'https://openvibe.actor');
    });

    await check('a client with no actor config still calls openvibe.actor', async () => {
        let called = null;
        const actor = createActor({
            config: {},
            fetchImpl: async (url) => { called = String(url); throw new Error('offline'); },
        });
        await assert.rejects(() => actor.turn({ token: 'test-token', task: 'hello', budgetUsd: 0.01 }), /could not be reached/);
        assert.ok(called && called.startsWith('https://openvibe.actor/api/v1/tasks'), called);
    });

    done();
})();
