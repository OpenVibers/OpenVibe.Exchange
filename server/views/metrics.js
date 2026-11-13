'use strict';

/**
 * The one way Exchange shows numbers (ai-metrics.md, 2026-11-12): openvibe-shared/ov-metrics. The builders are the
 * browser's (tiles, sparklines, bars, percentile strips); this module carries their data to the page and leaves the
 * server fallback — the same numbers in plain text, with no chart or tile of our own — for a reader without
 * JavaScript. Every word comes from OVMetrics.format in Node, so both renderings say the same thing.
 */
const ovServe = require('openvibe-shared/serve');
const M = require('openvibe-shared/ov-metrics');
const { assetVersion } = require('../render/layout');

const HEAD = `<script src="${ovServe.url('ov-metrics.js')}" defer></script><script src="/js/metrics-panel.js?v=${assetVersion('js/metrics-panel.js')}" defer></script>`;

/** The data as a script that cannot close its own tag, and cannot be read as markup. */
function json(parts) {
    return JSON.stringify(parts).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/**
 * A metrics block: the browser draws `parts` (each `{ kind, args }`, called as OVMetrics[kind](...args)), and the
 * server's `fallback` HTML is what a reader without JavaScript sees. The renderer hides the fallback only after a
 * builder has drawn, so a broken script leaves the numbers readable.
 */
function block(parts, fallback) {
    return `<div class="ex-metrics" data-ov-metrics><div class="ovm-fallback">${fallback}</div><div data-ov-metrics-live hidden></div><script type="application/json">${json(parts)}</script></div>`;
}

module.exports = { HEAD, block, format: M.format };
