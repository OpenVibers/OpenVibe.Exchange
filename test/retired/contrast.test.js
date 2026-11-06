'use strict';
// WCAG 2.1 AA: the passport stamp's small line was 3.8:1 at .8 opacity. It now sits at .95.
//   node test/contrast.test.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'exchange.css'), 'utf8');
assert.ok(
    css.includes('.ex-motif-passport small { font-size: .68rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; opacity: .95; }'),
    'the passport small line is .95, not .8'
);
assert.ok(!css.includes('.ex-motif-passport small { font-size: .68rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; opacity: .8; }'), 'the .8 stamp line is gone');
console.log('contrast: the passport stamp reads');
