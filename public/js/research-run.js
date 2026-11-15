/* /deep-dive/:id while a general deep dive runs (AI research.deep_dive). Drawn from the run's state and redrawn in
 * place every two seconds, like the design dive's live view (deep-dive.js) and on its styles: the numbers count up,
 * each step is a fold that says what it did and how long it took (the running one open), with its breakdown — the
 * questions the plan wrote, the pages chosen and why, each page as it is read (or why it could not be), each page's
 * notes as they land. New rows arrive with a little motion; the bar shimmers while it works. Nothing reloads until the
 * run ends (then the answer). Text is always set with textContent. Motion follows html[data-ov-motion] and
 * prefers-reduced-motion. */
(function () {
    'use strict';
    var root = document.querySelector('[data-dd-run]');
    var seed = document.getElementById('dd-state');
    if (!root || !seed) return;
    var S;
    try { S = JSON.parse(seed.textContent); } catch (e) { return; }
    var LABEL = S.labels || {}, NOTE = S.notes || {}, ORDER = S.order || Object.keys(LABEL);
    var id = S.id, state = S.state;
    var ENDED = { succeeded: 1, failed: 1, cancelled: 1, expired: 1 };
    var KIND = { primary: 'Primary', reference: 'Reference', news: 'News', opinion: 'Analysis', vendor: 'Vendor', forum: 'Forum', other: 'Other' };

    function h(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return String(u || ''); } }
    function secs(a, b) { var x = Date.parse(a), y = b ? Date.parse(b) : Date.now(); return isNaN(x) || isNaN(y) ? null : Math.max(0, Math.round((y - x) / 1000)); }
    function dur(s) { if (s == null) return ''; return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60 ? (s % 60) + ' s' : ''); }
    function clock(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
    function num(re, text) { var m = re.exec(String(text || '')); return m ? Number(m[1]) : null; }
    var still = function () { return document.documentElement.getAttribute('data-ov-motion') === 'off' || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); };
    function arrive(el) { el.classList.add('is-new'); setTimeout(function () { el.classList.remove('is-new'); }, 500); }

    function count(el, to) {
        var from = Number(el.getAttribute('data-n'));
        el.setAttribute('data-n', to == null ? '' : String(to));
        if (to == null) { el.textContent = '—'; return; }
        if (isNaN(from) || from >= to || still()) { el.textContent = String(to); return; }
        var t0 = performance.now(), ms = 600;
        el.classList.remove('is-bump'); void el.offsetWidth; el.classList.add('is-bump');
        (function step(t) { var k = Math.min(1, (t - t0) / ms); var e = 1 - Math.pow(1 - k, 3); el.textContent = String(Math.round(from + (to - from) * e)); if (k < 1) requestAnimationFrame(step); })(t0);
    }

    // ── The skeleton, built once ──
    root.textContent = '';
    var hero = h('div', 'ddl-hero');
    var chip = h('span', 'ddl-chip'); var dot = h('i', 'ddl-dot'); var chipText = h('span'); chip.append(dot, chipText);
    var nowLine = h('span', 'ddl-now');
    var elapsed = h('span', 'ddl-time');
    var pctEl = h('b', 'ddl-pct');
    var top = h('div', 'ddl-top'); top.append(chip, nowLine, elapsed, pctEl);
    var bar = h('div', 'ddl-bar'); bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100');
    var fill = h('span', 'ddl-fill'); bar.append(fill);
    ORDER.forEach(function (k, i) { var tick = h('i', 'ddl-tick'); tick.style.left = (100 * (i + 1) / ORDER.length) + '%'; bar.append(tick); });
    hero.append(top, bar);

    var tiles = h('div', 'ddl-tiles');
    function tile(label) { var t = h('div', 'ddl-tile'); var v = h('b', 'ddl-v', '—'); var l = h('span', 'ddl-l', label); var s = h('small', 'ddl-s'); t.append(v, l, s); tiles.append(t); return { v: v, s: s }; }
    var tQs = tile('Questions'), tSources = tile('Sources found'), tPages = tile('Pages read'), tTime = tile('Time');

    var list = h('ol', 'ddl-steps');
    var rows = {};
    var touched = {};
    ORDER.forEach(function (key, i) {
        var li = h('li', 'ddl-step is-pending'); li.setAttribute('data-key', key);
        var d = h('details');
        var sum = h('summary');
        var ic = h('span', 'ddl-ic'); ic.setAttribute('aria-hidden', 'true');
        var n = h('span', 'ddl-n', String(i + 1));
        var name = h('strong', 'ddl-name', LABEL[key] || key);
        var det = h('span', 'ddl-det');
        var tm = h('span', 'ddl-dur');
        sum.append(ic, n, name, det, tm);
        var body = h('div', 'ddl-body');
        body.append(h('p', 'ddl-note', NOTE[key] || ''));
        var more = h('div', 'ddl-more');
        body.append(more);
        d.append(sum, body);
        d.addEventListener('toggle', function () { if (d.__auto) { d.__auto = false; return; } touched[key] = true; });
        li.append(d);
        list.append(li);
        rows[key] = { li: li, d: d, det: det, tm: tm, more: more };
    });
    var gapsBox = h('div', 'ddl-gaps');
    var err = h('p', 'dd-error'); err.setAttribute('role', 'alert'); err.hidden = true;
    root.append(hero, tiles, list, gapsBox, err);

    // ── Breakdowns ──
    function questions(box, st) {
        var qs = (st.plan && st.plan.questions) || [];
        if (!qs.length || box.querySelector('ol')) return;
        box.textContent = '';
        var ol = h('ol', 'rs-live-qs');
        qs.forEach(function (q, i) { var li = h('li', null, q.question); li.style.setProperty('--i', String(i)); ol.append(li); arrive(li); });
        box.append(ol);
        var searches = (st.plan && st.plan.searches) || [];
        if (searches.length) {
            var s = h('div', 'ddl-caps');
            searches.forEach(function (x) { s.append(h('span', 'ddl-cap', x.q)); });
            box.append(h('p', 'ddl-note', 'Its searches:'), s);
        }
    }
    var pageRows = {};
    function pages(box, st, mode) {
        var chosen = (st.candidates || []).filter(function (c) { return c && c.url; });
        var reads = st.reads || [];
        var byUrl = {}; reads.forEach(function (r) { byUrl[r.source_id || r.url] = r; });
        // Spares that stood in show up as reads that were not in the first chosen set.
        var shown = mode === 'choose' ? chosen.filter(function (c) { return c.chosen !== false; }) : chosen.filter(function (c) { return c.chosen !== false || byUrl[c.source_id || c.url]; });
        if (!shown.length) { if (!box.firstChild) box.append(h('p', 'ddl-empty', 'The pages appear here once they are chosen.')); return; }
        var ul = box.querySelector('ul.ddl-sites');
        if (!ul) { box.textContent = ''; ul = h('ul', 'ddl-sites'); box.append(ul); }
        var running = (rowsState.read === 'running' && mode === 'read') || (rowsState.analyse === 'running' && mode === 'analyse');
        var firstWaiting = true;
        shown.forEach(function (c) {
            var key = mode + ':' + (c.source_id || c.url);
            var r = pageRows[key];
            if (!r) {
                var li = h('li', 'ddl-site');
                var mark = h('span', 'ddl-site-mark', host(c.url).slice(0, 1).toUpperCase());
                var main = h('div', 'ddl-site-main');
                var a = h('a', 'ddl-site-name', c.title || host(c.url)); a.href = c.url; a.rel = 'noopener noreferrer'; a.target = '_blank';
                var sub = h('small', 'ddl-site-host', host(c.url));
                main.append(a, sub);
                var extra = h('p', 'ddl-site-why', mode === 'choose' ? (c.reason || '') : '');
                main.append(extra);
                var tags = h('div', 'ddl-caps');
                main.append(tags);
                var st2 = h('span', 'ddl-site-state');
                li.append(mark, main, st2);
                ul.append(li);
                arrive(li);
                r = pageRows[key] = { li: li, extra: extra, tags: tags, state: st2, kind: null };
            }
            if (mode === 'choose') { r.state.textContent = ''; return; }
            var got = byUrl[c.source_id || c.url];
            var done, label;
            if (mode === 'read') {
                done = Boolean(got);
                label = !got ? (running && firstWaiting ? 'Reading…' : 'Waiting') : got.status === 'read' ? (got.words || 0) + ' words' : 'Not read';
                if (got && got.status !== 'read' && got.reason && r.extra.textContent !== got.reason) r.extra.textContent = got.reason;
                r.li.classList.toggle('is-skip', Boolean(got && got.status !== 'read'));
            } else {
                if (got && got.status !== 'read') { r.li.remove(); return; }
                done = Boolean(got && got.summary);
                label = done ? (got.findings || 0) + ' note' + (got.findings === 1 ? '' : 's') : (running && firstWaiting ? 'Reading it…' : 'Waiting');
                if (done && r.extra.textContent !== got.summary) { r.extra.textContent = got.summary; arrive(r.extra); }
                if (done && got.kind && r.kind !== got.kind) { r.kind = got.kind; r.tags.textContent = ''; var k = h('span', 'ddl-cap', KIND[got.kind] || got.kind); r.tags.append(k); arrive(k); }
            }
            if (!done && running && firstWaiting) firstWaiting = false;
            r.li.classList.toggle('is-done', done);
            r.li.classList.toggle('is-now', !done && label.slice(-1) === '…');
            r.state.textContent = label;
        });
    }
    var rowsState = {};

    function draw(st) {
        state = st;
        var steps = {}; (st.steps || []).forEach(function (s) { if (s && s.key) steps[s.key] = s; });
        var live = !ENDED[st.status];
        chip.className = 'ddl-chip is-' + st.status;
        chipText.textContent = st.status === 'queued' ? 'Waiting to start' : st.status.charAt(0).toUpperCase() + st.status.slice(1);
        var cur = steps[st.step] || {};
        nowLine.textContent = st.step ? (LABEL[st.step] || st.step) + (cur.detail ? ' · ' + cur.detail : '') : '';
        var p = Math.max(0, Math.min(100, Math.round((Number(st.progress) || 0) * 100)));
        pctEl.textContent = p + '%';
        bar.setAttribute('aria-valuenow', String(p));
        fill.style.width = p + '%';
        bar.classList.toggle('is-live', live);

        ORDER.forEach(function (key) {
            var s = steps[key] || { status: 'pending' };
            var r = rows[key];
            var was = rowsState[key];
            rowsState[key] = s.status || 'pending';
            r.li.className = 'ddl-step is-' + (s.status || 'pending') + (st.step === key && live ? ' is-current' : '');
            var ic = r.li.querySelector('.ddl-ic');
            var busyMark = ic.querySelector('.ov-mark');
            if (s.status === 'running' && !busyMark) { var m = h('span', 'ov-mark'); m.setAttribute('data-size', '22'); m.setAttribute('data-state', 'busy'); ic.append(m); }
            else if (s.status !== 'running' && busyMark) busyMark.remove();
            if (was && was !== s.status && s.status === 'done') { r.li.classList.add('is-just-done'); setTimeout(function () { r.li.classList.remove('is-just-done'); }, 900); }
            r.det.textContent = s.detail || (s.status === 'pending' ? 'Waiting' : '');
            r.tm.textContent = s.started_at ? dur(secs(s.started_at, s.finished_at)) : '';
            r.tm.setAttribute('data-from', s.status === 'running' && s.started_at ? s.started_at : '');
            var shouldOpen = st.step === key && live;
            if (!touched[key] && r.d.open !== shouldOpen) { r.d.__auto = true; r.d.open = shouldOpen; }
        });
        questions(rows.plan.more, st);
        if (!rows.search.more.firstChild && steps.search && steps.search.status === 'done') rows.search.more.append(h('p', 'ddl-empty', 'The best of these are chosen to be read in the next step; the rest stay listed under the answer.'));
        pages(rows.choose.more, st, 'choose');
        pages(rows.read.more, st, 'read');
        pages(rows.analyse.more, st, 'analyse');
        if (!rows.write.more.firstChild && rowsState.write === 'running') rows.write.more.append(h('p', 'ddl-empty', 'Every claim will name the pages it rests on.'));

        var qs = (st.plan && st.plan.questions) || [];
        count(tQs.v, qs.length || null);
        tQs.s.textContent = st.plan && st.plan.searches ? st.plan.searches.length + ' searches planned' : '';
        count(tSources.v, num(/(\d+) sources?/, (steps.search || {}).detail));
        var engines = num(/from (\d+) engines?/, (steps.search || {}).detail);
        tSources.s.textContent = engines ? 'from ' + engines + ' engine' + (engines === 1 ? '' : 's') : '';
        var reads = st.reads || [];
        var ok = reads.filter(function (r) { return r.status === 'read'; }).length;
        count(tPages.v, reads.length || rowsState.read === 'running' ? ok : null);
        var chosen = (st.candidates || []).filter(function (c) { return c && c.chosen !== false; }).length;
        tPages.s.textContent = chosen ? 'of ' + chosen + ' chosen' + (reads.length - ok ? ' · ' + (reads.length - ok) + ' could not be' : '') : '';

        gapsBox.textContent = '';
        if (st.gaps && st.gaps.length) { var g = h('details', 'ddl-gapfold'); g.append(h('summary', null, 'What it could not do (' + st.gaps.length + ')')); st.gaps.forEach(function (x) { g.append(h('p', 'ddl-note', String(x))); }); gapsBox.append(g); }
        err.hidden = !st.error;
        if (st.error) err.textContent = st.error.detail || st.error.code || 'The deep dive stopped';
    }

    var t0 = Date.parse(S.since || '');
    function ticking() {
        if (!ENDED[state.status] && !isNaN(t0)) { var s = Math.max(0, Math.floor((Date.now() - t0) / 1000)); elapsed.textContent = clock(s) + ' so far'; tTime.v.textContent = clock(s); tTime.s.textContent = S.minutes ? 'about ' + S.minutes + ' min in all' : ''; }
        ORDER.forEach(function (k) { var tm = rows[k].tm; var from = tm.getAttribute('data-from'); if (from) tm.textContent = dur(secs(from)); });
    }
    setInterval(ticking, 1000);

    draw(state);
    ticking();

    var busy = false, ticks = 0;
    var timer = setInterval(function () {
        if (++ticks > 1800) { clearInterval(timer); return; }
        if (busy || document.hidden) return;
        busy = true;
        var ctl = typeof AbortController === 'function' ? new AbortController() : null;
        var stop = ctl ? setTimeout(function () { ctl.abort(); }, 8000) : 0;
        fetch('/deep-dive/' + encodeURIComponent(id) + '/state', { headers: { Accept: 'application/json' }, signal: ctl ? ctl.signal : undefined })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (j) {
                var d = j && j.deep_dive;
                if (!d) return;
                if (ENDED[d.status]) { location.reload(); return; }
                d.site_limit = d.site_limit || state.site_limit;
                draw(d);
            })
            .catch(function () {})
            .then(function () { busy = false; clearTimeout(stop); });
    }, 2000);
})();
