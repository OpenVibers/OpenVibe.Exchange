'use strict';
/**
 * The free/swap safety rules: the fixed prohibited-items list, the no-money rule, and cleanText. A legitimate
 * phrase such as "a cash register icon pack" is not refused; a price or a payment request is.
 */
const assert = require('assert');
const { findProhibited, refusals, cleanText, SAFETY, PROHIBITED, MONEY_AMOUNT } = require('../server/safety');
const { check, done } = require('./helpers/boot');

(async () => {
    await check('the prohibited list catches the plain cases', async () => {
        assert.strictEqual(findProhibited('A shotgun for swap').code, 'weapons');
        assert.strictEqual(findProhibited('Cocaine, cheap').code, 'drugs');
        assert.strictEqual(findProhibited('A ransomware builder').code, 'malware');
        assert.strictEqual(findProhibited('Escort services').code, 'sexual');
        assert.strictEqual(findProhibited('A forged passport').code, 'forged');
        assert.strictEqual(findProhibited('A kitten').code, 'animals');
        assert.strictEqual(findProhibited('Yours for $20').code, 'money');
        assert.strictEqual(findProhibited('Pay by PayPal').code, 'money');
        assert.ok(PROHIBITED.length >= 6);
        assert.ok(SAFETY.includes('no payments') || SAFETY.includes('has no payments'));
    });

    await check('ordinary maker copy is not refused', async () => {
        assert.strictEqual(findProhibited('A cash register icon pack for a shop theme'), null);
        assert.strictEqual(findProhibited('A 12-column grid and a type kit'), null);
        assert.strictEqual(findProhibited('A surf map with three ramps'), null);
        assert.strictEqual(findProhibited(''), null);
        assert.ok(MONEY_AMOUNT.test('€15'));
        assert.ok(!MONEY_AMOUNT.test('version 15'));
    });

    await check('refusals carry the API code, and cleanText normalises plain text', async () => {
        const hit = refusals('A theme', 'and a firearm');
        assert.strictEqual(hit.status, 400);
        assert.strictEqual(hit.code, 'exchange.prohibited');
        assert.ok(hit.message.includes('weapons'));
        assert.strictEqual(refusals('A theme'), null);
        assert.strictEqual(cleanText('  a\r\nb\u0000  ', 20), 'a\nb');
        assert.strictEqual(cleanText('abcdef', 3), 'abc');
    });

    done();
})();
