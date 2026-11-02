'use strict';
// Exchange's home leads with what is real (the owner, 10-31: empty sections made the rooms look unfinished). With nothing
// listed there is no empty "Fresh listings" box under the hero: one short "be the first" row follows the scenes.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const views = require('../server/views');

const src = fs.readFileSync(path.join(__dirname, '..', 'server/views/index.js'), 'utf8');
assert.match(src, /room\.slice\(0, at\) \+ live \+ room\.slice\(at, end\) \+ beFirst \+ room\.slice\(end\)/, 'the real above the scenes, the missing after them');
assert.ok(!src.includes('Nothing is listed yet'), 'no empty box under the hero');

const empty = views.home({ listings: [], counts: {} });
assert.ok(!empty.includes('id="ex-listings"'), 'no empty Fresh listings');
assert.ok(empty.indexOf('Be the first') > empty.indexOf('class="sc-room-scenes"'), 'the row follows the scenes');
assert.ok(empty.includes('href="/submit">List something</a>'), 'it says how the first one starts');
console.log('exchange home: real first, one "be the first" row while nothing is listed');
