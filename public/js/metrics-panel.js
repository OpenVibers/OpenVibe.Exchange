'use strict';

/**
 * Draws every [data-ov-metrics] block with openvibe-shared/ov-metrics (ai-metrics.md, 2026-11-12). The server leaves
 * the block's parts as JSON and the same numbers as plain text; this script draws the tiles, sparklines, bars and
 * percentile strips with OVMetrics and only then hides the text. Without JavaScript, or if the script fails, the text
 * is what a reader sees: no number is lost, and no chart is invented here.
 */
(function () {
    if (typeof OVMetrics === 'undefined') return; // the server's plain numbers stay
    var FORMATS = {
        ms: OVMetrics.format.ms,
        usd: OVMetrics.format.usd,
        count: OVMetrics.format.count,
        tokens: OVMetrics.format.tokens,
        rate: OVMetrics.format.rate,
        tps: OVMetrics.format.tps,
        bytes: OVMetrics.format.bytes,
        delta: OVMetrics.format.delta,
    };

    function resolved(value) {
        if (!value || typeof value !== 'object' || typeof value.format !== 'string') return value;
        var copy = {};
        for (var key in value) if (Object.prototype.hasOwnProperty.call(value, key)) copy[key] = value[key];
        copy.format = FORMATS[value.format] || OVMetrics.format.count;
        return copy;
    }

    function draw() {
        var blocks = document.querySelectorAll('[data-ov-metrics]');
        for (var i = 0; i < blocks.length; i += 1) {
            var box = blocks[i];
            var live = box.querySelector('[data-ov-metrics-live]');
            var data = box.querySelector('script[type="application/json"]');
            if (!live || !data || typeof OVMetrics === 'undefined') continue;
            try {
                var parts = JSON.parse(data.textContent || '[]');
                var frag = document.createDocumentFragment();
                for (var j = 0; j < parts.length; j += 1) {
                    var part = parts[j];
                    if (part && part.kind === 'heading' && part.text) {
                        var heading = document.createElement('p');
                        heading.className = 'ovm-label';
                        heading.textContent = String(part.text);
                        frag.append(heading);
                        continue;
                    }
                    if (!part || typeof part.kind !== 'string' || typeof OVMetrics[part.kind] !== 'function') continue;
                    var args = (part.args || []).map(resolved);
                    frag.append(OVMetrics[part.kind].apply(OVMetrics, args));
                }
                if (!frag.childNodes.length) continue;
                live.append(frag);
                var fallback = box.querySelector('.ovm-fallback');
                if (fallback) fallback.hidden = true;
                live.hidden = false;
            } catch (err) {
                // The server's plain numbers stay; a metrics block never breaks the page.
            }
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', draw);
    else draw();
})();
