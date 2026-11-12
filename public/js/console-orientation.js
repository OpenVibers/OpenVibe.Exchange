/* The owner console's "Try a picture" check: one picture at 256 px through the detector, the answer in words.
   It never turns or stores anything; the run on OpenVibe.AI is the same one the budget counts. */
(function () {
    'use strict';
    var file = document.querySelector('[data-orientation-file]');
    var button = document.querySelector('[data-orientation-try]');
    var out = document.querySelector('[data-orientation-result]');
    if (!file || !button || !out) return;
    var words = function (n) {
        if (n === 0) return 'already upright';
        if (n == null) return 'no answer';
        return 'turn ' + n + '° clockwise';
    };
    function say(text) { out.textContent = text; }
    function shrink(source) {
        return new Promise(function (resolve, reject) {
            var image = new Image();
            image.onload = function () {
                var scale = Math.min(1, 256 / Math.max(image.width, image.height));
                var canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(image.width * scale));
                canvas.height = Math.max(1, Math.round(image.height * scale));
                canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
                URL.revokeObjectURL(image.src);
                resolve(canvas.toDataURL('image/jpeg', 0.85));
            };
            image.onerror = function () { URL.revokeObjectURL(image.src); reject(new Error('That file is not a picture this browser can read.')); };
            image.src = URL.createObjectURL(source);
        });
    }
    button.addEventListener('click', function () {
        var picked = file.files && file.files[0];
        if (!picked) { say('Choose a picture first.'); return; }
        button.disabled = true;
        say('Looking at it…');
        shrink(picked).then(function (dataUrl) {
            return fetch('/console/orientation/try', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ image: { data_url: dataUrl } }),
            }).then(function (res) {
                return res.json().then(function (body) { return { ok: res.ok, body: body }; });
            });
        }).then(function (r) {
            if (!r.ok) { say(r.body && r.body.error ? r.body.error : 'The detector did not answer.'); return; }
            if (r.body.method === 'off') { say('The detector is off. Nothing was sent.'); return; }
            var confidence = r.body.confidence == null ? null : Math.round(Number(r.body.confidence) * 100);
            say('It says ' + words(r.body.rotation) + (confidence == null ? '' : ' (confidence ' + confidence + '%)') +
                ' · ' + (r.body.model || 'the routed model') + ' · $' + Number(r.body.cost_usd || 0).toFixed(4) +
                (r.body.receipt_id ? ' · receipt ' + r.body.receipt_id : ''));
        }).catch(function (err) {
            say(err && err.message ? err.message : 'The detector did not answer.');
        }).then(function () { button.disabled = false; });
    });
})();
