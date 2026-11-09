'use strict';
/**
 * Pooled machines, part 4 (design 2026-11-06): "Pool your machines" on /sell and the pool's offer card. The page
 * reads the person's machines, pools, link checks and fit table from Network and AI (the mock Network here); it
 * measures nothing itself. Every number is one that was measured; the rest says "not measured yet".
 */
const assert = require('assert');
const { ids } = require('openvibe-contracts');
const { boot, check, done } = require('../helpers/boot');
const { createFakeAi } = require('../helpers/ai');

const dev = () => `dev_${ids.ulid()}`;
const poolOffer = (models) => ({
    offer_id: 'community_abc123', kind: 'pool', label: 'Community pool (3 machines)', models,
    pool: { machines: ['pseudonym-a', 'pseudonym-b', 'pseudonym-c'], head: 'pseudonym-a' },
    free_only: true, verified: false, hours: { start: '00:00', end: '00:00', tz: 'UTC' }, concurrency: 1,
    price: { in_per_million: 1, out_per_million: 2 }, audience: 'everyone', health: { status: 'up' },
    open_now: true, ready: true,
});

(async () => {
    const ai = createFakeAi({ community: [poolOffer(['llama-3-8b-abliterated'])] });
    const t = await boot({ ai });
    const user = t.network.addUser('alice');
    const desktop = dev(), laptop = dev(), rack = dev(), other = dev();
    const announce = (id, network, freeVram, hardware) => ({ id, free_vram: freeVram, free_ram: 32000, hardware, network });

    try {
        await check('signed out, /sell has no pool card (it needs a person’s machines)', async () => {
            const r = await t.get('/sell');
            assert.strictEqual(r.status, 200, r.text);
            assert.ok(!r.text.includes('Pool your machines'), 'no pool card when signed out');
        });

        await check('fewer than two machines: one line and the install link', async () => {
            t.network.state.machines = [{ id: desktop, name: 'Desktop', online: true }];
            t.network.state.candidates = [announce(desktop, 'home', 24000, 'RTX 4090')];
            t.network.state.pools = [];
            const r = await t.get('/sell', { as: user });
            assert.strictEqual(r.status, 200, r.text);
            assert.ok(r.text.includes('Pool your machines'), 'the card is there');
            assert.ok(r.text.includes('Pooling needs two or more of your machines on the same network. Add one with'), 'the one line');
            assert.ok(r.text.includes('https://openvibe.link'), 'the install link');
            assert.ok(!r.text.includes('1. Choose the machines'), 'no four steps with one machine');
        });

        await check('a machine on another network is greyed, with its reason', async () => {
            t.network.state.machines = [{ id: desktop, name: 'Desktop', online: true }, { id: laptop, name: 'Laptop', online: true }];
            t.network.state.candidates = [announce(desktop, 'home', 24000, 'RTX 4090'), announce(laptop, 'elsewhere', 8000, 'RTX 3060')];
            const r = await t.get('/sell', { as: user });
            assert.strictEqual(r.status, 200, r.text);
            assert.ok(r.text.includes('Not on the same network as Desktop: pools work on one home network, not across the internet'), r.text);
            assert.ok(/class="ex-pool-machine is-off"/.test(r.text), 'the machine is greyed, not hidden');
            assert.ok(r.text.includes('Desktop') && r.text.includes('Laptop'), 'both machines are listed');
        });

        await check('a failed link says the number and the limit; a good one says both numbers', async () => {
            t.network.state.machines = [
                { id: desktop, name: 'Desktop', online: true }, { id: laptop, name: 'Laptop', online: true }, { id: rack, name: 'Rack', online: true },
            ];
            t.network.state.candidates = [announce(desktop, 'home', 24000, 'RTX 4090'), announce(laptop, 'home', 8000, 'RTX 3060'), announce(rack, 'home', 16000, 'RTX 4080')];
            t.network.state.pools = [{
                id: 'pool_TEST', head: desktop, created_at: '2026-11-07T00:00:00.000Z',
                machines: [{ id: desktop, approved: true, ready: true, vram_share: 0.5 }, { id: laptop, approved: true, ready: true, vram_share: 0.17 }, { id: rack, approved: true, ready: true, vram_share: 0.33 }],
                links: [{ machine: laptop, rtt_ms: 2, mbps: 940 }, { machine: rack, rtt_ms: 40, mbps: 940 }],
                fit: [{ model: 'llama-3-8b-abliterated', fits: true, tokens_per_second: 9 }, { model: 'qwen3-32b', fits: true, tokens_per_second: null }],
            }];
            const r = await t.get('/sell', { as: user });
            assert.strictEqual(r.status, 200, r.text);
            assert.ok(r.text.includes('2 ms, 940 Mb/s: good'), 'the good link in words');
            assert.ok(r.text.includes('40 ms; a pool needs under 5 ms'), 'the failed link says the number and the limit');
            assert.ok(r.text.includes('about 9 tokens a second'), 'a measured speed');
            assert.ok(r.text.includes('not measured yet'), 'a model nobody measured says so');
            assert.ok(!/about 0 tokens a second/.test(r.text), 'an absent measurement is never a zero');
            assert.ok(r.text.includes('Head: <b>Desktop</b>'), 'the head is the machine with the most free VRAM');
        });

        await check('nothing is offered until every member approves', async () => {
            t.network.state.pools = [{
                id: 'pool_TEST', head: desktop, created_at: '2026-11-07T00:00:00.000Z',
                machines: [{ id: desktop, approved: true, ready: true, vram_share: 0.75 }, { id: laptop, approved: false, ready: false, vram_share: 0.25 }],
            }];
            const waiting = await t.get('/sell', { as: user });
            assert.ok(waiting.text.includes('Waiting for approval on <b>Laptop</b>'), waiting.text);
            assert.ok(waiting.text.includes('Approved'), 'the machine that approved says so');
            assert.ok(waiting.text.includes('Nothing is offered until every member approves.'), 'nothing is offered yet');
            assert.ok(!waiting.text.includes('one price for the whole pool'), 'the offer controls stay closed');

            t.network.state.pools[0].machines = t.network.state.pools[0].machines.map((m) => ({ ...m, approved: true, ready: true }));
            const approved = await t.get('/sell', { as: user });
            assert.ok(approved.text.includes('one price for the whole pool'), 'the same controls as one machine, applied to the pool');
            assert.ok(approved.text.includes('everyone, your followers or a group'), 'who may use it');
            assert.ok(approved.text.includes('the whole pool pauses while any member is in use'), 'idle only');
            assert.ok(approved.text.includes('Prompts reach your head machine (Desktop); the others only see numbers in transit.'), 'the privacy sentence');
            assert.ok(!approved.text.includes('Nothing is offered until every member approves.'), 'it is offered now');
        });

        await check('the public card shows only the count, never a machine', async () => {
            t.network.state.machines = [{ id: desktop, name: 'Workstation Alpha', online: true }];
            const models = await t.get('/models');
            assert.strictEqual(models.status, 200, models.text);
            assert.ok(models.text.includes('Community pool (3 machines)'), 'the label');
            assert.ok(models.text.includes('Free tier only'), 'a new pool says it serves the free tier only');
            assert.ok(!models.text.includes('&lt;span'), 'no badge markup escapes as text');
            assert.ok(!models.text.includes('Workstation Alpha'), 'no machine name in public');
            const model = await t.get('/m/meta-llama/llama-3-8b-abliterated');
            assert.ok(model.text.includes('Community pool (3 machines)'), 'the offer card carries the pool label');
            assert.ok(!model.text.includes('Workstation Alpha'), 'still no machine name');
            const owner = await t.get('/sell', { as: user });
            assert.ok(owner.text.includes('Workstation Alpha'), 'the owner sees the machine names');
        });

        await check('creating the pool goes through Network, and stopping it says what happens', async () => {
            t.network.state.machines = [{ id: desktop, name: 'Desktop', online: true }, { id: laptop, name: 'Laptop', online: true }];
            t.network.state.candidates = [announce(desktop, 'home', 24000, 'RTX 4090'), announce(laptop, 'home', 8000, 'RTX 3060')];
            t.network.state.pools = [];
            const made = await t.get('/sell/pool', {
                as: user, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: `machines=${desktop}&machines=${laptop}&head=${desktop}`,
            });
            assert.strictEqual(made.status, 303, made.text);
            assert.strictEqual(t.network.state.poolProposals.length, 1);
            assert.deepStrictEqual(t.network.state.poolProposals[0], { machines: [desktop, laptop], head: desktop });

            const one = await t.get('/sell/pool', {
                as: user, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `machines=${desktop}`,
            });
            assert.strictEqual(one.status, 200, 'one machine is refused before Network is called');
            assert.ok(one.text.includes('Choose two or more of your machines on the same network.'));

            t.network.state.pools = [{ id: 'pool_TEST', head: desktop, created_at: '2026-11-07T00:00:00.000Z', machines: [{ id: desktop, approved: true, ready: true, vram_share: 0.6 }, { id: laptop, approved: true, ready: true, vram_share: 0.4 }] }];
            const stop = await t.get('/sell/pool/pool_TEST/stop', {
                as: user, method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: '',
            });
            assert.strictEqual(stop.status, 303, stop.text);
            assert.deepStrictEqual(t.network.state.poolRevoked, ['pool_TEST']);
        });

        await check('no measurements: the page says not measured yet, never a number', async () => {
            t.network.state.machines = [{ id: desktop, name: 'Desktop', online: true }, { id: laptop, name: 'Laptop', online: true }];
            t.network.state.candidates = [announce(desktop, 'home', 24000, 'RTX 4090'), announce(laptop, 'home', 8000, 'RTX 3060')];
            t.network.state.pools = [];
            const r = await t.get('/sell', { as: user });
            assert.ok(r.text.includes('link not measured yet'), 'an unmeasured link says so');
            assert.ok(r.text.includes('No model has been measured on these machines yet'), 'an empty fit table says so');
            assert.ok(!/\bMb\/s: good\b/.test(r.text), 'no invented speed');
        });

        await check('the pool card is gone for a stranger’s machines when Network cannot answer', async () => {
            t.network.setDown(true);
            const r = await t.get('/sell', { as: user });
            assert.strictEqual(r.status, 200, 'the page still renders');
            assert.ok(r.text.includes('Your machines could not be read right now. Reload in a moment.'), 'the read says why');
            const anon = await t.get('/sell');
            assert.ok(!anon.text.includes('Pool your machines'), 'signed out is unaffected');
            t.network.setDown(false);
        });

        await check('phone: the four steps stack, every control is 44 px, nothing is wider than the screen', async () => {
            const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'public', 'css', 'exchange.css'), 'utf8');
            assert.ok(/\.ex-pool \.ex-field select, \.ex-pool \.ex-btn, \.ex-pool \.ovk-btn \{ min-height: 44px; \}/.test(css), 'controls are 44 px');
            assert.ok(/@media \(max-width: 560px\)/.test(css), 'the phone layout is stacked');
            t.network.state.machines = [{ id: desktop, name: 'Desktop', online: true }, { id: laptop, name: 'Laptop', online: true }];
            t.network.state.candidates = [announce(desktop, 'home', 24000, 'RTX 4090'), announce(laptop, 'home', 8000, 'RTX 3060')];
            t.network.state.pools = [{ id: 'pool_TEST', head: desktop, created_at: '2026-11-07T00:00:00.000Z', machines: [{ id: desktop, approved: true, ready: true, vram_share: 0.6 }, { id: laptop, approved: false, ready: false, vram_share: 0.4 }] }];
            const r = await t.get('/sell', { as: user });
            assert.strictEqual((r.text.match(/class="ex-pool-step"/g) || []).length, 4, 'four stacked step cards');
            assert.ok(r.text.includes('class="ex-pool ex-pool-steps"'), 'the steps container');
        });
    } finally {
        await t.close();
    }
    done();
})().catch((err) => { console.error(err); process.exitCode = 1; });
